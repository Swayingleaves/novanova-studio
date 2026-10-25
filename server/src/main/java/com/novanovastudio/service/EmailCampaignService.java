package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.EmailCampaignProperties;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.EmailCampaignDtos;
import com.novanovastudio.entity.EmailCampaignRecords;
import com.novanovastudio.repository.EmailCampaignRepository;
import com.novanovastudio.security.CurrentUser;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.TeamScope;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import javax.imageio.ImageIO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.springframework.boot.autoconfigure.mail.MailProperties;
import org.springframework.stereotype.Service;
import org.springframework.transaction.reactive.TransactionalOperator;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * 管理员邮件群发业务，负责权限、内容清理、收件及图片快照。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-24 16:00
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class EmailCampaignService {
    /** 允许查询的发送状态。 */
    private static final Set<String> DELIVERY_STATUSES = Set.of("queued", "sending", "sent", "failed", "unknown", "cancelled");
    /** 单张图片最大五兆字节。 */
    private static final int MAXIMUM_IMAGE_BYTES = 5 * 1024 * 1024;
    /** 单封邮件图片总大小上限，预留邮件编码膨胀空间。 */
    private static final int MAXIMUM_TOTAL_IMAGE_BYTES = 10 * 1024 * 1024;
    /** 任务仓储。 */
    private final EmailCampaignRepository repository;
    /** 当前管理员身份。 */
    private final CurrentUserProvider currentUserProvider;
    /** 沿用已有媒体归属校验与下载能力。 */
    private final PersistenceService persistenceService;
    /** 全局限流配置。 */
    private final EmailCampaignProperties campaignProperties;
    /** 发件人配置。 */
    private final NovanovaProperties properties;
    /** 邮件连接配置。 */
    private final MailProperties mailProperties;
    /** 任务与全部快照共用事务。 */
    private final TransactionalOperator transactionalOperator;

    /**
     * 返回群发配置与邮件配置就绪状态。
     * @return 管理员可见配置
     */
    public Mono<EmailCampaignDtos.Settings> getSettings() {
        return requirePlatformAdministrator().map(user -> new EmailCampaignDtos.Settings(configured(), properties.getEmail().getFrom(),
                campaignProperties.getMinimumIntervalSeconds(), campaignProperties.getMaximumPerMinute(),
                campaignProperties.getMaximumPerHour(), campaignProperties.getMaximumActiveCampaigns()));
    }

    /**
     * 使用实际发送时的安全清理和排版生成预览，不创建任务或发送邮件。
     * @param request 待预览的编辑器正文
     * @return 最终邮件文档
     */
    public Mono<EmailCampaignDtos.Preview> previewContent(EmailCampaignDtos.PreviewRequest request) {
        return requirePlatformAdministrator().map(user -> new EmailCampaignDtos.Preview(
                EmailCampaignContentRenderer.render(EmailCampaignContentRenderer.clean(request.bodyHtml()).body().html())));
    }

    /**
     * 分页搜索全部有邮箱用户，包含禁用用户，与全部用户群发的范围保持一致。
     * @param page 页码
     * @param pageSize 分页大小
     * @param keyword 用户昵称、用户名或邮箱关键字
     * @param emailDomains 可选邮箱后缀，空列表或未传表示不限制
     * @return 可选择的收件人
     */
    public Mono<EmailCampaignDtos.UserPage> listUsers(int page, int pageSize, String keyword, List<String> emailDomains) {
        return requirePlatformAdministrator().then(Mono.defer(() -> {
            validatePage(page, pageSize);
            String search = normalizeSearchKeyword(keyword);
            List<String> domains = normalizeEmailDomains(emailDomains);
            return Mono.zip(repository.listUsers(search, (page - 1) * pageSize, pageSize, domains).collectList(), repository.countUsers(search, domains))
                    .map(result -> new EmailCampaignDtos.UserPage(result.getT1(), result.getT2()));
        }));
    }

    /**
     * 读取当前实际使用的邮箱域名及人数，仅平台管理员可访问。
     * @return 邮箱后缀筛选选项
     */
    public Mono<List<EmailCampaignDtos.EmailDomain>> listEmailDomains() {
        return requirePlatformAdministrator().then(repository.listEmailDomains().collectList());
    }

    /**
     * 创建后台发送任务，只有任务、收件人及图片全部保存成功才允许派发。
     * @param request 已通过接口校验的编辑内容与收件范围
     * @return 持久化后的任务汇总
     * @throws BusinessException 内容、配置或收件范围不合法时抛出
     */
    public Mono<EmailCampaignDtos.Campaign> createCampaign(EmailCampaignDtos.CreateRequest request) {
        return requirePlatformAdministrator().flatMap(user -> repository.findByRequestId(request.requestId(), user.id())
                .switchIfEmpty(Mono.defer(() -> {
                    validateRequest(request);
                    EmailCampaignDtos.RecipientFilter recipientFilter = normalizeRecipientFilter(request.recipientFilter());
                    PreparedContent prepared = prepareContent(request.bodyHtml());
                    // 对象存储网络访问在数据库事务外完成，避免持锁下载图片。
                    return snapshotImages(prepared).flatMap(images -> repository.lockControl(false)
                            .then(repository.findByRequestId(request.requestId(), user.id())
                                    .switchIfEmpty(Mono.defer(() -> repository.countActive().flatMap(active -> {
                                        if (active >= campaignProperties.getMaximumActiveCampaigns()) return Mono.error(invalid("群发队列已满，请等待已有任务完成"));
                                        return saveCampaign(request, recipientFilter, prepared.bodyHtml(), images, user.id());
                                    }))))
                            .as(transactionalOperator::transactional));
                })))
                .flatMap(this::requireCampaign)
                .doOnNext(campaign -> log.info("邮件群发任务已就绪: campaignId={}, recipientCount={}", campaign.id(), campaign.recipientCount()));
    }

    /**
     * 分页查看群发任务与逐用户状态汇总。
     * @param page 页码
     * @param pageSize 分页大小
     * @return 群发任务分页
     */
    public Mono<EmailCampaignDtos.CampaignPage> listCampaigns(int page, int pageSize) {
        return requirePlatformAdministrator().then(Mono.defer(() -> {
            validatePage(page, pageSize);
            return Mono.zip(repository.listCampaigns((page - 1) * pageSize, pageSize).collectList(), repository.countCampaigns())
                    .map(result -> new EmailCampaignDtos.CampaignPage(result.getT1(), result.getT2()));
        }));
    }

    /**
     * 读取轻量状态汇总，轮询不重复下载邮件图片。
     * @param campaignId 任务主键
     * @return 任务当前汇总
     */
    public Mono<EmailCampaignDtos.Campaign> getCampaign(long campaignId) {
        return requirePlatformAdministrator().then(requireCampaign(campaignId));
    }

    /**
     * 查看邮件正文与创建时发件人，内嵌图片转换成仅用于预览的数据地址。
     * @param campaignId 任务主键
     * @return 邮件详情
     */
    public Mono<EmailCampaignDtos.Detail> getDetail(long campaignId) {
        return requirePlatformAdministrator().then(requireCampaign(campaignId)).flatMap(campaign ->
                Mono.zip(repository.getContent(campaignId), repository.listImages(campaignId).collectList())
                        .map(result -> {
                            Document document = Jsoup.parseBodyFragment(result.getT1().bodyHtml());
                            document.outputSettings().prettyPrint(false);
                            for (EmailCampaignRecords.Image image : result.getT2()) {
                                document.select("img").stream().filter(element -> element.attr("src").equals("cid:" + image.contentId()))
                                        .forEach(element -> element.attr("src", "data:" + image.mimeType() + ";base64," + Base64.getEncoder().encodeToString(image.data())));
                            }
                            String bodyHtml = document.body().html();
                            return new EmailCampaignDtos.Detail(campaign, bodyHtml, result.getT1().fromEmail(), EmailCampaignContentRenderer.render(bodyHtml));
                        }));
    }

    /**
     * 分页查看某次任务的逐用户状态。
     * @param campaignId 任务主键
     * @param page 页码
     * @param pageSize 分页大小
     * @param status 可选发送状态
     * @return 逐用户记录分页
     */
    public Mono<EmailCampaignDtos.DeliveryPage> listDeliveries(long campaignId, int page, int pageSize, String status) {
        return requirePlatformAdministrator().then(Mono.defer(() -> {
            validatePage(page, pageSize);
            String filter = status == null ? "" : status;
            if (!filter.isEmpty() && !DELIVERY_STATUSES.contains(filter)) throw invalid("发送状态不合法");
            return requireCampaign(campaignId).then(Mono.zip(repository.listDeliveries(campaignId, filter, (page - 1) * pageSize, pageSize).collectList(),
                    repository.countDeliveries(campaignId, filter))).map(result -> new EmailCampaignDtos.DeliveryPage(result.getT1(), result.getT2()));
        }));
    }

    /**
     * 取消尚未发送的收件人；已经开始发送的邮件继续保留实际结果。
     * @param campaignId 任务主键
     * @return 取消完成信号
     */
    public Mono<Void> cancelCampaign(long campaignId) {
        return requirePlatformAdministrator().then(requireCampaign(campaignId))
                .flatMap(campaign -> repository.cancelCampaign(campaignId).as(transactionalOperator::transactional))
                .doOnNext(cancelled -> log.info("取消邮件群发任务: campaignId={}, cancelled={}", campaignId, cancelled)).then();
    }

    /**
     * 限定平台管理员与平台空间，团队管理员不能使用全站群发能力。
     * @return 当前平台管理员
     */
    private Mono<CurrentUser> requirePlatformAdministrator() {
        return currentUserProvider.currentUser().flatMap(user -> TeamScope.current()
                .filter(scope -> scope.teamId() == 0 && "admin".equals(user.role()))
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.PERMISSION_DENIED, "仅平台管理员可以管理邮件群发")))
                .thenReturn(user));
    }

    /**
     * @param campaignId 任务主键
     * @return 必须存在的任务
     */
    private Mono<EmailCampaignDtos.Campaign> requireCampaign(long campaignId) {
        return repository.getCampaign(campaignId).switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "邮件群发任务不存在")));
    }

    /**
     * @param request 创建请求
     * @throws BusinessException 配置、间隔或收件范围不合法时抛出
     */
    private void validateRequest(EmailCampaignDtos.CreateRequest request) {
        if (!configured()) throw invalid("请先配置邮件服务器与发件人地址");
        if (request.intervalSeconds() < campaignProperties.getMinimumIntervalSeconds()) throw invalid("发送间隔不能小于全局最小间隔");
        boolean allUsers = "all".equals(request.recipientMode());
        if (!allUsers && !"selected".equals(request.recipientMode())) throw invalid("收件范围不合法");
        if (request.recipientFilter() != null) {
            // 筛选结果全选必须独立表达，避免与手动名单或全部用户模式混用而扩大收件范围。
            if (allUsers || !request.userIds().isEmpty()) throw invalid("全选筛选结果不能同时选择全部用户或指定用户名单");
        } else if (allUsers ? !request.userIds().isEmpty() : request.userIds().isEmpty()) {
            throw invalid("请选择全部用户、指定用户或全部筛选结果");
        }
        if (request.userIds().size() != request.userIds().stream().distinct().count()) throw invalid("收件用户不能重复");
    }

    /**
     * 标准化搜索词，搜索列表和全选结果快照使用相同规则。
     * @param keyword 可选搜索词
     * @return 去除两侧空白的搜索词，未传时为空字符串
     * @throws BusinessException 搜索词超过限制时抛出
     */
    private String normalizeSearchKeyword(String keyword) {
        String search = keyword == null ? "" : keyword.trim();
        if (search.length() > 200) throw invalid("搜索内容不能超过200个字符");
        return search;
    }

    /**
     * 校验并标准化全选搜索结果的筛选条件。
     * @param recipientFilter 全选条件，未全选时为空
     * @return 标准化的搜索条件，未全选时为空
     * @throws BusinessException 筛选条件缺失或格式不合法时抛出
     */
    private EmailCampaignDtos.RecipientFilter normalizeRecipientFilter(EmailCampaignDtos.RecipientFilter recipientFilter) {
        if (recipientFilter == null) return null;
        if (recipientFilter.keyword() == null || recipientFilter.emailDomains() == null) throw invalid("请完整提供收件人搜索条件");
        return new EmailCampaignDtos.RecipientFilter(normalizeSearchKeyword(recipientFilter.keyword()), normalizeEmailDomains(recipientFilter.emailDomains()));
    }

    /**
     * 统一收件人搜索的邮箱后缀格式并拒绝通配符，按完整域名精确匹配。
     * @param emailDomains 可选邮箱域名，支持前导@，忽略大小写及两侧空白
     * @return 去重排序后的完整域名；未指定或空列表表示不限制
     * @throws BusinessException 后缀数量或域名格式不合法时抛出
     */
    private List<String> normalizeEmailDomains(List<String> emailDomains) {
        if (emailDomains == null) return List.of();
        if (emailDomains.size() > 50) throw invalid("单次最多选择50种邮箱后缀");
        return emailDomains.stream().map(value -> {
            if (value == null) throw invalid("邮箱后缀不能为空");
            String domain = value.trim().toLowerCase(Locale.ROOT);
            if (domain.startsWith("@")) domain = domain.substring(1);
            if (domain.length() > 253 || !domain.matches("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+")) {
                throw invalid("邮箱后缀格式不正确，请使用qq.com或gmail.com等完整域名");
            }
            return domain;
        }).distinct().sorted().toList();
    }

    /**
     * 清理富文本并将每张图片映射成邮件内嵌内容标识，只接受有归属的上传媒体。
     * @param bodyHtml 编辑器正文
     * @return 安全正文与需要快照的媒体映射
     * @throws BusinessException 正文为空或图片来源不合法时抛出
     */
    PreparedContent prepareContent(String bodyHtml) {
        Document document = EmailCampaignContentRenderer.clean(bodyHtml);
        Map<String, String> images = new LinkedHashMap<>();
        for (var element : document.select("img")) {
            String storageKey = element.attr("data-storage-key");
            if (!storageKey.startsWith("image:") || storageKey.length() > 200) throw invalid("正文图片必须通过插入图片按钮上传");
            String contentId = images.computeIfAbsent(storageKey, key -> "email-image-" + (images.size() + 1));
            element.attr("src", "cid:" + contentId).removeAttr("data-storage-key");
        }
        if (images.size() > 10) throw invalid("单封邮件最多插入10张图片");
        if (!StringUtils.hasText(document.body().text()) && images.isEmpty()) throw invalid("邮件正文不能为空");
        return new PreparedContent(document.body().html(), images);
    }

    /**
     * 下载图片并检查实际格式，所有图片快照总计不超过十兆字节。
     * @param prepared 安全正文与图片映射
     * @return 已验证的图片快照
     */
    private Mono<List<EmailCampaignRecords.Image>> snapshotImages(PreparedContent prepared) {
        return Flux.fromIterable(prepared.images().entrySet()).concatMap(entry -> persistenceService.downloadMedia(entry.getKey())
                        .flatMap(media -> Mono.fromCallable(() -> new EmailCampaignRecords.Image(entry.getValue(), imageMimeType(media.data()), media.data()))
                                .subscribeOn(Schedulers.boundedElastic())))
                .collectList().map(images -> {
                    if (images.stream().mapToLong(image -> image.data().length).sum() > MAXIMUM_TOTAL_IMAGE_BYTES) throw invalid("邮件图片总大小不能超过10MB");
                    return images;
                });
    }

    /**
     * 根据图片真实文件头验证格式与尺寸，不接受可执行的矢量图片内容。
     * @param data 图片文件内容
     * @return 真实图片媒体类型
     * @throws BusinessException 图片过大、损坏或格式不支持时抛出
     */
    private String imageMimeType(byte[] data) {
        if (data.length == 0 || data.length > MAXIMUM_IMAGE_BYTES) throw invalid("单张邮件图片必须在5MB以内");
        try (var input = ImageIO.createImageInputStream(new ByteArrayInputStream(data))) {
            var readers = ImageIO.getImageReaders(input);
            if (!readers.hasNext()) throw invalid("邮件图片只支持PNG、JPEG和GIF");
            var reader = readers.next();
            try {
                reader.setInput(input);
                String format = reader.getFormatName().toLowerCase(Locale.ROOT);
                if (!Set.of("png", "jpeg", "gif").contains(format)) throw invalid("邮件图片只支持PNG、JPEG和GIF");
                if ((long) reader.getWidth(0) * reader.getHeight(0) > 40_000_000) throw invalid("邮件图片尺寸过大，请缩小后重新上传");
                return "image/" + format;
            } finally {
                reader.dispose();
            }
        } catch (IOException exception) {
            log.error("验证群发图片失败", exception);
            throw invalid("邮件图片损坏，请重新上传");
        }
    }

    /**
     * 在同一个事务中保存任务、收件人及图片。
     * @param request 创建请求
     * @param recipientFilter 标准化的全选搜索条件，手动指定或全部用户时为空
     * @param bodyHtml 清理后的正文
     * @param images 图片快照
     * @param userId 创建管理员
     * @return 任务主键
     */
    private Mono<Long> saveCampaign(EmailCampaignDtos.CreateRequest request, EmailCampaignDtos.RecipientFilter recipientFilter,
            String bodyHtml, List<EmailCampaignRecords.Image> images, long userId) {
        return repository.insertCampaign(request, bodyHtml, properties.getEmail().getFrom(), userId).flatMap(id ->
                repository.snapshotRecipients(id, "all".equals(request.recipientMode()), request.userIds(), recipientFilter).flatMap(count -> {
                    if (count == 0) return Mono.error(invalid("当前没有可发送邮件的用户"));
                    if ("selected".equals(request.recipientMode()) && recipientFilter == null && count != request.userIds().size()) return Mono.error(invalid("部分所选用户已不存在或没有邮箱，请刷新后重新选择"));
                    return repository.updateRecipientCount(id, Math.toIntExact(count))
                            .thenMany(Flux.fromIterable(images).concatMap(image -> repository.insertImage(id, image))).then(Mono.just(id));
                })).switchIfEmpty(repository.findByRequestId(request.requestId(), userId));
    }

    /** @return 邮件连接及发件人是否齐全 */
    private boolean configured() {
        return StringUtils.hasText(mailProperties.getHost()) && StringUtils.hasText(properties.getEmail().getFrom());
    }

    /**
     * @param page 页码
     * @param pageSize 分页大小
     * @throws BusinessException 分页不合法时抛出
     */
    private void validatePage(int page, int pageSize) {
        if (page < 1 || page > 1_000_000 || pageSize < 1 || pageSize > 100) throw invalid("分页参数不合法");
    }

    /**
     * @param message 中文错误原因
     * @return 参数错误异常
     */
    private BusinessException invalid(String message) { return new BusinessException(ErrorCode.PARAM_INVALID, message); }

    /**
     * @param bodyHtml 已清理的正文
     * @param images 媒体存储键到内嵌图片标识的映射
     */
    record PreparedContent(String bodyHtml, Map<String, String> images) { }
}

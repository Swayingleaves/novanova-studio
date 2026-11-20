package com.novanovastudio.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.SharedWorkDtos;
import com.novanovastudio.repository.PersistenceRepository;
import com.novanovastudio.repository.SharedWorkRepository;
import com.novanovastudio.repository.TeamRepository;
import com.novanovastudio.repository.UserRepository;
import com.novanovastudio.security.AdminGuard;
import com.novanovastudio.security.CurrentUser;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.TeamScope;
import com.novanovastudio.storage.MediaAccessService;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.util.context.ContextView;

/**
 * 作品快照投稿、分空间审核及面向访客的公开内容查询。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-06 10:00
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class SharedWorkService {
    /** 首页沿用的业务分类。 */
    private static final Set<String> CATEGORIES = Set.of("视觉海报", "概念短片", "商业广告", "游戏美术", "时尚影像", "产品视觉", "生活方式");
    /** 已完成准备、可供作者管理或审核的状态。 */
    private static final Set<String> STATUSES = Set.of("pending", "published", "rejected", "withdrawn", "takenDown");
    /** 作者列表可筛选的状态，包含后台准备中和准备失败。 */
    private static final Set<String> QUERY_STATUSES = Set.of("preparing", "failed", "pending", "published", "rejected", "withdrawn", "takenDown");
    /** 分享持久化。 */
    private final SharedWorkRepository repository;
    /** 来源记录读取。 */
    private final PersistenceRepository persistenceRepository;
    /** 复用画布和模型配置查询。 */
    private final PersistenceService persistenceService;
    /** 公开字段构造器。 */
    private final SharedWorkSnapshotFactory snapshots;
    /** 私有副本与签名。 */
    private final SharedWorkMediaService mediaService;
    /** 用户身份。 */
    private final CurrentUserProvider currentUserProvider;
    /** 署名来源。 */
    private final UserRepository users;
    /** 团队署名。 */
    private final TeamRepository teams;
    /** 审核权限。 */
    private final AdminGuard adminGuard;
    /** 状态更新和审计同一事务提交。 */
    private final TransactionalOperator transactionalOperator;
    /** 已有存储清理队列。 */
    private final StorageBillingService storageBillingService;
    /** 仍在后台复制媒体的投稿，避免接口返回后无法确认准备是否结束。 */
    private final Set<String> activePreparations = ConcurrentHashMap.newKeySet();
    /** 私有存储桶读地址签发。 */
    private final MediaAccessService mediaAccessService;

    /**
     * 预览服务端实际将公开的内容，返回版本以防预览后内容被修改。
     * @param request 分享来源和选项
     * @return 公开内容预览
     */
    public Mono<SharedWorkDtos.PreviewResult> preview(SharedWorkDtos.SubmitRequest request) {
        validate(request);
        return requirePublisher().flatMap(userId -> source(userId, request).flatMap(snapshot -> {
            String version = version(snapshot);
            return Flux.fromIterable(snapshot.media()).concatMap(media -> mediaService.sourceUrl(userId, media)
                            .map(url -> Map.entry(SharedWorkSnapshotFactory.ASSET_PREFIX + media.assetId(), url)))
                    .collectMap(Map.Entry::getKey, Map.Entry::getValue)
                    .map(urls -> new SharedWorkDtos.PreviewResult((JSONObject) replace(snapshot.data(), urls), version));
        }));
    }

    /**
     * 校验并登记投稿后立即返回。媒体副本在后台准备，完成后才进入审核队列。
     * @param request 来源与发布表单
     * @return 已受理的投稿摘要，状态为准备中
     */
    public Mono<SharedWorkDtos.WorkItem> submit(SharedWorkDtos.SubmitRequest request) {
        validate(request);
        return Mono.zip(requirePublisher(), TeamScope.current()).flatMap(actor -> {
            long userId = actor.getT1();
            long teamId = actor.getT2().teamId();
            return repository.findRequest(userId, teamId, request.requestId()).flatMap(this::existingSubmission)
                    .switchIfEmpty(Mono.defer(() -> source(userId, request).flatMap(snapshot -> {
                        if (!version(snapshot).equals(request.sourceVersion())) return Mono.error(conflict("原内容已变化，请重新预览后提交"));
                        String code = UUID.randomUUID().toString();
                        return Mono.deferContextual(context -> creatorName(userId, teamId)
                                .flatMap(name -> repository.create(code, userId, teamId, name, request, snapshot.data()))
                                .flatMap(created -> {
                                    if (!created) return repository.findRequest(userId, teamId, request.requestId()).flatMap(this::existingSubmission);
                                    prepareInBackground(code, userId, teamId, snapshot, context);
                                    return required(code).map(this::item);
                                }));
                    })));
        });
    }

    /**
     * 读取作者或当前审核者可访问的投稿详情。
     * @param code 分享标识
     * @return 投稿详情
     */
    public Mono<SharedWorkDtos.WorkDetail> detail(String code) {
        return Mono.zip(currentUserProvider.currentUser(), TeamScope.current()).flatMap(actor -> required(code).flatMap(work -> {
            TeamScope scope = actor.getT2();
            boolean reviewer = scope.teamId() > 0 ? "administrator".equals(scope.memberRole()) : "admin".equals(actor.getT1().role());
            if (work.getLongValue("teamId") != scope.teamId() || (!reviewer && work.getLongValue("userId") != actor.getT1().id())) {
                return Mono.error(notFound());
            }
            if (!QUERY_STATUSES.contains(work.getString("workStatus"))) return Mono.error(notFound());
            return hydratedDetail(work);
        }));
    }

    /**
     * 面向访客读取已发布作品，其他状态统一不公开。
     * @param code 分享标识
     * @return 公开详情
     */
    public Mono<SharedWorkDtos.WorkDetail> publicDetail(String code) {
        return published(code).flatMap(this::hydratedDetail);
    }

    /**
     * 只为已公开作品的实际关联媒体签发读取地址。
     * @param code 分享标识
     * @param assetId 分享内媒体标识
     * @return 临时访问授权
     */
    public Mono<SharedWorkDtos.MediaAccess> publicMedia(String code, String assetId) {
        return published(code).flatMap(work -> repository.media(code).filter(asset -> assetId.equals(asset.getString("assetId")))
                .singleOrEmpty().switchIfEmpty(Mono.error(notFound())).flatMap(mediaService::access));
    }

    /**
     * 查询本人投稿或当前空间审核队列。
     * @param review 是否审核列表
     * @param status 状态筛选
     * @param page 页码
     * @return 每页二十条的列表
     */
    public Mono<SharedWorkDtos.WorkPage> list(boolean review, String status, int page) {
        validatePage(page);
        if (!status.isEmpty() && !QUERY_STATUSES.contains(status)) throw invalid("作品状态不正确");
        Mono<Long> user = review ? adminGuard.requireAdmin().thenReturn(0L) : currentUserProvider.currentUserId();
        return Mono.zip(user, TeamScope.current()).flatMap(actor -> Mono.zip(
                repository.list(actor.getT1(), actor.getT2().teamId(), status, (page - 1L) * 20, 20).concatMap(this::withPreview).collectList(),
                repository.count(actor.getT1(), actor.getT2().teamId(), status))
                .map(result -> new SharedWorkDtos.WorkPage(result.getT1(), result.getT2(), page, 20)));
    }

    /**
     * 作者撤回当前空间的本人投稿，撤回后不再签发公开媒体地址。
     * @param code 分享标识
     * @return 完成信号
     */
    public Mono<Void> withdraw(String code) {
        return Mono.zip(requirePublisher(), TeamScope.current()).flatMap(actor -> required(code).flatMap(work -> {
            if (work.getLongValue("userId") != actor.getT1() || work.getLongValue("teamId") != actor.getT2().teamId()) return Mono.error(notFound());
            String previous = work.getString("workStatus");
            if ("withdrawn".equals(previous)) return Mono.empty();
            if (!STATUSES.contains(previous)) return Mono.error(conflict("作品仍在准备，请稍后再撤回"));
            return change(work, actor.getT1(), "withdrawn", "作者撤回");
        })).then();
    }

    /**
     * 当前空间管理员审核或下架作品，不能跨空间审核。
     * @param request 审核指令
     * @return 完成信号
     */
    public Mono<Void> review(SharedWorkDtos.ReviewRequest request) {
        return Mono.zip(adminGuard.requireAdmin(), TeamScope.current()).flatMap(actor -> required(request.shareCode()).flatMap(work -> {
            if (work.getLongValue("teamId") != actor.getT2().teamId()) return Mono.error(notFound());
            String next = switch (request.action()) { case "approve" -> "published"; case "reject" -> "rejected"; case "takeDown" -> "takenDown"; default -> throw invalid("审核操作不正确"); };
            String previous = work.getString("workStatus");
            if (!("pending".equals(previous) && Set.of("published", "rejected").contains(next)) && !("published".equals(previous) && "takenDown".equals(next))) {
                return Mono.error(conflict("作品状态已变化，请刷新列表后操作"));
            }
            String reason = request.reason() == null ? "" : request.reason().trim();
            if (!"published".equals(next) && reason.isBlank()) return Mono.error(invalid("请填写驳回或下架原因"));
            return change(work, actor.getT1().id(), next, reason);
        })).then();
    }

    /**
     * 查询首页官方与已公开用户作品，筛选发生在服务端分页之前，默认按点赞总数倒序。
     * @param type 类型
     * @param category 分类
     * @param keyword 关键词
     * @param page 页码
     * @return 每页八条的混合列表
     */
    public Mono<SharedWorkDtos.FantasticPage> fantastic(String type, String category, String keyword, int page) {
        validatePage(page);
        if ((!type.isEmpty() && !Set.of("image", "video", "canvas").contains(type)) || (!category.isEmpty() && !CATEGORIES.contains(category)) || keyword.length() > 200) throw invalid("作品筛选参数不正确");
        return currentViewer().flatMap(viewer -> Mono.zip(
                        repository.fantastic(type, category, keyword.trim(), viewer, (page - 1L) * 8, false).concatMap(this::fantasticItem).collectList(),
                        repository.fantastic(type, category, keyword.trim(), viewer, 0, true).single().map(row -> row.getLongValue("total")))
                .map(result -> new SharedWorkDtos.FantasticPage(result.getT1(), result.getT2(), page, 8)));
    }

    /**
     * 切换当前用户对首页内容的点赞状态，同一用户重复点击即在点赞与取消之间切换。
     * @param targetKey 内容标识
     * @return 切换后的点赞状态与总数
     */
    public Mono<SharedWorkDtos.LikeResult> toggleFantasticLike(String targetKey) {
        if (!targetKey.matches("(official:\\d{1,18}|user:[0-9a-zA-Z-]{1,64})")) throw invalid("点赞内容不正确");
        return currentUserProvider.currentUserId().flatMap(userId -> repository.fantasticVisible(targetKey)
                .filter(Boolean::booleanValue).switchIfEmpty(Mono.error(notFound()))
                .flatMap(visible -> repository.toggleLike(targetKey, userId))
                .flatMap(liked -> repository.likeCount(targetKey).map(count -> new SharedWorkDtos.LikeResult(count, liked)))
                .doOnSuccess(result -> log.info("首页内容点赞切换：targetKey={}, userId={}, liked={}", targetKey, userId, result.liked())));
    }

    /** @return 当前可选登录用户标识，未登录为零 */
    private Mono<Long> currentViewer() {
        return currentUserProvider.optionalCurrentUser().map(CurrentUser::id).defaultIfEmpty(0L);
    }

    /**
     * 找到已公开作品，仅此入口可供跨空间复制使用。
     * @param code 分享标识
     * @return 内部作品记录
     */
    public Mono<JSONObject> published(String code) {
        return required(code).filter(work -> "published".equals(work.getString("workStatus"))).switchIfEmpty(Mono.error(notFound()));
    }

    /**
     * 回收失败、撤回及进程中断投稿的媒体，物理删除继续由现有队列重试。
     * @return 完成信号
     */
    public Mono<Void> cleanup() {
        return repository.expirePreparations().thenMany(repository.cleanupMedia()).concatMap(asset -> deleteCover(asset)
                .then(storageBillingService.requestObjectDeletion(asset.getString("storageId"), asset.getString("objectKey")))
                .then(repository.markCleaned(asset.getString("shareCode"), asset.getString("assetId")))
                .onErrorResume(error -> { log.error("清理分享媒体失败，保留记录等待重试", error); return Mono.empty(); }))
                .then().contextWrite(context -> context.put(TeamScope.SYSTEM_KEY, true));
    }

    /**
     * 补齐已提交视频缺失的分享封面，供上线后一次性补偿，也可在截帧失败后重试。
     *
     * @param limit 单次最多处理条数
     * @return 扫描、补齐和失败数量
     */
    public Mono<SharedWorkDtos.CoverRefreshResult> refreshMissingCovers(int limit) {
        int batch = Math.max(1, Math.min(limit, 20));
        Mono<SharedWorkDtos.CoverRefreshResult> refresh = repository.missingVideoCovers(batch)
                .concatMap(asset -> mediaService.refreshCover(asset)
                        .map(done -> Map.entry(done, asset))
                        .onErrorResume(error -> {
                            log.error("补充分享视频封面失败：shareCode={}, assetId={}", asset.getString("shareCode"), asset.getString("assetId"), error);
                            return Mono.just(Map.entry(false, asset));
                        }))
                .collectList()
                .map(results -> new SharedWorkDtos.CoverRefreshResult(results.size(),
                        (int) results.stream().filter(Map.Entry::getKey).count(),
                        (int) results.stream().filter(entry -> !entry.getKey()).count()))
                .contextWrite(context -> context.put(TeamScope.SYSTEM_KEY, true));
        // 补封面要跨空间读取并写回媒体记录，只允许平台管理员执行，空间管理员不应动到其它空间的作品。
        return currentUserProvider.currentUser()
                .filter(user -> "admin".equals(user.role()))
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.PERMISSION_DENIED, "仅平台管理员可以补齐分享封面")))
                .then(refresh);
    }

    /**
     * 登记分享视频封面的删除，没有封面时直接完成。
     *
     * @param asset 待清理的分享媒体
     * @return 完成信号
     */
    private Mono<Void> deleteCover(JSONObject asset) {
        String coverObjectKey = asset.getString("coverObjectKey");
        if (coverObjectKey == null || coverObjectKey.isBlank()) return Mono.empty();
        return storageBillingService.requestObjectDeletion(asset.getString("storageId"), coverObjectKey)
                .onErrorResume(error -> {
                    log.error("登记分享封面删除失败: shareCode={}, assetId={}", asset.getString("shareCode"), asset.getString("assetId"), error);
                    return Mono.empty();
                });
    }

    /** @param value 快照内容 @param replacements 媒体引用替换 @return 只更新媒体字段的独立数据，不改写恰好同名的文字或提示词 */
    public static Object replace(Object value, Map<String, String> replacements) {
        if (value instanceof JSONObject object) {
            JSONObject result = new JSONObject();
            object.forEach((key, item) -> {
                if (Set.of("source", "url", "dataUrl").contains(key) && item instanceof String text) result.put(key, replacements.getOrDefault(text, text));
                else if (Set.of("references", "videoReferences").contains(key) && item instanceof JSONArray array) {
                    JSONArray references = new JSONArray();
                    array.forEach(reference -> references.add(reference instanceof String text ? replacements.getOrDefault(text, text) : replace(reference, replacements)));
                    result.put(key, references);
                } else result.put(key, replace(item, replacements));
            });
            return result;
        }
        if (value instanceof JSONArray array) { JSONArray result = new JSONArray(); array.forEach(item -> result.add(replace(item, replacements))); return result; }
        return value;
    }

    /** @param code 作品 @param userId 作者 @param teamId 空间 @param snapshot 快照 @param context 提交请求上下文 @return 无。副本准备独立于接口响应继续执行 */
    private void prepareInBackground(String code, long userId, long teamId, SharedWorkSnapshotFactory.Snapshot snapshot, ContextView context) {
        activePreparations.add(code);
        prepareSubmission(code, userId, teamId, snapshot).doFinally(signal -> activePreparations.remove(code)).contextWrite(context).subscribe(ignored -> { }, error -> { });
    }

    /** @param code 分享标识 @return 后台副本准备是否仍在执行 */
    boolean preparationRunning(String code) { return activePreparations.contains(code); }

    /** @param code 作品 @param userId 作者 @param teamId 空间 @param snapshot 快照 @return 准备好的投稿 */
    private Mono<SharedWorkDtos.WorkItem> prepareSubmission(String code, long userId, long teamId, SharedWorkSnapshotFactory.Snapshot snapshot) {
        Mono<Void> copies = snapshot.media().isEmpty() ? Mono.empty() : mediaService.privateStorage()
                .flatMap(config -> Flux.fromIterable(snapshot.media()).concatMap(asset -> mediaService.copy(code, userId, asset, config)).then());
        return copies.then(repository.transition(code, teamId, "preparing", "pending", ""))
                .flatMap(changed -> changed ? required(code).map(this::item) : Mono.error(conflict("投稿准备状态已失效，请重新分享")))
                .doOnSuccess(work -> log.info("作品投稿准备完成：shareCode={}, userId={}, teamId={}", code, userId, teamId))
                .onErrorResume(error -> repository.transition(code, teamId, "preparing", "failed", "副本准备失败")
                        .then(cleanup()).then(Mono.error(error)))
                .doOnError(error -> log.error("作品投稿失败：shareCode={}", code, error));
    }

    /** @param work 已有投稿 @return 已完成的幂等结果 */
    private Mono<SharedWorkDtos.WorkItem> existingSubmission(JSONObject work) {
        String status = work.getString("workStatus");
        if (STATUSES.contains(status) || "preparing".equals(status)) return Mono.just(item(work));
        return Mono.error(conflict("本次准备失败，请关闭弹窗后重新分享"));
    }

    /** @param userId 来源用户 @param request 投稿参数 @return 已补齐展示模型名的公开快照 */
    private Mono<SharedWorkSnapshotFactory.Snapshot> source(long userId, SharedWorkDtos.SubmitRequest request) {
        Mono<JSONObject> record = "canvas".equals(request.sourceType()) ? persistenceService.getProject(request.sourceId())
                : persistenceRepository.findGenerationLogById(userId, request.sourceId()).filter(log -> Set.of("image", "video").contains(log.getType()))
                        .map(log -> JSON.parseObject(log.getData())).switchIfEmpty(Mono.error(notFound()));
        return record.map(value -> snapshots.build(value, request)).flatMap(snapshot -> {
            if (snapshot.modelConfigurationId().isEmpty()) return Mono.just(snapshot);
            return persistenceService.listModelConfigs().map(models -> {
                var model = models.stream().filter(value -> snapshot.modelConfigurationId().equals(value.id())).findFirst()
                        .orElseThrow(() -> invalid("原模型已不可访问，请关闭生成信息后分享"));
                snapshot.data().getJSONObject("generation").put("modelName", model.modelName());
                return snapshot;
            });
        });
    }

    /** @return 校验具有发布权限的当前用户标识 */
    private Mono<Long> requirePublisher() {
        return Mono.zip(currentUserProvider.currentUserId(), TeamScope.current()).flatMap(actor -> actor.getT2().teamId() > 0 && !"administrator".equals(actor.getT2().memberRole())
                ? Mono.error(new BusinessException(ErrorCode.PERMISSION_DENIED, "团队作品仅所有者及管理员可以分享")) : Mono.just(actor.getT1()));
    }

    /** @param userId 作者 @param teamId 空间 @return 来源于真实用户及团队的署名 */
    private Mono<String> creatorName(long userId, long teamId) {
        return users.findById(userId).map(user -> user.getNickname() == null || user.getNickname().isBlank() ? user.getUsername() : user.getNickname())
                .flatMap(name -> teamId == 0 ? Mono.just(name) : teams.findTeam(teamId).map(team -> team.getString("name") + " · " + name));
    }

    /** @param work 作品 @param userId 操作人 @param next 新状态 @param reason 原因 @return 原子状态和审计写入结果 */
    private Mono<Void> change(JSONObject work, long userId, String next, String reason) {
        String previous = work.getString("workStatus");
        return repository.transition(work.getString("shareCode"), work.getLongValue("teamId"), previous, next, reason)
                .flatMap(changed -> changed ? repository.reviewLog(work.getString("shareCode"), userId, previous, next, reason)
                        : Mono.error(conflict("作品状态已变化，请刷新后操作")))
                .as(transactionalOperator::transactional)
                .doOnSuccess(ignored -> log.info("作品状态变更：shareCode={}, operatorUserId={}, previous={}, next={}", work.getString("shareCode"), userId, previous, next));
    }

    /** @param work 已授权作品 @return 带临时媒体地址的公开数据 */
    private Mono<SharedWorkDtos.WorkDetail> hydratedDetail(JSONObject work) {
        return repository.media(work.getString("shareCode")).concatMap(asset -> mediaService.access(asset)
                        .map(access -> Map.entry(SharedWorkSnapshotFactory.ASSET_PREFIX + asset.getString("assetId"), access.url())))
                .collectMap(Map.Entry::getKey, Map.Entry::getValue)
                .map(urls -> new SharedWorkDtos.WorkDetail(item(work), (JSONObject) replace(JSON.parseObject(work.getString("snapshot")), urls)));
    }

    /** @param row 内部合并查询行 @return 统一首页卡片 */
    private Mono<SharedWorkDtos.FantasticItem> fantasticItem(JSONObject row) {
        if ("official".equals(row.getString("source"))) {
            // 官方作品直接使用精选表里的媒体地址，私有桶下必须按公开页用途重签。
            String mediaUrl = row.getString("mediaUrl") == null ? "" : row.getString("mediaUrl");
            String thumbnailUrl = row.getString("thumbnailUrl") == null ? "" : row.getString("thumbnailUrl");
            // 图片精选大多没有单独配封面，直接对原图按卡片尺寸缩放；视频不能叠加图片处理参数，保持空由前端回退。
            String cardCover = thumbnailUrl.isBlank() && "image".equals(row.getString("workType")) ? mediaUrl : thumbnailUrl;
            return Mono.zip(
                            mediaAccessService.signUrl(mediaUrl, MediaAccessService.Purpose.PUBLIC_PAGE),
                            mediaAccessService.signUrl(cardCover, MediaAccessService.Purpose.HOME_CARD))
                    .map(urls -> card(row, urls.getT1(), urls.getT2()));
        }
        return repository.media(row.getString("shareCode")).filter(asset -> "canvas".equals(row.getString("workType"))
                        ? asset.getString("mimeType").startsWith("image/") : asset.getString("mimeType").startsWith(row.getString("workType") + "/"))
                .next().flatMap(asset -> mediaService.access(asset)
                        .flatMap(access -> cardThumbnail(asset).map(cover -> card(row, access.url(), cover)))
                        .defaultIfEmpty(card(row, "", "")))
                .defaultIfEmpty(card(row, "", ""));
    }

    /**
     * 签发首页卡片缩略图地址。
     * <p>
     * 视频用分享时截取的 720 封面；图片与画布对原对象按卡片尺寸缩放；其余媒体没有缩略图。
     *
     * @param asset 分享媒体记录
     * @return Mono&lt;String&gt; 缩略图地址，没有可用缩略图时为空串
     */
    private Mono<String> cardThumbnail(JSONObject asset) {
        String coverObjectKey = asset.getString("coverObjectKey");
        if (coverObjectKey != null && !coverObjectKey.isBlank()) {
            return mediaAccessService.signObject(asset.getString("storageId"), coverObjectKey, "cover.jpg", "image/jpeg",
                            MediaAccessService.Purpose.PUBLIC_PAGE, false)
                    .map(MediaAccessService.Access::url)
                    .defaultIfEmpty("")
                    .onErrorResume(error -> Mono.just(""));
        }
        String mimeType = asset.getString("mimeType");
        if (mimeType == null || !mimeType.startsWith("image/")) return Mono.just("");
        return mediaAccessService.signObject(asset.getString("storageId"), asset.getString("objectKey"),
                        asset.getString("fileName"), mimeType, MediaAccessService.Purpose.HOME_CARD, false)
                .map(MediaAccessService.Access::url)
                .defaultIfEmpty("")
                .onErrorResume(error -> Mono.just(""));
    }

    /** @param row 内部卡片 @param mediaUrl 已授权媒体地址 @param thumbnail 缩略图 @return 无内部存储信息的卡片 */
    private SharedWorkDtos.FantasticItem card(JSONObject row, String mediaUrl, String thumbnail) {
        return new SharedWorkDtos.FantasticItem(row.getString("source") + ":" + row.getString("identifier"), row.getString("source"), row.getString("shareCode"),
                row.getString("title"), row.getString("description"), row.getString("category"), row.getString("creatorName"), row.getString("workType"),
                mediaUrl, thumbnail, row.getString("targetPath"), row.getString("promptContent"), row.getLongValue("likeCount"), row.getBooleanValue("liked"));
    }

    /** @param row 列表记录 @return 带临时预览地址的摘要，媒体尚未复制完成时地址为空 */
    private Mono<SharedWorkDtos.WorkItem> withPreview(JSONObject row) {
        String type = row.getString("workType");
        return repository.media(row.getString("shareCode")).filter(asset -> {
            String mime = asset.getString("mimeType");
            return mime != null && ("canvas".equals(type) ? mime.startsWith("image/") : mime.startsWith(type + "/"));
        }).next().flatMap(mediaService::access).map(access -> item(row, access.url())).defaultIfEmpty(item(row, ""));
    }

    /** @param work 内部记录 @return 不含内部信息的摘要 */
    private SharedWorkDtos.WorkItem item(JSONObject work) { return item(work, ""); }

    /** @param work 内部记录 @param previewUrl 列表预览地址 @return 不含内部信息的摘要 */
    private SharedWorkDtos.WorkItem item(JSONObject work, String previewUrl) {
        return new SharedWorkDtos.WorkItem(work.getString("shareCode"), work.getString("title"), work.getString("description"), work.getString("category"), work.getString("creatorName"),
                work.getString("workType"), work.getString("workStatus"), work.getString("reviewReason"), work.getString("createdAt"), work.getString("publishedAt"), previewUrl);
    }

    /** @param code 分享标识 @return 内部作品 @throws BusinessException 不存在时抛出 */
    private Mono<JSONObject> required(String code) { return repository.find(code).switchIfEmpty(Mono.error(notFound())); }
    /** @param request 投稿表单 @throws BusinessException 参数不合法时抛出 */
    private static void validate(SharedWorkDtos.SubmitRequest request) {
        if (!Set.of("generation", "canvas").contains(request.sourceType()) || !Set.of("image", "video", "canvas").contains(request.workType())
                || !CATEGORIES.contains(request.category()) || request.title().trim().isEmpty()) throw invalid("分享类型、分类或标题不正确");
        if ("generation".equals(request.sourceType()) && (request.roundId() == null || request.roundId().isBlank() || request.resultId() == null || request.resultId().isBlank())) throw invalid("请选择已保存的生成结果");
        if ("canvas".equals(request.sourceType()) && !"canvas".equals(request.workType()) && (request.nodeId() == null || request.nodeId().isBlank())) throw invalid("请选择已保存的媒体节点");
    }
    /** @param page 页码 @throws BusinessException 页码越界时抛出 */
    private static void validatePage(int page) { if (page < 1 || page > 1000000) throw invalid("分页参数不正确"); }
    /** @param snapshot 来源快照 @return 用于预览提交一致性校验的摘要 */
    private static String version(SharedWorkSnapshotFactory.Snapshot snapshot) {
        var mediaIdentities = snapshot.media().stream().map(media -> media.storageKey().isBlank() ? media.sourceUrl() : media.storageKey()).toList();
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest((JSON.toJSONString(snapshot.data()) + JSON.toJSONString(mediaIdentities)).getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException exception) { throw new IllegalStateException("当前运行时不支持内容摘要", exception); }
    }
    /** @return 不公开作品的统一错误 */
    private static BusinessException notFound() { return new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "作品不存在或尚未公开"); }
    /** @param message 参数错误说明 @return 参数错误 */
    private static BusinessException invalid(String message) { return new BusinessException(ErrorCode.PARAM_INVALID, message); }
    /** @param message 冲突说明 @return 状态冲突 */
    private static BusinessException conflict(String message) { return new BusinessException(ErrorCode.DATA_CONFLICT, message); }
}

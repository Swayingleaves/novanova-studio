package com.novanovastudio.service;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.StorageFileDtos;
import com.novanovastudio.repository.StorageFileRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.TeamScope;
import com.novanovastudio.storage.ObjectStorageService;
import java.time.Instant;
import java.util.Locale;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * 本人云文件管理、元数据归类及短期只读访问授权。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-20 12:00
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class StorageFileService {
    /** 支持的文件分类。 */
    private static final Set<String> CATEGORIES = Set.of("image", "video", "audio", "document", "other");
    /** 支持的排序，禁止拼接客户端SQL。 */
    private static final Set<String> SORTS = Set.of("newest", "oldest", "largest", "smallest");
    /** 文件数据访问。 */
    private final StorageFileRepository repository;
    /** 当前登录用户。 */
    private final CurrentUserProvider currentUserProvider;
    /** 只在验证对象所有权后加载原存储配置。 */
    private final ObjectProvider<PersistenceService> persistenceServiceProvider;
    /** 沿用对象存储提供方适配器。 */
    private final ObjectStorageService objectStorageService;
    /** 协调访问授权与删除的短事务。 */
    private final TransactionalOperator transactionalOperator;

    /**
     * @param request 文件列表查询
     * @return 当前用户、当前空间的分页文件明细
     * @throws BusinessException 查询参数不合法时抛出
     */
    public Mono<JSONObject> listFiles(StorageFileDtos.ListRequest request) {
        int page = request.page() == null ? 1 : request.page();
        int pageSize = request.pageSize() == null ? 20 : request.pageSize();
        String category = request.category() == null ? "" : request.category();
        String sort = request.sort() == null ? "newest" : request.sort();
        String keyword = request.keyword() == null ? "" : request.keyword().trim();
        if (page < 1 || pageSize < 1 || pageSize > 100 || keyword.length() > 200
                || (!category.isEmpty() && !CATEGORIES.contains(category)) || !SORTS.contains(sort)) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "云文件查询参数不正确"));
        }
        return currentUserProvider.currentUserId().flatMap(userId -> Mono.zip(
                repository.list(userId, category, keyword, sort, (page - 1L) * pageSize, pageSize).collectList(),
                repository.count(userId, category, keyword))
                .map(result -> JSONObject.of("items", result.getT1(), "total", result.getT2(), "page", page, "pageSize", pageSize)));
    }

    /**
     * @param objectId 用户可见的对象标识
     * @param purpose preview或download
     * @return 五分钟只读地址及到期时间，不返回存储密钥
     * @throws BusinessException 无权访问、文件删除中或用途不合法时抛出
     */
    public Mono<JSONObject> getFileAccess(String objectId, String purpose) {
        if (!"preview".equals(purpose) && !"download".equals(purpose)) return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "文件访问用途不正确"));
        return currentUserProvider.currentUserId().flatMap(userId -> owned(userId, objectId).flatMap(object -> {
            if (object.get("deletedAt") != null || object.get("deletionRequestedAt") != null) {
                return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "文件已删除或正在删除，不能预览和下载"));
            }
            if (purpose.equals("preview") && (!Set.of("image", "video", "audio").contains(object.getString("category"))
                    || !object.getString("mimeType").matches("^(image|video|audio)/.*"))) {
                return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "该文件不支持在线预览，请下载后查看"));
            }
            Instant expiresAt = Instant.now().plusSeconds(300);
            // 所有权校验先于提升配置读取权限，停用或切换默认配置不影响本人已有文件。
            return persistenceServiceProvider.getObject().getObjectStorageForCleanup(object.getString("storageId"))
                    .contextWrite(context -> context.put(TeamScope.SYSTEM_KEY, true))
                    .flatMap(config -> Mono.fromCallable(() -> objectStorageService.createReadUrl(config,
                                    object.getString("objectKey"), object.getString("fileName"), object.getString("mimeType"), purpose.equals("download"), expiresAt))
                            .subscribeOn(Schedulers.boundedElastic()))
                    .map(url -> JSONObject.of("url", url, "expiresAt", expiresAt.toString()));
        })).as(transactionalOperator::transactional);
    }

    /**
     * @param objectId 用户可见的对象标识
     * @return 幂等的异步删除状态
     * @throws BusinessException 对象不存在或不属于本人当前空间时抛出
     */
    public Mono<JSONObject> deleteFile(String objectId) {
        return currentUserProvider.currentUserId().flatMap(userId -> owned(userId, objectId).flatMap(object -> {
            if (object.get("deletedAt") != null) return Mono.just(JSONObject.of("objectId", objectId, "status", "deleted"));
            return repository.requestDeletion(userId, object.getLongValue("objectId"))
                    .thenReturn(JSONObject.of("objectId", objectId, "status", "pendingDeletion"))
                    .doOnSuccess(result -> log.info("登记本人云文件删除：userId={}, objectId={}", userId, objectId));
        })).as(transactionalOperator::transactional);
    }

    /**
     * @param userId 当前用户
     * @param objectId 字符串对象标识
     * @return 已锁定的本人对象
     * @throws BusinessException 标识无效或没有当前空间访问权时抛出
     */
    private Mono<JSONObject> owned(long userId, String objectId) {
        long identifier;
        try { identifier = Long.parseLong(objectId); }
        catch (NumberFormatException exception) { return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "文件标识不正确")); }
        if (identifier <= 0) return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "文件标识不正确"));
        return repository.lockOwned(userId, identifier)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "当前空间中不存在该云文件")));
    }

    /**
     * 统一登记已知文件元数据，来源由服务端入口确定。
     * @param fileName 原始文件名，未记录时传实际对象文件名
     * @param kind 已有媒体业务类型
     * @param mimeType 文件媒体类型
     * @param sourceType 已确认的来源
     * @return 文件元数据
     */
    public static StorageFileDtos.Metadata describe(String fileName, String kind, String mimeType, String sourceType) {
        String normalizedMimeType = mimeType == null || mimeType.isBlank() ? "application/octet-stream" : mimeType.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        String category = "other";
        if (normalizedMimeType.startsWith("image/") || "image".equals(kind) || "avatar".equals(kind)) category = "image";
        else if (normalizedMimeType.startsWith("video/") || "video".equals(kind)) category = "video";
        else if (normalizedMimeType.startsWith("audio/") || "audio".equals(kind)) category = "audio";
        else if ("document".equals(kind) || normalizedMimeType.startsWith("text/") || Set.of("application/pdf", "application/msword", "application/rtf").contains(normalizedMimeType)
                || normalizedMimeType.startsWith("application/vnd.openxmlformats-officedocument.") || normalizedMimeType.startsWith("application/vnd.oasis.opendocument.")) category = "document";
        String name = fileName.replace('\\', '/');
        return new StorageFileDtos.Metadata(name.substring(name.lastIndexOf('/') + 1), category, normalizedMimeType, sourceType);
    }
}

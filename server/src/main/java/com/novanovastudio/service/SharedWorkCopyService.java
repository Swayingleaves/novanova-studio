package com.novanovastudio.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.ai.AiHttpClient;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.dto.SharedWorkDtos;
import com.novanovastudio.entity.PersistenceRecords;
import com.novanovastudio.repository.PersistenceRepository;
import com.novanovastudio.repository.SharedWorkRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.TeamScope;
import com.novanovastudio.storage.ObjectStorageService;
import java.nio.file.Files;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * 将已公开画布及全部媒体原子导入个人空间，保存可恢复的复制清单。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-06 10:00
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class SharedWorkCopyService {
    /** 分享读取与状态验证。 */
    private final SharedWorkService works;
    /** 分享及复制过程记录。 */
    private final SharedWorkRepository repository;
    /** 新媒体及画布写入。 */
    private final PersistenceRepository persistenceRepository;
    /** 现有画布保存及存储配置。 */
    private final PersistenceService persistenceService;
    /** 容量及持久化清理。 */
    private final StorageBillingService billing;
    /** 私有媒体与临时文件。 */
    private final SharedWorkMediaService media;
    /** 存储上传适配器。 */
    private final ObjectStorageService storage;
    /** 安全流式下载。 */
    private final AiHttpClient httpClient;
    /** 既有媒体大小限制。 */
    private final NovanovaProperties properties;
    /** 当前身份。 */
    private final CurrentUserProvider currentUser;
    /** 画布写入与任务完成原子提交。 */
    private final TransactionalOperator transactions;

    /**
     * 登录后复制公开画布，强制使用接收者个人空间，不能继承来源团队或账号配置。
     * @param code 已公开分享标识
     * @return 新个人画布标识
     */
    public Mono<SharedWorkDtos.CopyResult> copy(String code) {
        return currentUser.currentUserId().flatMap(userId -> works.published(code).flatMap(work -> {
            if (!"canvas".equals(work.getString("workType"))) return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "只有完整画布可以复制"));
            return repository.media(code).collectList().flatMap(assets -> {
                if (assets.isEmpty()) return saveEmptyCanvas(work);
                return media.privateStorage().flatMap(config -> {
                    String id = UUID.randomUUID().toString();
                    JSONArray manifest = new JSONArray();
                    for (JSONObject asset : assets) {
                        JSONObject item = JSON.parseObject(JSON.toJSONString(asset));
                        item.put("targetStorageId", config.id());
                        item.put("targetObjectKey", "shared-copy/" + id + "/" + asset.getString("assetId"));
                        item.put("targetStorageKey", kind(asset.getString("mimeType")) + ":shared-copy:" + UUID.randomUUID());
                        manifest.add(item);
                    }
                    return repository.createCopy(id, userId, manifest)
                            .thenMany(Flux.fromIterable(manifest).cast(JSONObject.class).concatMap(asset -> copyAsset(id, userId, asset, config)))
                            .collectMap(value -> value.getString("assetId"))
                            .flatMap(copied -> {
                                JSONObject document = document(id, work, copied);
                                return persistenceService.saveProject(document).then(repository.copyStatus(id, "completed"))
                                        .as(transactions::transactional).thenReturn(new SharedWorkDtos.CopyResult(id));
                            }).onErrorResume(error -> repository.copyStatus(id, "failed").then(cleanup()).then(Mono.error(error)));
                });
            });
        })).contextWrite(TeamScope.PLATFORM::apply).cache();
    }

    /**
     * 独立复制一份私有媒体并登记接收者可用的媒体标识。
     * @param id 复制任务
     * @param userId 接收者
     * @param asset 预分配媒体清单
     * @param config 目标个人存储
     * @return 接收者媒体引用
     */
    private Mono<JSONObject> copyAsset(String id, long userId, JSONObject asset, PersistenceDtos.ObjectStorageConfig config) {
        return media.temporaryFile(path -> media.access(asset).flatMap(access -> httpClient.downloadRemoteMediaToFile(access.url(), asset.getString("mimeType"), path,
                        properties.getAi().getVideoComposition().getMaximumInputBytes()))
                .flatMap(file -> billing.storeObject(config, asset.getString("targetObjectKey"), file.bytes(),
                        StorageFileService.describe(asset.getString("fileName"), kind(file.mimeType()), file.mimeType(), "generated"), () -> {
                            storage.putPrivateObject(config, asset.getString("targetObjectKey"), path, file.mimeType());
                            return asset.getString("targetObjectKey");
                        })).flatMap(key -> {
                    PersistenceRecords.MediaFileRecord record = new PersistenceRecords.MediaFileRecord();
                    record.setUserId(userId);
                    record.setStorageKey(asset.getString("targetStorageKey"));
                    record.setKind(kind(asset.getString("mimeType")));
                    record.setObjectStorageConfigId(config.id());
                    record.setObjectStorageProvider(config.provider());
                    record.setObjectStorageKey(key);
                    record.setBucket(config.bucket());
                    record.setRegion(config.region());
                    record.setMimeType(asset.getString("mimeType"));
                    record.setBytes(asset.getLongValue("fileBytes"));
                    record.setMetadata("{\"sharedWorkCopy\":true}");
                    return Mono.fromCallable(() -> storage.createReadUrl(config, key, asset.getString("fileName"), record.getMimeType(), false, Instant.now().plusSeconds(300)))
                            .subscribeOn(Schedulers.boundedElastic()).flatMap(url -> {
                                // 签名地址只作为新画布场景占位，打开时按对象键重签；数据库不保存会过期的地址。
                                record.setObjectStorageUrl(null);
                                return persistenceRepository.saveMedia(record).then(repository.copyStatus(id, "preparing"))
                                        .thenReturn(JSONObject.of("assetId", asset.getString("assetId"), "storageKey", record.getStorageKey(), "url", url));
                            });
                }));
    }

    /** @param work 无媒体的已公开画布 @return 新个人画布 */
    private Mono<SharedWorkDtos.CopyResult> saveEmptyCanvas(JSONObject work) {
        String id = UUID.randomUUID().toString();
        return persistenceService.saveProject(document(id, work, Map.of())).thenReturn(new SharedWorkDtos.CopyResult(id));
    }

    /**
     * 构造独立画布并重新分配场景内标识，私有媒体引用用于以后打开画布时刷新签名。
     * @param id 新文档标识
     * @param work 公开作品
     * @param copied 已复制媒体
     * @return 接收者文档
     */
    private JSONObject document(String id, JSONObject work, Map<String, JSONObject> copied) {
        JSONObject snapshot = JSON.parseObject(work.getString("snapshot"));
        Map<String, String> replacements = new HashMap<>();
        collectIdentifiers(snapshot.getJSONObject("scene"), replacements);
        JSONObject scene = (JSONObject) remapIdentifiers(snapshot.getJSONObject("scene"), replacements);
        replacements.clear();
        copied.forEach((assetId, value) -> replacements.put(SharedWorkSnapshotFactory.ASSET_PREFIX + assetId, value.getString("url")));
        scene = (JSONObject) SharedWorkService.replace(scene, replacements);
        attachStorageKeys(scene, copied);
        String now = Instant.now().toString();
        return JSONObject.of("identity", JSONObject.of("id", id, "title", work.getString("title"), "createdAt", now, "updatedAt", now),
                "scene", scene, "preferences", snapshot.getJSONObject("preferences"),
                "conversation", JSONObject.of("sessions", new JSONArray(), "activeSessionId", null),
                "sharedMedia", new JSONArray(copied.values()));
    }

    /** @param value 场景数据 @param replacements 标识映射 */
    private void collectIdentifiers(Object value, Map<String, String> replacements) {
        if (value instanceof JSONObject object) {
            if (object.get("id") instanceof String old) replacements.put(old, UUID.randomUUID().toString());
            object.values().forEach(child -> collectIdentifiers(child, replacements));
        } else if (value instanceof JSONArray array) array.forEach(child -> collectIdentifiers(child, replacements));
    }

    /** @param value 场景结构 @param identifiers 新标识映射 @return 仅替换标识与引用字段，保留文字和提示词的原始内容 */
    private Object remapIdentifiers(Object value, Map<String, String> identifiers) {
        if (value instanceof JSONObject object) {
            JSONObject result = new JSONObject();
            object.forEach((key, item) -> {
                if (java.util.Set.of("id", "nodeId", "rootId", "primaryImageId", "resultVideoNodeId", "selectedCameraId", "targetObjectId", "assetId").contains(key) && item instanceof String text) result.put(key, identifiers.getOrDefault(text, text));
                else if (java.util.Set.of("childIds", "memberNodeIds", "inputVideoNodeIds", "assetIds").contains(key) && item instanceof JSONArray array) {
                    JSONArray values = new JSONArray(); array.forEach(reference -> values.add(reference instanceof String text ? identifiers.getOrDefault(text, text) : reference)); result.put(key, values);
                } else result.put(key, remapIdentifiers(item, identifiers));
            });
            return result;
        }
        if (value instanceof JSONArray array) { JSONArray result = new JSONArray(); array.forEach(item -> result.add(remapIdentifiers(item, identifiers))); return result; }
        return value;
    }

    /** @param value 场景数据 @param copied 独立媒体引用 */
    private void attachStorageKeys(Object value, Map<String, JSONObject> copied) {
        if (value instanceof JSONObject object) {
            copied.values().forEach(media -> {
                if (media.getString("url").equals(object.getString("source")) || media.getString("url").equals(object.getString("url"))) object.put("storageKey", media.getString("storageKey"));
            });
            new java.util.ArrayList<>(object.values()).forEach(child -> attachStorageKeys(child, copied));
        } else if (value instanceof JSONArray array) array.forEach(child -> attachStorageKeys(child, copied));
    }

    /**
     * 依据持久化清单回收失败或中断复制，物理删除失败不提前释放容量。
     * @return 完成信号
     */
    public Mono<Void> cleanup() {
        return repository.unfinishedCopies().concatMap(job -> {
            JSONArray manifest = JSON.parseArray(job.getString("manifest"));
            return Flux.fromIterable(manifest).cast(JSONObject.class).concatMap(asset ->
                            billing.requestObjectDeletion(asset.getString("targetStorageId"), asset.getString("targetObjectKey"))
                                    .then(persistenceRepository.deleteMedia(job.getLongValue("userId"), java.util.List.of(asset.getString("targetStorageKey")))))
                    .then(repository.removeCopy(job.getString("id")))
                    .onErrorResume(error -> { log.error("清理画布复制失败，保留任务等待重试：copyId={}", job.getString("id"), error); return Mono.empty(); });
        }).then().contextWrite(context -> TeamScope.PLATFORM.apply(context).put(TeamScope.SYSTEM_KEY, true));
    }

    /** @param mimeType 媒体类型 @return 现有媒体分类 */
    private static String kind(String mimeType) { return mimeType.startsWith("image/") ? "image" : mimeType.startsWith("video/") ? "video" : mimeType.startsWith("audio/") ? "audio" : "file"; }
}

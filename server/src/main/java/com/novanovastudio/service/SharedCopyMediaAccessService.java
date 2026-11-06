package com.novanovastudio.service;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.entity.PersistenceRecords;
import com.novanovastudio.repository.PersistenceRepository;
import com.novanovastudio.security.TeamScope;
import com.novanovastudio.storage.ObjectStorageService;
import java.time.Instant;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * 为复制后属于当前用户的私有媒体刷新短期地址，避免画布再次打开时保留过期签名。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-06 10:00
 */
@Service
@RequiredArgsConstructor
public class SharedCopyMediaAccessService {
    /** 延迟读取配置避免与现有持久化服务形成构造环。 */
    private final ObjectProvider<PersistenceService> persistenceService;
    /** 媒体归属检查。 */
    private final PersistenceRepository repository;
    /** 提供方签名。 */
    private final ObjectStorageService storage;
    /** 防止为已经请求删除的独立对象继续签发地址。 */
    private final StorageBillingService billing;

    /**
     * 只为已经通过用户和空间检查的复制媒体刷新读取地址。
     * @param record 已校验归属的媒体记录
     * @return 读取地址已更新的记录
     */
    public Mono<PersistenceRecords.MediaFileRecord> resolve(PersistenceRecords.MediaFileRecord record) {
        if (!record.getStorageKey().contains(":shared-copy:")) return Mono.just(record);
        return billing.requireObjectAvailable(record.getUserId(), record.getObjectStorageConfigId(), record.getObjectStorageKey())
                .then(persistenceService.getObject().getObjectStorageForCleanup(record.getObjectStorageConfigId())
                .contextWrite(context -> context.put(TeamScope.SYSTEM_KEY, true))
                )
                .flatMap(config -> Mono.fromCallable(() -> storage.createReadUrl(config, record.getObjectStorageKey(),
                        "复制素材", record.getMimeType(), false, Instant.now().plusSeconds(300))).subscribeOn(Schedulers.boundedElastic()))
                .map(url -> { record.setObjectStorageUrl(url); return record; });
    }

    /**
     * 打开个人画布时刷新其独立媒体引用，不修改数据库快照。
     * @param userId 文档所有者
     * @param document 已校验所有权的文档
     * @return 可立即预览和编辑的文档
     */
    public Mono<JSONObject> document(long userId, JSONObject document) {
        JSONArray references = document.getJSONArray("sharedMedia");
        if (references == null || references.isEmpty()) return Mono.just(document);
        return Flux.fromIterable(references).cast(JSONObject.class).concatMap(reference -> repository.getMedia(userId, reference.getString("storageKey"))
                        .flatMap(this::resolve).map(record -> Map.entry(reference.getString("url"), record.getObjectStorageUrl())))
                .collectMap(Map.Entry::getKey, Map.Entry::getValue)
                .map(urls -> (JSONObject) SharedWorkService.replace(document, urls));
    }
}

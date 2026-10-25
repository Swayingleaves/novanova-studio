package com.novanovastudio.service;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.CreditAmounts;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.common.SystemMessage;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.dto.StorageCapacityDtos;
import com.novanovastudio.dto.StorageFileDtos;
import com.novanovastudio.repository.CreditRepository;
import com.novanovastudio.repository.StorageCapacityRepository;
import com.novanovastudio.repository.TeamRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.TeamScope;
import com.novanovastudio.storage.ObjectStorageService;
import java.math.BigInteger;
import java.time.Duration;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.Callable;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * 永久容量、积分购买和上传租约编排，阻塞上传不持有数据库事务。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-19 12:00
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class StorageCapacityService {
    /** 一G为十亿字节。 */
    private static final long GIGABYTE_BYTES = 1_000_000_000L;
    /** 容量数据访问。 */
    private final StorageCapacityRepository repository;
    /** 资源与成员归属。 */
    private final TeamRepository teamRepository;
    /** 钱包余额。 */
    private final CreditRepository creditRepository;
    /** 积分过期和到期优先扣减。 */
    private final CreditGrantService creditGrantService;
    /** 当前登录用户。 */
    private final CurrentUserProvider currentUserProvider;
    /** 复用欠费检查和实际对象台账。 */
    private final StorageBillingService billingService;
    /** 按需读取存储，避免与持久化服务循环构造。 */
    private final ObjectProvider<PersistenceService> persistenceServiceProvider;
    /** 物理对象删除。 */
    private final ObjectStorageService objectStorageService;
    /** 数据库短事务。 */
    private final TransactionalOperator transactionalOperator;

    /**
     * @return 本人当前空间的容量字节数，不要求预先创建容量账户
     */
    public Mono<JSONObject> getCapacity() {
        return currentUserProvider.currentUserId().flatMap(repository::capacity);
    }

    /**
     * 是否仍可新增文件的检查信号。
     *
     * @param userId 当前用户
     * @return 是否仍可新增文件的检查信号
     */
    public Mono<Void> requireAvailable(long userId) {
        return repository.capacity(userId).flatMap(capacity -> available(capacity).signum() > 0 ? Mono.empty()
                : Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "云存储空间不足，请删除文件或购买永久扩容套餐")));
    }

    /**
     * 尚未被文件或上传预占使用的字节数。
     *
     * @param capacity 容量统计
     * @return 尚未被文件或上传预占使用的字节数
     */
    private BigInteger available(JSONObject capacity) {
        return capacity.getBigInteger("totalBytes").subtract(capacity.getBigInteger("usedBytes")).subtract(capacity.getBigInteger("reservedBytes"));
    }

    /**
     * 管理员当前空间免费容量与自有套餐。
     *
     * @return 管理员当前空间免费容量与自有套餐
     */
    public Mono<JSONObject> getSettings() {
        return TeamScope.current().flatMap(scope -> Mono.zip(repository.freeBytes(), repository.packages(scope.teamId(), false).collectList())
                .map(values -> {
                    JSONObject result = new JSONObject();
                    result.put("freeGigabytes", values.getT1() / GIGABYTE_BYTES);
                    result.put("packages", values.getT2());
                    return result;
                }));
    }

    /**
     * 保存完成信号。
     *
     * @param request 当前空间免费容量
     * @return 保存完成信号
     */
    public Mono<Void> saveSettings(StorageCapacityDtos.SettingsRequest request) {
        return repository.saveSettings(request.freeGigabytes().longValue() * GIGABYTE_BYTES)
                .doOnSuccess(ignored -> log.info("空间永久免费容量已更新：freeGigabytes={}", request.freeGigabytes()));
    }

    /**
     * 保存完成信号，版本或所有权冲突时拒绝。
     *
     * @param request 套餐新增或编辑内容
     * @return 保存完成信号，版本或所有权冲突时拒绝
     */
    public Mono<Void> savePackage(StorageCapacityDtos.PackageRequest request) {
        CreditAmounts.of(request.credits());
        return TeamScope.current().flatMap(scope -> request.id() == null || request.id().isBlank()
                ? repository.createPackage(UUID.randomUUID().toString(), request)
                : repository.lockPackage(request.id()).switchIfEmpty(Mono.error(conflict("套餐不存在或无权修改")))
                    .flatMap(item -> {
                        if (item.getLongValue("teamId") != scope.teamId()) return Mono.error(new BusinessException(ErrorCode.PERMISSION_DENIED, "只能修改自有套餐"));
                        if (!Objects.equals(item.getInteger("revision"), request.revision())) return Mono.error(conflict("套餐已更新，请刷新后重新编辑"));
                        return repository.updatePackage(request);
                    }))
                .as(transactionalOperator::transactional)
                .doOnSuccess(ignored -> log.info("永久扩容套餐已保存：name={}, enabled={}", request.name(), request.enabled()));
    }

    /**
     * 当前默认存储提供方的可购套餐及扣款钱包。
     *
     * @return 当前默认存储提供方的可购套餐及扣款钱包
     */
    public Mono<JSONObject> listPackages() {
        return defaultStorageOwner().flatMap(owner -> repository.packages(owner, true).collectList().map(items -> {
            JSONObject result = new JSONObject();
            result.put("walletTeamId", owner);
            result.put("packages", items);
            return result;
        }));
    }

    /**
     * 当前默认存储提供方，实际存储归属与前端选择无关。
     *
     * @return 当前默认存储提供方，实际存储归属与前端选择无关
     */
    private Mono<Long> defaultStorageOwner() {
        return persistenceServiceProvider.getObject().getPlatformObjectStorageConfig()
                .flatMap(config -> teamRepository.findResource("objectStorage", config.id()))
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "默认对象存储不存在")))
                .map(item -> item.getLongValue("teamId"));
    }

    /**
     * 当前空间成员状态验证结果。
     *
     * @param userId 用户标识
     * @return 当前空间成员状态验证结果
     */
    private Mono<Void> requireActive(long userId) {
        return TeamScope.current().flatMap(scope -> scope.teamId() == 0 ? Mono.empty()
                : teamRepository.findMembership(scope.teamId(), userId)
                    .filter(member -> member.getBooleanValue("enabled") && "active".equals(member.getString("memberStatus")))
                    .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.PERMISSION_DENIED, "团队或成员已停用，不能购买或新增文件"))).then());
    }

    /**
     * 最新容量、钱包及购买标识，重复请求不重复支付。
     *
     * @param request 用户确认的套餐版本和请求标识
     * @return 最新容量、钱包及购买标识，重复请求不重复支付
     */
    public Mono<JSONObject> purchase(StorageCapacityDtos.PurchaseRequest request) {
        return currentUserProvider.currentUserId().flatMap(userId -> requireActive(userId)
                .then(repository.lockAccount(userId))
                .then(repository.purchase(userId, request.clientRequestId()).map(Optional::of).defaultIfEmpty(Optional.empty()))
                .flatMap(previous -> {
                    if (previous.isPresent()) {
                        JSONObject item = previous.get();
                        if (!request.packageId().equals(item.getString("packageId")) || request.revision() != item.getIntValue("packageRevision"))
                            return Mono.error(conflict("同一购买请求标识不能用于不同套餐"));
                        return purchaseResult(userId, item.getString("id"), item.getLongValue("walletTeamId"));
                    }
                    return defaultStorageOwner().flatMap(owner -> repository.lockPackage(request.packageId())
                            .switchIfEmpty(Mono.error(conflict("套餐已下架，请刷新后重新选择")))
                            .flatMap(item -> {
                                if (!item.getBooleanValue("enabled") || item.getLongValue("teamId") != owner || request.revision() != item.getIntValue("revision"))
                                    return Mono.error(conflict("套餐或默认存储已变化，请刷新后重新确认价格"));
                                String id = UUID.randomUUID().toString();
                                long bytes = item.getLongValue("capacityGigabytes") * GIGABYTE_BYTES;
                                return creditGrantService.consumeCredits(userId, item.getBigDecimal("credits"))
                                        .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, SystemMessage.of("business.insufficientCreditsForStorageCapacity"))))
                                        .flatMap(balance -> repository.recordPurchase(id, userId, request, item, bytes)
                                                .then(repository.recordTransaction(id, userId, item, balance)))
                                        .then(purchaseResult(userId, id, owner))
                                        .contextWrite(context -> context.put(TeamScope.WALLET_KEY, owner));
                            }));
                }).as(transactionalOperator::transactional))
                .doOnSuccess(result -> log.info("永久存储购买完成：purchaseId={}, walletTeamId={}", result.getString("purchaseId"), result.getLongValue("walletTeamId")))
                .doOnError(error -> log.error("永久存储购买失败：packageId={}, requestId={}", request.packageId(), request.clientRequestId(), error));
    }

    /**
     * 购买回执与最新数据。
     *
     * @param userId 用户
     * @param id 购买标识
     * @param owner 实际钱包
     * @return 购买回执与最新数据
     */
    private Mono<JSONObject> purchaseResult(long userId, String id, long owner) {
        return Mono.zip(repository.capacity(userId), creditRepository.getCreditBalance(userId).contextWrite(context -> context.put(TeamScope.WALLET_KEY, owner)))
                .map(values -> {
                    JSONObject result = new JSONObject();
                    result.put("purchaseId", id);
                    result.put("walletTeamId", owner);
                    result.put("creditBalance", CreditAmounts.text(values.getT2()));
                    result.put("capacity", values.getT1());
                    return result;
                });
    }

    /**
     * 已提交的上传预占标识。
     *
     * @param userId 用户
     * @param config 实际存储
     * @param key 对象键
     * @param bytes 服务端实际字节数
     * @return 已提交的上传预占标识
     */
    private Mono<String> reserve(long userId, PersistenceDtos.ObjectStorageConfig config, String key, long bytes) {
        if (bytes < 0) return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "文件字节数不能为负数"));
        String id = UUID.randomUUID().toString();
        return requireActive(userId).then(billingService.requireWritable(userId)).then(repository.lockAccount(userId))
                .then(repository.capacity(userId)).flatMap(capacity -> available(capacity).compareTo(BigInteger.valueOf(bytes)) >= 0
                        ? repository.reserve(id, userId, config.id(), key, bytes).thenReturn(id)
                        : Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "云存储剩余空间不足以保存该文件，请删除文件或购买永久扩容套餐")))
                .as(transactionalOperator::transactional);
    }

    /**
     * 上传完成后以同一事务将预占转成真实对象；取消会等待阻塞上传结束再删除，避免先删除后晚到写入。
     * @param config 实际对象存储
     * @param key 服务端分配的对象键
     * @param bytes 服务端实际字节数
     * @param upload 阻塞上传操作，返回非空结果
     * @param <T> 上传结果类型
     * @return 上传结果，租约提交和完成登记均先于结果返回
     */
    public <T> Mono<T> storeObject(PersistenceDtos.ObjectStorageConfig config, String key, long bytes, Callable<T> upload) {
        return storeObject(config, key, bytes, StorageFileService.describe(key, "", null, "unrecorded"), upload);
    }

    /**
     * @param config 实际存储配置
     * @param key 实际对象键
     * @param bytes 服务端实际大小
     * @param metadata 上传入口确认的名称、分类、媒体类型及来源
     * @param upload 不持有数据库事务的阻塞上传
     * @param <T> 上传结果类型
     * @return 已完成容量登记的上传结果
     */
    public <T> Mono<T> storeObject(PersistenceDtos.ObjectStorageConfig config, String key, long bytes, StorageFileDtos.Metadata metadata, Callable<T> upload) {
        return Mono.defer(() -> currentUserProvider.currentUserId().flatMap(userId -> reserve(userId, config, key, bytes).flatMap(id -> {
            // 缓存使下游取消不会中断上传收尾，清理链可以等待同一次上传真正结束。
            Mono<T> actualUpload = Mono.fromCallable(upload).subscribeOn(Schedulers.boundedElastic())
                    .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "对象存储上传未返回有效结果"))).cache();
            Mono<T> leasedUpload = Mono.firstWithSignal(actualUpload, Flux.interval(Duration.ofMinutes(1))
                    .concatMap(tick -> repository.renew(id).flatMap(count -> count == 1 ? Mono.empty() : Mono.error(conflict("上传租约已失效，请重试"))))
                    .then(Mono.<T>never())).cache();
            return Mono.usingWhen(Mono.just(id), lease -> leasedUpload,
                    lease -> complete(userId, lease, config.id(), key, bytes, metadata)
                            .onErrorResume(error -> abandonAfterUpload(actualUpload, lease).then(Mono.error(error))),
                    (lease, error) -> abandonAfterUpload(actualUpload, lease),
                    lease -> abandonAfterUpload(actualUpload, lease));
        }))).doOnError(error -> log.error("云存储上传或容量登记失败：storageId={}, objectKey={}, bytes={}", config.id(), key, bytes, error));
    }

    /**
     * 预占转入台账完成信号。
     *
     * @param userId 用户
     * @param id 租约
     * @param storageId 实际存储
     * @param key 对象键
     * @param bytes 实际大小
     * @param metadata 服务端确认的文件元数据
     * @return 预占转入台账完成信号
     */
    private Mono<Void> complete(long userId, String id, String storageId, String key, long bytes, StorageFileDtos.Metadata metadata) {
        return repository.lockAccount(userId).then(repository.lockReservation(id))
                .filter("uploading"::equals).switchIfEmpty(Mono.error(conflict("上传租约已过期，文件正在清理，请重试")))
                .then(billingService.registerObject(storageId, key, bytes, metadata)).then(repository.release(id))
                // 存储授权撤销后仍可登记已发出调用的原配置；容量账户始终显式限定用户与当前空间。
                .as(transactionalOperator::transactional).contextWrite(context -> context.put(TeamScope.SYSTEM_KEY, true));
    }

    /**
     * 等待上传结束并标记清理，不提前释放字节。
     *
     * @param upload 同一次上传
     * @param id 租约
     * @return 等待上传结束并标记清理，不提前释放字节
     */
    private Mono<Void> abandonAfterUpload(Mono<?> upload, String id) {
        return upload.materialize().then(repository.abandon(id)).then(cleanupReservations());
    }

    /**
     * 失败和过期上传清理完成信号，物理删除错误保留记录继续预占。
     *
     * @return 失败和过期上传清理完成信号，物理删除错误保留记录继续预占
     */
    public Mono<Void> cleanupReservations() {
        return repository.pendingCleanup().concatMap(item -> persistenceServiceProvider.getObject().getObjectStorageForCleanup(item.getString("storageId"))
                .flatMap(config -> Mono.fromRunnable(() -> objectStorageService.deletePrivateObject(config, item.getString("objectKey"))).subscribeOn(Schedulers.boundedElastic()))
                .then(repository.release(item.getString("id")))
                .onErrorResume(error -> {
                    log.error("上传预占对象清理失败，保留容量等待重试：reservationId={}", item.getString("id"), error);
                    return repository.cleanupError(item.getString("id"), error.getMessage() == null ? "对象删除失败" : error.getMessage());
                })).then().contextWrite(context -> context.put(TeamScope.SYSTEM_KEY, true));
    }

    /**
     * 业务冲突异常。
     *
     * @param message 冲突原因
     * @return 业务冲突异常
     */
    private BusinessException conflict(String message) { return new BusinessException(ErrorCode.DATA_CONFLICT, message); }
}

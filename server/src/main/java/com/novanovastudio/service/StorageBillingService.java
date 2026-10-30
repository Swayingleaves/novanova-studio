package com.novanovastudio.service;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.StorageFileDtos;
import com.novanovastudio.repository.StorageBillingRepository;
import com.novanovastudio.repository.TeamRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.TeamScope;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * 实际对象计量、月账单支付与欠费新增限制。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-18 10:00
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class StorageBillingService {
    /** 存储计量仓储。 */
    private final StorageBillingRepository repository;
    /** 资源所有权查询。 */
    private final TeamRepository teamRepository;
    /** 当前用户。 */
    private final CurrentUserProvider currentUserProvider;
    /** 复用平台积分到期优先扣减。 */
    private final CreditGrantService creditGrantService;
    /** 对象存储配置按需加载，避免与持久化服务形成循环构造。 */
    private final ObjectProvider<PersistenceService> persistenceServiceProvider;
    /** 永久容量服务按需加载，沿用统一上传入口。 */
    private final ObjectProvider<StorageCapacityService> capacityServiceProvider;
    /** 存储提供方适配器。 */
    private final com.novanovastudio.storage.ObjectStorageService objectStorageService;
    /** 事务操作器。 */
    private final TransactionalOperator transactionalOperator;

    /**
     * 上传和会产生文件的生成任务开始前拒绝欠费或已移除成员。
     * @param userId 文件所属用户
     * @return 检查完成信号
     */
    public Mono<Void> requireWritable(long userId) {
        return Mono.deferContextual(context -> {
        if (context.getOrDefault(TeamScope.IN_FLIGHT_KEY, false)) return Mono.empty();
        return TeamScope.current().flatMap(scope -> repository.hasDebt(userId, scope.teamId()).flatMap(debt -> {
            if (debt) return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "存在未支付的存储账单，请补足对应钱包积分后重试"));
            if (scope.teamId() == 0) return Mono.empty();
            return teamRepository.findMembership(scope.teamId(), userId)
                    .filter(member -> member.getBooleanValue("enabled") && "active".equals(member.getString("memberStatus")))
                    .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.PERMISSION_DENIED, "团队或成员已停用，不能新增文件"))).then();
        })).then(capacityServiceProvider.getObject().requireAvailable(userId));
        });
    }

    /**
     * 为已经完成的上传登记实际对象，不依赖客户端申报大小。
     * @param storageId 实际存储配置
     * @param key 实际对象键
     * @param bytes 服务端实际大小
     * @return 完成信号
     */
    public Mono<Void> registerObject(String storageId, String key, long bytes) {
        return registerObject(storageId, key, bytes, StorageFileService.describe(key, "", null, "unrecorded"));
    }

    /**
     * @param storageId 实际存储配置
     * @param key 实际对象键
     * @param bytes 服务端实际大小
     * @param metadata 已确认的文件元数据
     * @return 登记完成信号
     */
    public Mono<Void> registerObject(String storageId, String key, long bytes, StorageFileDtos.Metadata metadata) {
        return currentUserProvider.currentUserId().flatMap(userId -> TeamScope.current()
                .flatMap(scope -> repository.register(userId, scope.teamId(), storageId, key, bytes, metadata)));
    }

    /**
     * @param userId 原文所属用户
     * @param storageId 原存储配置
     * @param key 实际对象键
     * @return 原文件可读取的检查信号
     */
    public Mono<Void> requireObjectAvailable(long userId, String storageId, String key) {
        return repository.objectAvailable(userId, storageId, key).flatMap(available -> available ? Mono.empty()
                : Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "原文件已删除或正在删除，请重新上传导入")));
    }

    /**
     * 统一执行容量预占、上传和真实对象登记。
     * @param config 实际存储配置
     * @param key 对象键
     * @param bytes 服务端实际字节数
     * @param upload 阻塞上传操作
     * @param <T> 上传结果类型
     * @return 上传及登记成功后的结果
     */
    public <T> Mono<T> storeObject(com.novanovastudio.dto.PersistenceDtos.ObjectStorageConfig config, String key, long bytes, java.util.concurrent.Callable<T> upload) {
        return capacityServiceProvider.getObject().storeObject(config, key, bytes, upload);
    }

    /**
     * @param config 实际存储配置
     * @param key 对象键
     * @param bytes 服务端实际字节数
     * @param metadata 已确认的文件元数据
     * @param upload 阻塞上传操作
     * @param <T> 上传结果类型
     * @return 上传及登记成功后的结果
     */
    public <T> Mono<T> storeObject(com.novanovastudio.dto.PersistenceDtos.ObjectStorageConfig config, String key, long bytes, StorageFileDtos.Metadata metadata, java.util.concurrent.Callable<T> upload) {
        return capacityServiceProvider.getObject().storeObject(config, key, bytes, metadata, upload);
    }

    /** @return 仅含存储身份和数量的历史待确认分组 */
    public Mono<List<JSONObject>> listUnregisteredStorageGroups() { return repository.unregisteredStorageGroups().collectList(); }

    /**
     * 明确确认当前空间历史文件对应的自有存储，禁止猜测多个同桶配置。
     * @param storageId 管理员选择的自有配置
     * @return 补录完成信号
     */
    public Mono<Void> registerExistingMedia(String storageId) {
        return TeamScope.current().flatMap(scope -> teamRepository.findResource("objectStorage", storageId)
                .filter(resource -> resource.getLongValue("teamId") == scope.teamId())
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.PERMISSION_DENIED, "只能确认自有存储的历史文件")))
                .then(repository.registerExistingMedia(storageId))).as(transactionalOperator::transactional);
    }

    /**
     * 查询本人或当前团队的存储占用。
     * @param administrator 是否查询团队汇总，控制器先验证管理员
     * @return 实际占用
     */
    public Mono<List<JSONObject>> getUsage(boolean administrator) {
        return currentUserProvider.currentUserId().flatMap(userId -> TeamScope.current().flatMap(scope -> repository.usage(scope.teamId(), administrator ? -1 : userId).collectList()));
    }

    /**
     * 查询本人或当前团队账单。
     * @param administrator 是否查询团队账单，控制器先验证管理员
     * @return 账单列表
     */
    public Mono<List<JSONObject>> listBills(boolean administrator) {
        return currentUserProvider.currentUserId().flatMap(userId -> TeamScope.current().flatMap(scope -> repository.listBills(scope.teamId(), administrator ? -1 : userId).collectList()));
    }

    /**
     * 余额增加后和定时任务中补结欠费，不足时保留余额与账单。
     * @return 完成信号
     */
    public Mono<Void> settleUnpaidBills() {
        return repository.unpaidBills().concatMap(candidate -> repository.lockBill(candidate.getLongValue("id"))
                .flatMap(bill -> repository.canPay(bill).flatMap(payable -> payable
                        ? creditGrantService.consumeCredits(bill.getLongValue("userId"), bill.getBigDecimal("credits"))
                            .flatMap(balance -> repository.markPaid(bill, balance)) : Mono.empty()))
                .as(transactionalOperator::transactional)
                .contextWrite(context -> context.put(TeamScope.SYSTEM_KEY, true).put(TeamScope.HISTORICAL_KEY, true).put(TeamScope.WALLET_KEY, candidate.getLongValue("ownerTeamId"))))
                .then().contextWrite(context -> context.put(TeamScope.SYSTEM_KEY, true));
    }

    /**
     * 物理删除已标记的对象，失败保留记录与计量起止时间供重试。
     * @return 完成信号
     */
    public Mono<Void> deletePendingObjects() {
        return repository.pendingDeletions().concatMap(object -> persistenceServiceProvider.getObject()
                .getObjectStorageForCleanup(object.getString("storageId"))
                .flatMap(config -> Mono.fromRunnable(() -> objectStorageService.deletePrivateObject(config, object.getString("objectKey")))
                        .subscribeOn(Schedulers.boundedElastic()))
                .then(repository.deletionResult(object.getLongValue("id"), ""))
                .onErrorResume(error -> {
                    log.error("实际存储对象删除失败，保留待重试：objectId={}", object.getLongValue("id"), error);
                    return repository.deletionResult(object.getLongValue("id"), error.getMessage() == null ? "删除失败" : error.getMessage());
                })).then().contextWrite(context -> context.put(TeamScope.SYSTEM_KEY, true));
    }

    /**
     * 请求媒体物理删除。
     * @param userId 媒体所属用户
     * @param keys 媒体键
     * @return 标记完成信号
     */
    public Mono<Void> requestMediaDeletion(long userId, List<String> keys) { return repository.requestMediaDeletion(userId, keys); }

    /**
     * 保存上传后业务失败对象的删除请求，实际删除失败时由定时任务重试。
     * @param storageId 原存储标识
     * @param objectKey 原对象键
     * @return 删除请求完成信号
     */
    public Mono<Void> requestObjectDeletion(String storageId, String objectKey) {
        return repository.requestObjectDeletion(storageId, objectKey).then(deletePendingObjects());
    }
}

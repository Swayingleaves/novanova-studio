package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.config.TeamDatabaseConfiguration;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.dto.StorageCapacityDtos;
import com.novanovastudio.repository.*;
import com.novanovastudio.security.CurrentUser;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.TeamScope;
import com.novanovastudio.storage.ObjectStorageService;
import io.r2dbc.spi.ConnectionFactories;
import java.math.BigDecimal;
import java.sql.DriverManager;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.r2dbc.connection.R2dbcTransactionManager;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.transaction.reactive.TransactionalOperator;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.publisher.Signal;
import reactor.util.context.Context;

/**
 * 使用独立真实PostgreSQL验证永久容量的并发、原子性和空间隔离。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-19 12:00
 */
@Testcontainers
class StorageCapacityServiceIntegrationTest {
    /** 独立测试数据库，不访问项目运行中的数据库。 */
    @Container
    private static final PostgreSQLContainer<?> database = new PostgreSQLContainer<>("postgres:17")
            .withDatabaseName("novanova_pro_storage_test").withUsername("postgres").withPassword("postgres");
    /** 每个场景使用独立身份，避免测试数据互相影响。 */
    private static final AtomicLong identifiers = new AtomicLong(8000);
    /** 用户标识。 */
    private long userId;
    /** 当前测试默认存储，可切换提供方。 */
    private String storageId;
    /** 容量服务。 */
    private StorageCapacityService service;
    /** 真实容量仓储。 */
    private StorageCapacityRepository repository;
    /** 模拟外部对象存储，不产生外网文件。 */
    private ObjectStorageService objectStorage;
    /** 真实对象台账与旧欠费服务。 */
    private StorageBillingService billing;
    /** 使用同一真实台账验证云文件管理。 */
    private StorageFileService fileService;

    /** 执行全部生产迁移，验证新旧迁移连续性。 */
    @BeforeAll
    static void migrate() {
        Flyway.configure().dataSource(database.getJdbcUrl(), database.getUsername(), database.getPassword()).load().migrate();
    }

    /**
     * @throws Exception 独立数据库初始化失败时抛出
     */
    @BeforeEach
    @SuppressWarnings("unchecked")
    void initialize() throws Exception {
        userId = identifiers.incrementAndGet();
        storageId = "storage-" + userId;
        execute("INSERT INTO users(id, username, email, invitation_code) VALUES (" + userId + ", 'storage-" + userId + "', 'storage-" + userId + "@example.com', 'STORE" + userId + "');"
                + "INSERT INTO user_credit_accounts(user_id, team_id, credit_balance) VALUES (" + userId + ",0,100);"
                + "INSERT INTO platform_object_storage_configs(storage_id, name, team_id) VALUES ('" + storageId + "','测试平台存储',0);");
        var original = ConnectionFactories.get("r2dbc:postgresql://" + database.getUsername() + ":" + database.getPassword() + "@" + database.getHost() + ":" + database.getMappedPort(5432) + "/" + database.getDatabaseName());
        var connections = new TeamDatabaseConfiguration.ScopedConnectionFactory(original);
        var client = DatabaseClient.create(connections);
        var transaction = TransactionalOperator.create(new R2dbcTransactionManager(connections));
        var teamRepository = new TeamRepository(client);
        var credits = new CreditRepository(client);
        var grants = new CreditGrantService(credits, transaction);
        var userProvider = new CurrentUserProvider();
        var persistence = mock(PersistenceService.class);
        ObjectProvider<PersistenceService> persistenceProvider = mock(ObjectProvider.class);
        when(persistenceProvider.getObject()).thenReturn(persistence);
        when(persistence.getPlatformObjectStorageConfig()).thenAnswer(ignored -> Mono.just(config(storageId)));
        when(persistence.getObjectStorageForCleanup(anyString())).thenAnswer(call -> Mono.just(config(call.getArgument(0))));
        objectStorage = mock(ObjectStorageService.class);
        ObjectProvider<StorageCapacityService> capacityProvider = mock(ObjectProvider.class);
        repository = new StorageCapacityRepository(client, teamRepository);
        billing = new StorageBillingService(new StorageBillingRepository(client, teamRepository), teamRepository, userProvider, grants, persistenceProvider, capacityProvider, objectStorage, transaction);
        service = new StorageCapacityService(repository, teamRepository, credits, grants, userProvider, billing, persistenceProvider, objectStorage, transaction);
        fileService = new StorageFileService(new StorageFileRepository(client, teamRepository), userProvider, persistenceProvider, objectStorage, transaction);
        when(capacityProvider.getObject()).thenReturn(service);
    }

    /**
     * @param id 配置标识
     * @return 无真实凭证的测试配置
     */
    private PersistenceDtos.ObjectStorageConfig config(String id) {
        return new PersistenceDtos.ObjectStorageConfig("tencentCos", "key", "secret", "bucket", "region", "", "", "", id, "测试存储", "", false);
    }

    /**
     * @param source 待执行业务
     * @param teamId 空间
     * @param <T> 结果类型
     * @return 绑定真实用户和空间的业务
     */
    private <T> Mono<T> scoped(Mono<T> source, long teamId) {
        return source.contextWrite(context -> new TeamScope(teamId, teamId == 0 ? "" : "administrator").apply(context)
                .put(CurrentUserProvider.CURRENT_USER_CONTEXT_KEY, new CurrentUser(userId, "storage@example.com", "admin", 1)));
    }

    /**
     * @param source 平台空间业务
     * @param <T> 结果类型
     * @return 完成结果，超时视为失败
     */
    private <T> T run(Mono<T> source) { return scoped(source, 0).block(Duration.ofSeconds(20)); }

    /**
     * @param sql 测试专用固定SQL
     * @throws Exception 数据库操作失败时抛出
     */
    private void execute(String sql) throws Exception {
        try (var connection = DriverManager.getConnection(database.getJdbcUrl(), database.getUsername(), database.getPassword()); var statement = connection.createStatement()) {
            statement.execute(sql);
        }
    }

    /**
     * @param sql 测试专用查询
     * @return 单列十进制或字符串结果
     * @throws Exception 查询失败时抛出
     */
    private String query(String sql) throws Exception {
        try (var connection = DriverManager.getConnection(database.getJdbcUrl(), database.getUsername(), database.getPassword()); var statement = connection.createStatement(); var rows = statement.executeQuery(sql)) {
            assertTrue(rows.next());
            return rows.getString(1);
        }
    }

    /**
     * @param credits 套餐积分
     * @return 新上架套餐标识
     */
    private String createPackage(String credits) {
        run(service.savePackage(new StorageCapacityDtos.PackageRequest(null, null, "测试永久10G-" + userId, 10, new BigDecimal(credits), true)));
        return run(service.listPackages()).getJSONArray("packages").stream().map(JSONObject.class::cast)
                .filter(item -> item.getString("name").equals("测试永久10G-" + userId)).findFirst().orElseThrow().getString("id");
    }

    /**
     * @param id 套餐标识
     * @return 新的一次购买请求
     */
    private StorageCapacityDtos.PurchaseRequest request(String id) { return new StorageCapacityDtos.PurchaseRequest(id, 1, UUID.randomUUID().toString()); }

    /** 默认三G无需初始化账户，配置变化立即影响已有用户。 */
    @Test
    void defaultCapacityAndConfigurationApplyImmediately() {
        assertEquals("3000000000", run(service.getCapacity()).getString("totalBytes"));
        run(service.saveSettings(new StorageCapacityDtos.SettingsRequest(5)));
        assertEquals("5000000000", run(service.getCapacity()).getString("freeBytes"));
        run(service.saveSettings(new StorageCapacityDtos.SettingsRequest(3)));
    }

    /**
     * 并发重试只购买一次，新的请求允许重复购买并永久累加。
     * @throws Exception 数据库查询失败时抛出
     */
    @Test
    void concurrentPurchaseIsIdempotentAndRepeatable() throws Exception {
        String id = createPackage("10.125001");
        var request = request(id);
        var purchases = Flux.range(0, 6).flatMap(index -> scoped(service.purchase(request), 0), 6).collectList().block(Duration.ofSeconds(20));
        assertEquals(1, purchases.stream().map(item -> item.getString("purchaseId")).distinct().count());
        assertEquals("89.874999", query("SELECT credit_balance FROM user_credit_accounts WHERE user_id=" + userId + " AND team_id=0"));
        assertEquals("1", query("SELECT COUNT(*) FROM storage_capacity_purchases WHERE user_id=" + userId));
        assertEquals("1", query("SELECT COUNT(*) FROM user_credit_transactions WHERE user_id=" + userId + " AND transaction_type='storage_purchase'"));
        run(service.purchase(request(id)));
        assertEquals("23000000000", run(service.getCapacity()).getString("totalBytes"));
    }

    /**
     * 余额不足时积分批次、购买记录和容量同时回滚。
     * @throws Exception 数据库操作失败时抛出
     */
    @Test
    void insufficientCreditsRollBackGrantsAndCapacity() throws Exception {
        String id = createPackage("10");
        execute("UPDATE user_credit_accounts SET credit_balance=1 WHERE user_id=" + userId + "; INSERT INTO user_credit_grants(user_id,source_type,granted_amount,remaining_amount,expires_at) VALUES(" + userId + ",'daily_check_in',1,1,CURRENT_TIMESTAMP+INTERVAL '1 day')");
        BusinessException failure = assertThrows(BusinessException.class, () -> run(service.purchase(request(id))));
        assertEquals("business.insufficientCreditsForStorageCapacity", failure.getSystemMessage().key());
        assertEquals("1.000000", query("SELECT credit_balance FROM user_credit_accounts WHERE user_id=" + userId));
        assertEquals("1.000000", query("SELECT remaining_amount FROM user_credit_grants WHERE user_id=" + userId));
        assertEquals("0", query("SELECT COUNT(*) FROM storage_capacity_purchases WHERE user_id=" + userId));
        assertEquals("3000000000", run(service.getCapacity()).getString("totalBytes"));
    }

    /** 下架和版本修改不影响已购容量，旧请求仍返回原购买。 */
    @Test
    void changedPackagesRejectNewPurchasesAndPreserveOldOnes() {
        String id = createPackage("1");
        var original = request(id);
        String purchaseId = run(service.purchase(original)).getString("purchaseId");
        run(service.savePackage(new StorageCapacityDtos.PackageRequest(id, 1, "调整后套餐", 20, new BigDecimal("2"), false)));
        assertThrows(RuntimeException.class, () -> run(service.purchase(request(id))));
        assertEquals(purchaseId, run(service.purchase(original)).getString("purchaseId"));
        assertEquals("13000000000", run(service.getCapacity()).getString("totalBytes"));
    }

    /** 并发上传预占由同一账户锁保护，不能同时通过容量检查。 */
    @Test
    void parallelUploadsCannotExceedQuota() {
        var uploads = Flux.range(0, 2).flatMap(index -> scoped(service.storeObject(config(storageId), "parallel-" + index, 2_000_000_000L, () -> "已上传"), 0).materialize(), 2)
                .collectList().block(Duration.ofSeconds(20));
        assertEquals(1, uploads.stream().filter(Signal::isOnNext).count());
        assertEquals(1, uploads.stream().filter(Signal::isOnError).count());
        assertEquals("2000000000", run(service.getCapacity()).getString("usedBytes"));
        assertEquals("0", run(service.getCapacity()).getString("reservedBytes"));
    }

    /** 满额和免费额度调低保留文件，在途上下文也不能绕过新增限制。 */
    @Test
    void fullOrReducedCapacityRejectsInFlightUploads() {
        run(service.storeObject(config(storageId), "full", 3_000_000_000L, () -> "已上传"));
        assertThrows(RuntimeException.class, () -> run(service.storeObject(config(storageId), "overflow", 1, () -> "不应上传").contextWrite(context -> context.put(TeamScope.IN_FLIGHT_KEY, true))));
        run(service.saveSettings(new StorageCapacityDtos.SettingsRequest(1)));
        assertEquals("3000000000", run(service.getCapacity()).getString("usedBytes"));
        assertThrows(RuntimeException.class, () -> run(billing.requireWritable(userId)));
        run(service.saveSettings(new StorageCapacityDtos.SettingsRequest(3)));
    }

    /** 上传失败后的删除失败继续占用容量，删除成功才释放。 */
    @Test
    void failedUploadRetainsReservationUntilPhysicalDeletion() {
        doThrow(new IllegalStateException("模拟删除失败")).when(objectStorage).deletePrivateObject(any(), anyString());
        assertThrows(RuntimeException.class, () -> run(service.storeObject(config(storageId), "failed", 100, () -> { throw new IllegalStateException("模拟上传失败"); })));
        assertEquals("100", run(service.getCapacity()).getString("reservedBytes"));
        doNothing().when(objectStorage).deletePrivateObject(any(), anyString());
        run(service.cleanupReservations());
        assertEquals("0", run(service.getCapacity()).getString("reservedBytes"));
    }

    /**
     * 同一对象不重复计量，物理删除失败期间保持占用。
     * @throws Exception 测试数据操作失败时抛出
     */
    @Test
    void registeredObjectIsCountedOnceAndReleasedOnlyAfterDeletion() throws Exception {
        run(service.storeObject(config(storageId), "delete", 100, () -> "已上传"));
        run(billing.registerObject(storageId, "delete", 100));
        assertEquals("100", run(service.getCapacity()).getString("usedBytes"));
        execute("UPDATE storage_objects SET deletion_requested_at=CURRENT_TIMESTAMP WHERE user_id=" + userId);
        doThrow(new IllegalStateException("模拟物理删除失败")).when(objectStorage).deletePrivateObject(any(), eq("delete"));
        run(billing.deletePendingObjects());
        assertEquals("100", run(service.getCapacity()).getString("usedBytes"));
        doNothing().when(objectStorage).deletePrivateObject(any(), eq("delete"));
        run(billing.deletePendingObjects());
        assertEquals("0", run(service.getCapacity()).getString("usedBytes"));
    }

    /**
     * 旧账单继续限制新增并按原钱包结清，多次维护不重复扣款。
     * @throws Exception 测试数据操作失败时抛出
     */
    @Test
    void historicalBillsRemainPayableAndIdempotent() throws Exception {
        execute("INSERT INTO storage_bills(team_id,user_id,owner_team_id,billing_month,credits,usage_details) VALUES(0," + userId + ",0,'2026-09-01',105,'[]')");
        assertThrows(RuntimeException.class, () -> run(billing.requireWritable(userId)));
        run(billing.settleUnpaidBills());
        assertEquals("100.000000", query("SELECT credit_balance FROM user_credit_accounts WHERE user_id=" + userId));
        execute("UPDATE user_credit_accounts SET credit_balance=200 WHERE user_id=" + userId);
        run(billing.settleUnpaidBills());
        run(billing.settleUnpaidBills());
        assertEquals("95.000000", query("SELECT credit_balance FROM user_credit_accounts WHERE user_id=" + userId));
        assertEquals("paid", query("SELECT bill_status FROM storage_bills WHERE user_id=" + userId));
        assertEquals("1", query("SELECT COUNT(*) FROM storage_bills WHERE user_id=" + userId));
        run(billing.requireWritable(userId));
    }

    /**
     * 取消不会在阻塞上传仍在运行时删除对象。
     * @throws Exception 等待上传超时或中断时抛出
     */
    @Test
    void cancellationWaitsForUploadBeforeDeleting() throws Exception {
        var started = new CountDownLatch(1);
        var finish = new CountDownLatch(1);
        var deleted = new CountDownLatch(1);
        doAnswer(call -> { deleted.countDown(); return null; }).when(objectStorage).deletePrivateObject(any(), eq("cancel"));
        var subscription = scoped(service.storeObject(config(storageId), "cancel", 50, () -> { started.countDown(); assertTrue(finish.await(5, TimeUnit.SECONDS)); return "已上传"; }), 0).subscribe();
        assertTrue(started.await(5, TimeUnit.SECONDS));
        subscription.dispose();
        assertEquals(1, deleted.getCount());
        finish.countDown();
        assertTrue(deleted.await(5, TimeUnit.SECONDS));
        assertEquals("0", run(service.getCapacity()).getString("usedBytes"));
    }

    /**
     * 进程中断遗留预占到期后由独立清理任务回收。
     * @throws Exception 测试数据初始化失败时抛出
     */
    @Test
    void expiredReservationsAreRecovered() throws Exception {
        execute("INSERT INTO user_storage_capacity_accounts(team_id,user_id) VALUES(0," + userId + "); INSERT INTO storage_upload_reservations(id,team_id,user_id,storage_id,object_key,file_bytes,expires_at) VALUES('expired-" + userId + "',0," + userId + ",'" + storageId + "','expired',100,CURRENT_TIMESTAMP-INTERVAL '1 hour')");
        assertEquals("100", run(service.getCapacity()).getString("reservedBytes"));
        run(service.cleanupReservations());
        assertEquals("0", run(service.getCapacity()).getString("reservedBytes"));
    }

    /**
     * 分类和列表只以实际对象计量，媒体重复引用和仅远程链接不会放大占用。
     * @throws Exception 初始化重复引用失败时抛出
     */
    @Test
    void fileDetailsAndCategoriesUseActualObjects() throws Exception {
        String[] kinds = {"image", "video", "audio", "document", "other"};
        String[] mimeTypes = {"image/png", "video/mp4", "audio/mpeg", "text/plain", "application/octet-stream"};
        for (int index = 0; index < kinds.length; index++) {
            run(service.storeObject(config(storageId), kinds[index], (index + 1) * 100L,
                    StorageFileService.describe(index == 3 ? "报告_100%.txt" : kinds[index], kinds[index], mimeTypes[index], "upload"), () -> "上传完成"));
        }
        run(billing.registerObject(storageId, "image", 100));
        run(billing.registerObject(storageId, "unlinked", 10));
        execute("INSERT INTO media_files(storage_key,user_id,kind,mime_type,bytes,object_storage_config_id,object_storage_key) VALUES"
                + "('reference-one-" + userId + "'," + userId + ",'image','image/png',100,'" + storageId + "','image'),"
                + "('reference-two-" + userId + "'," + userId + ",'image','image/png',100,'" + storageId + "','image');"
                + "INSERT INTO media_files(storage_key,user_id,kind,mime_type,source_url,bytes) VALUES('remote-" + userId + "'," + userId + ",'image','image/png','https://example.com/remote.png',999999)");
        var capacity = run(service.getCapacity());
        assertEquals("1510", capacity.getString("usedBytes"));
        assertEquals(1510L, capacity.getJSONArray("categories").stream().map(JSONObject.class::cast).mapToLong(item -> item.getLongValue("usedBytes")).sum());
        assertEquals(6L, capacity.getJSONArray("categories").stream().map(JSONObject.class::cast).mapToLong(item -> item.getLongValue("fileCount")).sum());
        var page = run(fileService.listFiles(new com.novanovastudio.dto.StorageFileDtos.ListRequest(1, 2, "", "", "largest")));
        assertEquals(6L, page.getLongValue("total"));
        assertEquals("500", page.getJSONArray("items").getJSONObject(0).getString("fileBytes"));
        assertFalse(page.getJSONArray("items").getJSONObject(0).containsKey("objectKey"));
        var document = run(fileService.listFiles(new com.novanovastudio.dto.StorageFileDtos.ListRequest(1, 20, "_100%", "document", "newest")));
        assertEquals(1L, document.getLongValue("total"));
        assertEquals("报告_100%.txt", document.getJSONArray("items").getJSONObject(0).getString("fileName"));
        assertThrows(RuntimeException.class, () -> run(fileService.listFiles(new com.novanovastudio.dto.StorageFileDtos.ListRequest(0, 20, "", "", "newest"))));
        assertThrows(RuntimeException.class, () -> run(fileService.listFiles(new com.novanovastudio.dto.StorageFileDtos.ListRequest(1, 20, "", "", "file_bytes;DELETE"))));
    }

    /**
     * 删除接口幂等，失败状态可重试；只有物理删除成功才释放分类和总量。
     * @throws Exception 查询对象标识失败时抛出
     */
    @Test
    void cloudFileDeletionRetainsUsageUntilCleanupSucceeds() throws Exception {
        run(service.storeObject(config(storageId), "cloud-delete", 100, StorageFileService.describe("照片.png", "image", "image/png", "upload"), () -> "上传完成"));
        String objectId = query("SELECT id FROM storage_objects WHERE user_id=" + userId + " AND object_key='cloud-delete'");
        var deletions = Flux.range(0, 4).flatMap(index -> scoped(fileService.deleteFile(objectId), 0), 4).collectList().block(Duration.ofSeconds(20));
        assertTrue(deletions.stream().allMatch(result -> result.getString("status").equals("pendingDeletion")));
        assertEquals("100", run(service.getCapacity()).getString("usedBytes"));
        assertEquals("100", run(service.getCapacity()).getString("pendingDeletionBytes"));
        assertThrows(RuntimeException.class, () -> run(fileService.getFileAccess(objectId, "preview")));
        assertThrows(RuntimeException.class, () -> run(billing.requireObjectAvailable(userId, storageId, "cloud-delete")));
        doThrow(new IllegalStateException("模拟物理删除失败")).when(objectStorage).deletePrivateObject(any(), eq("cloud-delete"));
        run(billing.deletePendingObjects());
        var failed = run(fileService.listFiles(new com.novanovastudio.dto.StorageFileDtos.ListRequest(null, null, null, null, null)));
        assertEquals("deletionFailed", failed.getJSONArray("items").getJSONObject(0).getString("status"));
        assertEquals("100", run(service.getCapacity()).getString("usedBytes"));
        run(fileService.deleteFile(objectId));
        doNothing().when(objectStorage).deletePrivateObject(any(), eq("cloud-delete"));
        run(billing.deletePendingObjects());
        assertEquals("0", run(service.getCapacity()).getString("usedBytes"));
        assertEquals("0", run(service.getCapacity()).getString("pendingDeletionBytes"));
        assertEquals("deleted", run(fileService.deleteFile(objectId)).getString("status"));
        assertEquals(0, run(fileService.listFiles(new com.novanovastudio.dto.StorageFileDtos.ListRequest(null, null, null, null, null))).getLongValue("total"));
    }

    /**
     * 访问始终使用原配置，切换默认配置不会改变文件位置；跨用户和空间的访问与删除均拒绝。
     * @throws Exception 查询对象标识失败时抛出
     */
    @Test
    void fileAccessUsesOriginalStorageAndRejectsOtherScopes() throws Exception {
        run(service.storeObject(config(storageId), "owned-image", 100, StorageFileService.describe("原图.png", "image", "image/png", "generated"), () -> "上传完成"));
        String objectId = query("SELECT id FROM storage_objects WHERE user_id=" + userId + " AND object_key='owned-image'");
        String originalStorage = storageId;
        storageId = "changed-default";
        when(objectStorage.createReadUrl(any(), eq("owned-image"), eq("原图.png"), eq("image/png"), anyBoolean(), any()))
                .thenAnswer(call -> "https://example.com/signed/" + ((PersistenceDtos.ObjectStorageConfig) call.getArgument(0)).id());
        var access = run(fileService.getFileAccess(objectId, "preview"));
        assertEquals("https://example.com/signed/" + originalStorage, access.getString("url"));
        long seconds = java.time.Duration.between(java.time.Instant.now(), java.time.Instant.parse(access.getString("expiresAt"))).getSeconds();
        assertTrue(seconds >= 295 && seconds <= 300);
        run(fileService.getFileAccess(objectId, "download"));
        assertThrows(RuntimeException.class, () -> scoped(fileService.getFileAccess(objectId, "preview"), userId + 100000).block());
        assertThrows(RuntimeException.class, () -> scoped(fileService.deleteFile(objectId), userId + 100000).block());
        var differentUser = fileService.getFileAccess(objectId, "preview").contextWrite(context -> context
                .put(CurrentUserProvider.CURRENT_USER_CONTEXT_KEY, new CurrentUser(userId + 1, "other@example.com", "user", 1)));
        assertThrows(RuntimeException.class, () -> run(differentUser));
        assertThrows(RuntimeException.class, () -> run(fileService.getFileAccess("9223372036854775808", "download")));
        assertThrows(RuntimeException.class, () -> run(fileService.getFileAccess(objectId, "write")));
        verify(objectStorage, times(2)).createReadUrl(argThat(value -> value.id().equals(originalStorage)), eq("owned-image"), eq("原图.png"), eq("image/png"), anyBoolean(), any());
    }

    /**
     * 在同一临时容器的独立数据库验证从V60升级，准确补充元数据且不改变实际对象数量或大小。
     * @throws Exception 独立迁移或查询失败时抛出
     */
    @Test
    void fileMetadataMigrationBackfillsExactMatchesWithoutDuplicatingObjects() throws Exception {
        String databaseName = "novanova_pro_metadata_" + userId;
        execute("CREATE DATABASE " + databaseName);
        String jdbcUrl = database.getJdbcUrl().replace("/" + database.getDatabaseName(), "/" + databaseName);
        Flyway.configure().dataSource(jdbcUrl, database.getUsername(), database.getPassword()).target("60").load().migrate();
        try (var connection = DriverManager.getConnection(jdbcUrl, database.getUsername(), database.getPassword()); var statement = connection.createStatement()) {
            statement.execute("INSERT INTO users(id,username,email,invitation_code) VALUES(9001,'metadata','metadata@example.com','META9001');"
                    + "INSERT INTO platform_object_storage_configs(storage_id,name) VALUES('metadata','元数据迁移测试');"
                    + "INSERT INTO storage_objects(user_id,storage_id,owner_team_id,object_key,file_bytes) VALUES(9001,'metadata',0,'images/original.png',100),(9001,'metadata',0,'files/orphan.bin',20),(9001,'metadata',0,'source/original.txt',30);"
                    + "INSERT INTO media_files(storage_key,user_id,kind,mime_type,bytes,object_storage_config_id,object_storage_key) VALUES('copy1',9001,'image','image/png',100,'metadata','images/original.png'),('copy2',9001,'image','image/png',100,'metadata','images/original.png');"
                    + "INSERT INTO script_projects(id,user_id,title) VALUES('metadata-project',9001,'原文项目');"
                    + "INSERT INTO script_source_documents(id,project_id,user_id,client_request_id,source_type,file_name,file_extension,storage_config_id,object_key,file_sha256,file_bytes) VALUES('metadata-document','metadata-project',9001,'metadata-request','novel','原文.txt','txt','metadata','source/original.txt','test',30)");
        }
        Flyway.configure().dataSource(jdbcUrl, database.getUsername(), database.getPassword()).load().migrate();
        try (var connection = DriverManager.getConnection(jdbcUrl, database.getUsername(), database.getPassword()); var statement = connection.createStatement()) {
            try (var rows = statement.executeQuery("SELECT COUNT(*),SUM(file_bytes) FROM storage_objects")) {
                assertTrue(rows.next()); assertEquals(3, rows.getLong(1)); assertEquals(150, rows.getLong(2));
            }
            try (var rows = statement.executeQuery("SELECT file_name,file_category,mime_type,source_type FROM storage_objects WHERE object_key='source/original.txt'")) {
                assertTrue(rows.next()); assertEquals("原文.txt", rows.getString(1)); assertEquals("document", rows.getString(2)); assertEquals("text/plain", rows.getString(3)); assertEquals("sourceImport", rows.getString(4));
            }
            try (var rows = statement.executeQuery("SELECT file_name,file_category,source_type FROM storage_objects WHERE object_key='images/original.png'")) {
                assertTrue(rows.next()); assertEquals("original.png", rows.getString(1)); assertEquals("image", rows.getString(2)); assertEquals("unrecorded", rows.getString(3));
            }
        }
    }

    /** 平台存储授权在调用途中撤销后，原对象仍准确登记且容量不丢失。 @throws Exception 测试数据初始化失败时抛出 */
    @Test
    void inFlightUploadRegistersRevokedStorageBeforeReleasingReservation() throws Exception {
        long teamId = userId;
        execute("INSERT INTO teams(id,team_slug,name,member_limit) VALUES(" + teamId + ",'revoked-team-" + teamId + "','撤销授权测试',1);"
                + "INSERT INTO team_members(team_id,user_id,member_role) VALUES(" + teamId + "," + userId + ",'administrator')");
        scoped(service.storeObject(config(storageId), "revoked", 100, () -> "已上传").contextWrite(context -> context.put(TeamScope.IN_FLIGHT_KEY, true)), teamId).block(Duration.ofSeconds(20));
        assertEquals("100", scoped(service.getCapacity(), teamId).block().getString("usedBytes"));
        assertEquals("0", scoped(service.getCapacity(), teamId).block().getString("reservedBytes"));
    }

    /**
     * 平台与团队容量隔离，平台授权存储扣平台钱包，自有存储扣团队钱包。
     * @throws Exception 测试数据初始化失败时抛出
     */
    @Test
    void teamAndPlatformCapacityAndWalletsStayIsolated() throws Exception {
        long teamId = userId;
        String platformPackage = createPackage("2");
        execute("INSERT INTO teams(id,team_slug,name,member_limit) VALUES(" + teamId + ",'storage-team-" + teamId + "','测试团队',2);"
                + "INSERT INTO team_members(team_id,user_id,member_role) VALUES(" + teamId + "," + userId + ",'administrator');"
                + "INSERT INTO user_credit_accounts(user_id,team_id,credit_balance) VALUES(" + userId + "," + teamId + ",50);"
                + "INSERT INTO team_resource_grants(team_id,resource_type,resource_id) VALUES(" + teamId + ",'objectStorage','" + storageId + "');"
                + "INSERT INTO platform_object_storage_configs(storage_id,name,team_id) VALUES('owned-" + userId + "','团队存储'," + teamId + ")");
        scoped(service.purchase(request(platformPackage)), teamId).block(Duration.ofSeconds(20));
        assertEquals("3000000000", run(service.getCapacity()).getString("totalBytes"));
        assertEquals("13000000000", scoped(service.getCapacity(), teamId).block().getString("totalBytes"));
        assertThrows(RuntimeException.class, () -> scoped(service.savePackage(new StorageCapacityDtos.PackageRequest(platformPackage, 1, "越权", 1, BigDecimal.ONE, false)), teamId).block());
        storageId = "owned-" + userId;
        scoped(service.savePackage(new StorageCapacityDtos.PackageRequest(null, null, "团队扩容", 5, new BigDecimal("3"), true)), teamId).block();
        String teamPackage = scoped(service.listPackages(), teamId).block().getJSONArray("packages").getJSONObject(0).getString("id");
        scoped(service.purchase(request(teamPackage)), teamId).block(Duration.ofSeconds(20));
        assertEquals("98.000000", query("SELECT credit_balance FROM user_credit_accounts WHERE user_id=" + userId + " AND team_id=0"));
        assertEquals("47.000000", query("SELECT credit_balance FROM user_credit_accounts WHERE user_id=" + userId + " AND team_id=" + teamId));
        assertEquals("18000000000", scoped(service.getCapacity(), teamId).block().getString("totalBytes"));
        assertEquals(0, scoped(repository.packages(0, false).collectList(), teamId + 1).block().size());
    }
}

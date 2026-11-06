package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.ai.AiHttpClient;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.config.TeamDatabaseConfiguration;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.dto.SharedWorkDtos;
import com.novanovastudio.entity.PersistenceRecords;
import com.novanovastudio.repository.*;
import com.novanovastudio.security.*;
import com.novanovastudio.storage.ObjectStorageService;
import io.r2dbc.spi.ConnectionFactories;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
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
import reactor.core.publisher.Mono;

/**
 * 真实数据库、容量台账及业务服务联测，仅外部对象存储使用内存替身。
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-06 10:00
 */
@Testcontainers
class SharedWorkIntegrationTest {
    /** 独立容器避免污染开发数据。 */
    @Container
    static final PostgreSQLContainer<?> database = new PostgreSQLContainer<>("postgres:17").withDatabaseName("shared_work_test").withUsername("postgres").withPassword("postgres");
    /** 场景隔离标识。 */
    static final AtomicLong identifiers = new AtomicLong(50000);
    private long userId;
    private String storageId;
    private SharedWorkService works;
    private SharedWorkCopyService copies;
    private PersistenceRepository persistence;
    private PersistenceService persistenceService;
    private SharedWorkRepository repository;
    private StorageCapacityService capacity;
    private StorageBillingService billing;
    private ObjectStorageService storage;
    private final Map<String, byte[]> objects = new ConcurrentHashMap<>();

    /** 执行完整生产迁移，检查新增表和策略能实际落地。 */
    @BeforeAll
    static void migrate() { Flyway.configure().dataSource(database.getJdbcUrl(), database.getUsername(), database.getPassword()).load().migrate(); }

    /** @throws Exception 初始化身份或依赖失败时抛出 */
    @BeforeEach
    @SuppressWarnings("unchecked")
    void initialize() throws Exception {
        userId = identifiers.incrementAndGet(); storageId = "shared-storage-" + userId; objects.clear();
        execute("INSERT INTO users(id,username,email,invitation_code) VALUES (" + userId + ",'author-" + userId + "','shared-" + userId + "@example.com','SHARED" + userId + "'); INSERT INTO user_credit_accounts(user_id,team_id,credit_balance) VALUES (" + userId + ",0,100); INSERT INTO platform_object_storage_configs(storage_id,name,team_id) VALUES ('" + storageId + "','分享测试存储',0)");
        var factory = new TeamDatabaseConfiguration.ScopedConnectionFactory(ConnectionFactories.get("r2dbc:postgresql://postgres:postgres@" + database.getHost() + ":" + database.getMappedPort(5432) + "/" + database.getDatabaseName()));
        var client = DatabaseClient.create(factory); var transaction = TransactionalOperator.create(new R2dbcTransactionManager(factory));
        var teams = new TeamRepository(client); var users = new CurrentUserProvider();
        var credits = new CreditRepository(client); var grants = new CreditGrantService(credits, transaction);
        persistence = new PersistenceRepository(client); repository = new SharedWorkRepository(client, teams);
        persistenceService = mock(PersistenceService.class); storage = mock(ObjectStorageService.class);
        var provider = (ObjectProvider<PersistenceService>) mock(ObjectProvider.class); when(provider.getObject()).thenReturn(persistenceService);
        var capacityProvider = (ObjectProvider<StorageCapacityService>) mock(ObjectProvider.class);
        billing = new StorageBillingService(new StorageBillingRepository(client, teams), teams, users, grants, provider, capacityProvider, storage, transaction);
        capacity = new StorageCapacityService(new StorageCapacityRepository(client, teams), teams, credits, grants, users, billing, provider, storage, transaction); when(capacityProvider.getObject()).thenReturn(capacity);
        lenient().when(persistenceService.getPlatformObjectStorageConfig()).thenAnswer(ignored -> Mono.just(config()));
        lenient().when(persistenceService.getObjectStorageForCleanup(anyString())).thenAnswer(ignored -> Mono.just(config()));
        lenient().when(persistenceService.getProject(anyString())).thenAnswer(call -> users.currentUserId().flatMap(id -> persistence.getProject(id, call.getArgument(0)).map(record -> JSON.parseObject(record.getData()))).switchIfEmpty(Mono.error(new BusinessException(com.novanovastudio.common.ErrorCode.RESOURCE_NOT_FOUND, "画布不存在"))));
        lenient().when(persistenceService.saveProject(any())).thenAnswer(call -> saveCanvas(call.getArgument(0)));
        lenient().when(storage.verifyPrivateBucket(any())).thenReturn(true);
        lenient().doAnswer(call -> { objects.put(call.getArgument(1), Files.readAllBytes(call.getArgument(2, Path.class))); return null; }).when(storage).putPrivateObject(any(), anyString(), any(), anyString());
        lenient().when(storage.createReadUrl(any(), anyString(), anyString(), anyString(), anyBoolean(), any())).thenAnswer(call -> "https://private.example/" + call.getArgument(1) + "?expires=" + call.getArgument(5, Instant.class).getEpochSecond());
        var http = mock(AiHttpClient.class);
        lenient().when(http.downloadRemoteMediaToFile(anyString(), anyString(), any(), anyLong())).thenAnswer(call -> Mono.fromCallable(() -> {
            String key = java.net.URI.create(call.getArgument(0)).getPath().substring(1); byte[] bytes = objects.get(key);
            if (bytes == null) throw new IllegalStateException("素材失效"); Files.write(call.getArgument(2, Path.class), bytes);
            return new AiHttpClient.RemoteMediaFile((long) bytes.length, call.getArgument(1));
        }));
        var properties = new NovanovaProperties();
        var media = new SharedWorkMediaService(persistence, persistenceService, repository, storage, billing, http, properties);
        works = new SharedWorkService(repository, persistence, persistenceService, new SharedWorkSnapshotFactory(), media, users, new UserRepository(client), teams, new AdminGuard(users), transaction, billing);
        copies = new SharedWorkCopyService(works, repository, persistence, persistenceService, billing, media, storage, http, properties, users, transaction);
    }

    /** 图片、视频固定副本经过审核后才对访客开放，撤回后停止新授权。 */
    @Test
    void imageAndVideoCompleteSubmissionReviewPublicationAndWithdrawal() {
        for (String type : new String[]{"image", "video"}) {
            String id = "source-" + type;
            var data = SharedWorkSnapshotFactoryTest.generation(type);
            JSONObject media = data.getJSONArray("rounds").getJSONObject(0).getJSONObject("result");
            if (media == null) media = data.getJSONArray("rounds").getJSONObject(0).getJSONArray("results").getJSONObject(0);
            media.getJSONObject(type).remove("storageKey"); media.getJSONObject(type).put("url", "data:" + (type.equals("image") ? "image/png" : "video/mp4") + ";base64,aGVsbG8=");
            var log = new PersistenceRecords.GenerationLogRecord(); log.setId(id); log.setUserId(userId); log.setType(type); log.setTitle("测试结果"); log.setData(data.toJSONString()); log.setGenerationStatus("success");
            run(persistence.saveGenerationLog(log));
            var work = submit("generation", id, type);
            assertEquals("pending", work.status());
            assertThrows(BusinessException.class, () -> works.publicDetail(work.shareCode()).block());
            run(works.review(new SharedWorkDtos.ReviewRequest(work.shareCode(), "approve", "")));
            var detail = works.publicDetail(work.shareCode()).block(); assertNotNull(detail); assertNull(detail.snapshot().get("generation"));
            assertTrue(detail.snapshot().getJSONObject("media").getString("source").startsWith("https://private.example/shared-work/"));
            assertEquals(1, works.fantastic(type, "", "", 1).block().items().size());
            run(persistence.deleteGenerationLogs(userId, java.util.List.of(id)));
            assertNotNull(works.publicDetail(work.shareCode()).block());
            run(works.withdraw(work.shareCode()));
            assertThrows(BusinessException.class, () -> works.publicMedia(work.shareCode(), "asset1").block());
            run(works.cleanup());
            assertTrue(run(repository.media(work.shareCode()).collectList()).isEmpty());
        }
    }

    /** 画布复制重新分配文档、场景与媒体标识，原投稿下架后接收者副本仍保留。 */
    @Test
    void canvasCopyIsIndependentAndPrivateConfigurationIsRemoved() throws Exception {
        var document = SharedWorkSnapshotFactoryTest.canvas();
        document.getJSONObject("scene").getJSONArray("nodes").getJSONObject(1).getJSONObject("content").put("text", "node-1");
        document.getJSONObject("scene").getJSONArray("nodes").getJSONObject(0).getJSONObject("generation").put("references", new JSONArray());
        run(saveCanvas(document));
        var work = submit("canvas", "source", "canvas");
        run(works.review(new SharedWorkDtos.ReviewRequest(work.shareCode(), "approve", "")));
        long recipientId = userId + 100000;
        execute("INSERT INTO users(id,username,email,invitation_code) VALUES (" + recipientId + ",'recipient-" + recipientId + "','recipient-" + recipientId + "@example.com','RCPT" + recipientId + "')");
        var result = scoped(copies.copy(work.shareCode()), recipientId, "user", new TeamScope(55, "member")).block();
        var copied = JSON.parseObject(run(persistence.getProject(recipientId, result.documentId())).getData());
        assertNotEquals("source", copied.getJSONObject("identity").getString("id"));
        var image = copied.getJSONObject("scene").getJSONArray("nodes").getJSONObject(0);
        assertNotEquals("node-1", image.getString("id")); assertEquals("", image.getJSONObject("generation").getString("model"));
        assertTrue(image.getJSONObject("content").getString("storageKey").contains(":shared-copy:"));
        assertEquals("node-1", copied.getJSONObject("scene").getJSONArray("nodes").getJSONObject(1).getJSONObject("content").getString("text"));
        assertEquals(2, objects.size()); assertFalse(copied.toJSONString().contains("secret"));
        run(works.review(new SharedWorkDtos.ReviewRequest(work.shareCode(), "takeDown", "测试下架")));
        assertThrows(BusinessException.class, () -> works.publicDetail(work.shareCode()).block());
        assertNotNull(run(persistence.getProject(recipientId, result.documentId())));
        assertNull(run(persistence.getProject(userId, result.documentId())));
    }

    /** 上传中断不产生可见投稿，容量预占回收，已复制对象交给删除队列。 */
    @Test
    void failedMediaCopyLeavesNoPendingWorkOrReservedCapacity() {
        var document = SharedWorkSnapshotFactoryTest.canvas();
        document.getJSONObject("scene").getJSONArray("nodes").getJSONObject(0).getJSONObject("generation").put("references", new JSONArray());
        run(saveCanvas(document));
        doThrow(new IllegalStateException("模拟上传失败")).when(storage).putPrivateObject(any(), anyString(), any(), anyString());
        assertThrows(RuntimeException.class, () -> submit("canvas", "source", "canvas"));
        assertEquals(0, run(works.list(false, "pending", 1)).total());
        assertEquals(1, run(works.list(false, "failed", 1)).total());
        assertEquals("0", run(capacity.getCapacity()).getString("reservedBytes"));
        assertEquals("0", run(capacity.getCapacity()).getString("usedBytes"));
    }

    /** 团队普通成员不能提交；其他用户不能读取作者草稿或审核，管理员不能跨团队审核。 */
    @Test
    void permissionBoundariesRejectCrossUserAndCrossTeamActions() {
        var document = SharedWorkSnapshotFactoryTest.canvas(); document.getJSONObject("scene").getJSONArray("nodes").getJSONObject(0).getJSONObject("generation").put("references", new JSONArray()); run(saveCanvas(document));
        var work = submit("canvas", "source", "canvas");
        assertThrows(BusinessException.class, () -> scoped(works.preview(form("canvas", "source", "canvas", "")), userId, "user", new TeamScope(9, "member")).block());
        assertThrows(BusinessException.class, () -> scoped(works.detail(work.shareCode()), userId + 100, "user", TeamScope.PLATFORM).block());
        assertThrows(BusinessException.class, () -> scoped(works.review(new SharedWorkDtos.ReviewRequest(work.shareCode(), "approve", "")), userId, "admin", new TeamScope(9, "administrator")).block());
        assertThrows(BusinessException.class, () -> scoped(works.review(new SharedWorkDtos.ReviewRequest(work.shareCode(), "approve", "")), userId, "user", TeamScope.PLATFORM).block());
        run(works.review(new SharedWorkDtos.ReviewRequest(work.shareCode(), "reject", "内容不符合要求")));
        assertEquals("内容不符合要求", run(works.list(false, "rejected", 1)).items().getFirst().reviewReason());
    }

    /** 真实行级策略限定团队来源和审核范围，平台管理员不能越过团队审核。 */
    @Test
    void teamSubmissionAndReviewStayWithinTheirOwnSpace() throws Exception {
        long teamId = userId + 200000;
        execute("INSERT INTO teams(id,team_slug,name,member_limit) VALUES (" + teamId + ",'shared-team-" + teamId + "','分享团队甲',5),(" + (teamId + 1) + ",'shared-team-" + (teamId + 1) + "','分享团队乙',5); INSERT INTO team_members(team_id,user_id,member_role) VALUES (" + teamId + "," + userId + ",'administrator')");
        var document = SharedWorkSnapshotFactoryTest.canvas();
        document.getJSONObject("identity").put("id", "team-source-" + userId);
        var text = document.getJSONObject("scene").getJSONArray("nodes").getJSONObject(1);
        document.getJSONObject("scene").put("nodes", JSONArray.of(text)); document.getJSONObject("scene").put("connections", new JSONArray());
        var scope = new TeamScope(teamId, "administrator");
        scoped(saveCanvas(document), userId, "user", scope).block();
        var request = form("canvas", "team-source-" + userId, "canvas", "");
        assertThrows(BusinessException.class, () -> scoped(works.preview(request), userId, "user", new TeamScope(teamId + 1, "administrator")).block());
        assertThrows(BusinessException.class, () -> scoped(works.preview(request), userId, "admin", new TeamScope(teamId, "member")).block());
        var preview = scoped(works.preview(request), userId, "user", scope).block();
        var accepted = scoped(works.submit(form("canvas", "team-source-" + userId, "canvas", preview.sourceVersion())), userId, "user", scope).block();
        var work = awaitPrepared(accepted.shareCode());
        var approval = new SharedWorkDtos.ReviewRequest(work.shareCode(), "approve", "");
        assertThrows(BusinessException.class, () -> run(works.review(approval)));
        assertThrows(BusinessException.class, () -> scoped(works.review(approval), userId, "user", new TeamScope(teamId + 1, "administrator")).block());
        scoped(works.review(approval), userId, "user", scope).block();
        assertNotNull(works.publicDetail(work.shareCode()).block());
        assertEquals(1, scoped(works.list(true, "published", 1), userId, "user", scope).block().total());
    }

    /** 已上传第一份素材后第二份失败，前者只登记删除，物理删除成功后才释放实际容量。 */
    @Test
    void partialUploadFailureCleansEveryCopyAndReleasesCapacityAfterDeletion() {
        var document = SharedWorkSnapshotFactoryTest.canvas();
        var image = document.getJSONObject("scene").getJSONArray("nodes").getJSONObject(0);
        image.getJSONObject("generation").put("references", JSONArray.of("data:image/png;base64,d29ybGQ="));
        run(saveCanvas(document));
        var calls = new java.util.concurrent.atomic.AtomicInteger();
        doAnswer(call -> { if (call.getArgument(1, String.class).endsWith("/asset1")) throw new IllegalStateException("模拟已上传对象物理删除暂时失败"); return null; }).when(storage).deletePrivateObject(any(), anyString());
        doAnswer(call -> { if (calls.incrementAndGet() == 2) throw new IllegalStateException("第二份素材上传失败"); objects.put(call.getArgument(1), Files.readAllBytes(call.getArgument(2, Path.class))); return null; }).when(storage).putPrivateObject(any(), anyString(), any(), anyString());
        assertThrows(RuntimeException.class, () -> submit("canvas", "source", "canvas"));
        assertEquals(0, run(works.list(false, "pending", 1)).total());
        assertEquals(1, run(works.list(false, "failed", 1)).total());
        assertEquals("0", run(capacity.getCapacity()).getString("reservedBytes"));
        assertEquals("5", run(capacity.getCapacity()).getString("usedBytes"));
        doAnswer(call -> { objects.remove(call.getArgument(1)); return null; }).when(storage).deletePrivateObject(any(), anyString());
        run(billing.deletePendingObjects());
        assertEquals("0", run(capacity.getCapacity()).getString("usedBytes"));
        assertTrue(objects.isEmpty());
    }

    /** 首页查询先筛选再按审核时间倒序分页，每页固定八条，不返回未审核作品。 */
    @Test
    void fantasticWorksFilterAndPaginateOnServer() {
        var document = SharedWorkSnapshotFactoryTest.canvas();
        var text = document.getJSONObject("scene").getJSONArray("nodes").getJSONObject(1);
        document.getJSONObject("scene").put("nodes", JSONArray.of(text)); document.getJSONObject("scene").put("connections", new JSONArray());
        run(saveCanvas(document));
        String keyword = "分页验证" + userId;
        String latest = "";
        for (int index = 0; index < 10; index++) {
            var base = form("canvas", "source", "canvas", "");
            var request = new SharedWorkDtos.SubmitRequest(base.sourceType(), base.sourceId(), base.workType(), base.roundId(), base.resultId(), base.nodeId(), keyword + "-" + index, "", base.category(), false, base.requestId(), "");
            var preview = run(works.preview(request));
            var accepted = run(works.submit(new SharedWorkDtos.SubmitRequest(request.sourceType(), request.sourceId(), request.workType(), request.roundId(), request.resultId(), request.nodeId(), request.title(), request.description(), request.category(), false, request.requestId(), preview.sourceVersion())));
            var work = awaitPrepared(accepted.shareCode());
            if (index < 9) { run(works.review(new SharedWorkDtos.ReviewRequest(work.shareCode(), "approve", ""))); latest = work.shareCode(); }
        }
        var first = run(works.fantastic("canvas", "视觉海报", keyword, 1));
        assertEquals(9, first.total()); assertEquals(8, first.items().size()); assertEquals(latest, first.items().getFirst().shareCode());
        assertEquals(1, works.fantastic("canvas", "视觉海报", keyword, 2).block().items().size());
        assertEquals(0, works.fantastic("image", "视觉海报", keyword, 1).block().total());
        assertEquals(0, works.fantastic("canvas", "游戏美术", keyword, 1).block().total());
    }

    /** 点赞按用户幂等切换，首页默认按点赞总数倒序，未公开或不存在的内容不能点赞。 */
    @Test
    void likesTogglePerUserAndFantasticSortsByLikeCount() throws Exception {
        var document = SharedWorkSnapshotFactoryTest.canvas();
        var text = document.getJSONObject("scene").getJSONArray("nodes").getJSONObject(1);
        document.getJSONObject("scene").put("nodes", JSONArray.of(text)); document.getJSONObject("scene").put("connections", new JSONArray());
        run(saveCanvas(document));
        String keyword = "点赞验证" + userId;
        var older = approve(keyword + "-较早");
        var newer = approve(keyword + "-较新");
        assertEquals(newer.shareCode(), run(works.fantastic("canvas", "视觉海报", keyword, 1)).items().getFirst().shareCode());
        long otherId = userId + 300000;
        execute("INSERT INTO users(id,username,email,invitation_code) VALUES (" + otherId + ",'liker-" + otherId + "','liker-" + otherId + "@example.com','LIKE" + otherId + "')");
        String target = "user:" + older.shareCode();
        assertTrue(run(works.toggleFantasticLike(target)).liked());
        assertEquals(2, run(scoped(works.toggleFantasticLike(target), otherId, "user", TeamScope.PLATFORM)).likeCount());
        var liked = run(works.fantastic("canvas", "视觉海报", keyword, 1));
        assertEquals(older.shareCode(), liked.items().getFirst().shareCode());
        assertEquals(2, liked.items().getFirst().likeCount()); assertTrue(liked.items().getFirst().liked());
        var canceled = run(works.toggleFantasticLike(target));
        assertFalse(canceled.liked()); assertEquals(1, canceled.likeCount());
        assertEquals(newer.shareCode(), run(works.fantastic("canvas", "视觉海报", keyword, 1)).items().get(1).shareCode());
        assertEquals(0, run(scoped(works.toggleFantasticLike(target), otherId, "user", TeamScope.PLATFORM)).likeCount());
        assertEquals(newer.shareCode(), run(works.fantastic("canvas", "视觉海报", keyword, 1)).items().getFirst().shareCode());
        assertThrows(BusinessException.class, () -> run(works.toggleFantasticLike("user:00000000-0000-0000-0000-000000000000")));
        assertThrows(BusinessException.class, () -> run(works.toggleFantasticLike("official:999999999")));
    }

    /** 接收者第二份媒体复制失败时，不保存目标文档，并回收已经复制的媒体及容量。 */
    @Test
    void failedCanvasCopyLeavesNoPartialDocumentOrRecipientMedia() {
        var document = SharedWorkSnapshotFactoryTest.canvas();
        document.getJSONObject("scene").getJSONArray("nodes").getJSONObject(0).getJSONObject("generation").put("references", JSONArray.of("data:image/png;base64,d29ybGQ="));
        run(saveCanvas(document));
        var work = submit("canvas", "source", "canvas");
        run(works.review(new SharedWorkDtos.ReviewRequest(work.shareCode(), "approve", "")));
        String originalUsage = run(capacity.getCapacity()).getString("usedBytes");
        var calls = new java.util.concurrent.atomic.AtomicInteger();
        doAnswer(call -> { if (calls.incrementAndGet() == 2) throw new IllegalStateException("第二份接收者媒体复制失败"); objects.put(call.getArgument(1), Files.readAllBytes(call.getArgument(2, Path.class))); return null; }).when(storage).putPrivateObject(any(), anyString(), any(), anyString());
        doAnswer(call -> { objects.remove(call.getArgument(1)); return null; }).when(storage).deletePrivateObject(any(), anyString());
        assertThrows(RuntimeException.class, () -> run(copies.copy(work.shareCode())));
        assertEquals(1, run(persistence.listProjects(userId).count()));
        assertTrue(run(repository.unfinishedCopies().collectList()).isEmpty());
        assertEquals(originalUsage, run(capacity.getCapacity()).getString("usedBytes"));
        assertEquals("0", run(capacity.getCapacity()).getString("reservedBytes"));
        assertEquals(2, objects.size());
    }

    /** @param title 作品标题 @return 已审核通过的投稿 */
    private SharedWorkDtos.WorkItem approve(String title) {
        var base = form("canvas", "source", "canvas", "");
        var request = new SharedWorkDtos.SubmitRequest(base.sourceType(), base.sourceId(), base.workType(), base.roundId(), base.resultId(), base.nodeId(), title, "", base.category(), false, base.requestId(), "");
        var preview = run(works.preview(request));
        var work = awaitPrepared(run(works.submit(new SharedWorkDtos.SubmitRequest(request.sourceType(), request.sourceId(), request.workType(), request.roundId(), request.resultId(), request.nodeId(), title, "", request.category(), false, request.requestId(), preview.sourceVersion()))).shareCode());
        run(works.review(new SharedWorkDtos.ReviewRequest(work.shareCode(), "approve", "")));
        return work;
    }
    /** @param source 来源类型 @param id 来源记录 @param type 作品类型 @return 后台准备完成的投稿 */
    private SharedWorkDtos.WorkItem submit(String source, String id, String type) { var preview = run(works.preview(form(source, id, type, ""))); return awaitPrepared(run(works.submit(form(source, id, type, preview.sourceVersion()))).shareCode()); }
    /** @param code 已受理投稿 @return 后台准备完成的投稿 @throws IllegalStateException 准备失败或超时时抛出 */
    private SharedWorkDtos.WorkItem awaitPrepared(String code) {
        long deadline = System.nanoTime() + Duration.ofSeconds(20).toNanos();
        while (System.nanoTime() < deadline) {
            if (works.preparationRunning(code)) { pause(); continue; }
            var row = run(repository.find(code).contextWrite(context -> context.put(TeamScope.SYSTEM_KEY, true)));
            if (row == null) { pause(); continue; }
            String status = row.getString("workStatus");
            if ("failed".equals(status) && "0".equals(run(capacity.getCapacity()).getString("reservedBytes"))) throw new IllegalStateException(row.getString("reviewReason"));
            if (!"preparing".equals(status) && !"failed".equals(status)) return new SharedWorkDtos.WorkItem(row.getString("shareCode"), row.getString("title"), row.getString("description"), row.getString("category"), row.getString("creatorName"), row.getString("workType"), status, row.getString("reviewReason"), row.getString("createdAt"), row.getString("publishedAt"), "");
            pause();
        }
        throw new IllegalStateException("分享准备超时");
    }
    /** 等待后台准备推进。 */
    private static void pause() {
        try { Thread.sleep(25); } catch (InterruptedException exception) { Thread.currentThread().interrupt(); throw new IllegalStateException(exception); }
    }
    /** @param source 来源类型 @param id 来源标识 @param type 作品类型 @param version 预览摘要 @return 投稿表单 */
    private SharedWorkDtos.SubmitRequest form(String source, String id, String type, String version) { return new SharedWorkDtos.SubmitRequest(source, id.equals("source") ? id + "-" + userId : id, type, "round", "result", "node-1", "独立分享测试", "", "视觉海报", false, UUID.randomUUID().toString(), version); }
    /** @param document 文档 @return 保存完成信号 */
    private Mono<Void> saveCanvas(JSONObject document) { return new CurrentUserProvider().currentUserId().flatMap(id -> { if ("source".equals(document.getJSONObject("identity").getString("id"))) document.getJSONObject("identity").put("id", "source-" + id); var record = new PersistenceRecords.SnapshotRecord(); record.setId(document.getJSONObject("identity").getString("id")); record.setTitle("测试画布"); record.setUserId(id); record.setData(document.toJSONString()); return persistence.saveProject(record); }); }
    /** @return 不含真实凭据的测试配置 */
    private PersistenceDtos.ObjectStorageConfig config() { return new PersistenceDtos.ObjectStorageConfig("tencentCos", "key", "secret", "bucket", "region", "", "", "", storageId, "测试存储", "", false); }
    /** @param source 业务 @param id 用户 @param role 账号角色 @param scope 空间 @param <T> 结果类型 @return 已绑定身份的业务 */
    private <T> Mono<T> scoped(Mono<T> source, long id, String role, TeamScope scope) { return source.contextWrite(context -> scope.apply(context).put(CurrentUserProvider.CURRENT_USER_CONTEXT_KEY, new CurrentUser(id, "shared@example.com", role, 1))); }
    /** @param source 业务 @param <T> 结果类型 @return 当前作者结果 */
    private <T> T run(Mono<T> source) { return scoped(source, userId, "admin", TeamScope.PLATFORM).block(Duration.ofSeconds(30)); }
    /** @param sql 测试固定SQL @throws Exception 数据库操作失败时抛出 */
    private void execute(String sql) throws Exception { try (var connection = DriverManager.getConnection(database.getJdbcUrl(), database.getUsername(), database.getPassword()); var statement = connection.createStatement()) { statement.execute(sql); } }
}

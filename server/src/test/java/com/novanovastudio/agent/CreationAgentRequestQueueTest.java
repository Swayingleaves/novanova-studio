package com.novanovastudio.agent;

import com.novanovastudio.config.NovanovaProperties;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

/**
 * 统一主Agent请求队列键分区测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-13 00:00
 */
@Testcontainers(disabledWithoutDocker = true)
class CreationAgentRequestQueueTest {

    /** Redis测试容器。 */
    @Container
    private static final GenericContainer<?> redisContainer = new GenericContainer<>(DockerImageName.parse("redis:8.6"))
            .withExposedPorts(6379);

    /** Redis连接工厂。 */
    private LettuceConnectionFactory connectionFactory;

    /** 待测试的主Agent请求队列。 */
    private CreationAgentRequestQueue requestQueue;

    /** 直接设置活动租约的Redis模板。 */
    private ReactiveStringRedisTemplate redisTemplate;

    /**
     * 建立独立 Redis 连接和队列实例。
     */
    @BeforeEach
    void setUp() {
        connectionFactory = new LettuceConnectionFactory(new RedisStandaloneConfiguration(
                redisContainer.getHost(), redisContainer.getMappedPort(6379)));
        connectionFactory.afterPropertiesSet();
        connectionFactory.start();
        NovanovaProperties properties = new NovanovaProperties();
        properties.getAi().getTask().setLockTtlSeconds(30);
        redisTemplate = new ReactiveStringRedisTemplate(connectionFactory);
        requestQueue = new CreationAgentRequestQueue(redisTemplate, properties);
    }

    /**
     * 关闭本次测试的 Redis 连接。
     */
    @AfterEach
    void tearDown() {
        if (connectionFactory != null) {
            connectionFactory.destroy();
        }
    }

    /**
     * 同一用户同一入口的队列键必须落在固定Redis哈希槽。
     */
    @Test
    void shouldBuildPartitionedQueueKeysForSameUserAndEntrySource() {
        Assertions.assertEquals("novanova:creation-agent:queue:{100:imagePage}:pending",
                CreationAgentRequestQueue.pendingQueueKey(100L, "imagePage"));
        Assertions.assertEquals("novanova:creation-agent:queue:{100:imagePage}:queued",
                CreationAgentRequestQueue.queuedRequestKey(100L, "imagePage"));
        Assertions.assertEquals("novanova:creation-agent:queue:{100:imagePage}:active",
                CreationAgentRequestQueue.activeRequestKey(100L, "imagePage"));
        Assertions.assertEquals("novanova:creation-agent:queue:{100:imagePage}:recovery-lock",
                CreationAgentRequestQueue.recoveryKey(100L, "imagePage"));
    }

    /**
     * 不同用户或入口来源不得共享主Agent分区。
     */
    @Test
    void shouldIsolateQueuePartitionsAcrossUsersAndEntrySources() {
        Assertions.assertNotEquals(CreationAgentRequestQueue.pendingQueueKey(100L, "imagePage"),
                CreationAgentRequestQueue.pendingQueueKey(100L, "videoPage"));
        Assertions.assertNotEquals(CreationAgentRequestQueue.pendingQueueKey(100L, "imagePage"),
                CreationAgentRequestQueue.pendingQueueKey(101L, "imagePage"));
    }

    /**
     * 同一分区必须按 FIFO 单槽领取，并且重复入队的运行请求不能重新排队。
     */
    @Test
    void shouldClaimOneRequestAtATimeInFirstInFirstOutOrder() {
        Long userId = 9101L;
        String entrySource = CreationEntrySource.IMAGE_PAGE;

        requestQueue.enqueue(userId, entrySource, "image-request-1").block();
        requestQueue.enqueue(userId, entrySource, "image-request-1").block();
        requestQueue.enqueue(userId, entrySource, "image-request-2").block();

        Assertions.assertEquals(List.of("image-request-1"), requestQueue.claimAvailable(userId, entrySource).collectList().block());
        Assertions.assertEquals(List.of(), requestQueue.claimAvailable(userId, entrySource).collectList().block());
        Assertions.assertTrue(requestQueue.hasActiveRequest(userId, entrySource, "image-request-1").block());
        Assertions.assertTrue(requestQueue.renewActiveRequest(userId, entrySource, "image-request-1").block());

        requestQueue.enqueue(userId, entrySource, "image-request-1").block();
        requestQueue.releaseActiveRequest(userId, entrySource, "image-request-1").block();

        Assertions.assertEquals(List.of("image-request-2"), requestQueue.claimAvailable(userId, entrySource).collectList().block());
        Assertions.assertFalse(requestQueue.renewActiveRequest(userId, entrySource, "image-request-1").block());
    }

    /**
     * 不同入口与不同用户的分区可独立领取，只有同一入口的第二项必须等待。
     */
    @Test
    void shouldAllowDifferentEntrySourcesAndUsersToRunInParallel() {
        Long sameUserId = 9102L;
        Long otherUserId = 9103L;

        requestQueue.enqueue(sameUserId, CreationEntrySource.IMAGE_PAGE, "image-request-1").block();
        requestQueue.enqueue(sameUserId, CreationEntrySource.IMAGE_PAGE, "image-request-2").block();
        requestQueue.enqueue(sameUserId, CreationEntrySource.VIDEO_PAGE, "video-request-1").block();
        requestQueue.enqueue(sameUserId, CreationEntrySource.CANVAS, "canvas-request-1").block();
        requestQueue.enqueue(otherUserId, CreationEntrySource.IMAGE_PAGE, "other-image-request-1").block();

        Assertions.assertEquals(List.of("image-request-1"), requestQueue.claimAvailable(sameUserId, CreationEntrySource.IMAGE_PAGE).collectList().block());
        Assertions.assertEquals(List.of(), requestQueue.claimAvailable(sameUserId, CreationEntrySource.IMAGE_PAGE).collectList().block());
        Assertions.assertEquals(List.of("video-request-1"), requestQueue.claimAvailable(sameUserId, CreationEntrySource.VIDEO_PAGE).collectList().block());
        Assertions.assertEquals(List.of("canvas-request-1"), requestQueue.claimAvailable(sameUserId, CreationEntrySource.CANVAS).collectList().block());
        Assertions.assertEquals(List.of("other-image-request-1"), requestQueue.claimAvailable(otherUserId, CreationEntrySource.IMAGE_PAGE).collectList().block());
    }

    /**
     * 取消排队项只移除指定请求，已运行项及后续 FIFO 顺序保持不变。
     */
    @Test
    void shouldRemoveOnlyCanceledQueuedRequest() {
        Long userId = 9104L;
        String entrySource = CreationEntrySource.IMAGE_PAGE;

        requestQueue.enqueue(userId, entrySource, "image-request-running").block();
        requestQueue.enqueue(userId, entrySource, "image-request-canceled").block();
        requestQueue.enqueue(userId, entrySource, "image-request-next").block();

        Assertions.assertEquals(List.of("image-request-running"), requestQueue.claimAvailable(userId, entrySource).collectList().block());
        requestQueue.removeQueuedRequest(userId, entrySource, "image-request-canceled").block();
        requestQueue.markCancelRequested("image-request-running").block();

        Assertions.assertTrue(requestQueue.isCancelRequested("image-request-running").block());
        Assertions.assertTrue(requestQueue.hasActiveRequest(userId, entrySource, "image-request-running").block());

        requestQueue.releaseActiveRequest(userId, entrySource, "image-request-running").block();

        Assertions.assertEquals(List.of("image-request-next"), requestQueue.claimAvailable(userId, entrySource).collectList().block());
    }

    /**
     * 失租但尚未开始执行的已领取请求必须回到队头，不能让后续请求越过它。
     */
    @Test
    void shouldRequeueExpiredClaimAtQueueHeadBeforeLaterRequests() {
        Long userId = 9105L;
        String entrySource = CreationEntrySource.IMAGE_PAGE;

        requestQueue.enqueue(userId, entrySource, "image-request-first").block();
        requestQueue.enqueue(userId, entrySource, "image-request-next").block();
        Assertions.assertEquals(List.of("image-request-first"),
                requestQueue.claimAvailable(userId, entrySource).collectList().block());

        requestQueue.requeueExpiredClaim(userId, entrySource, "image-request-first").block();

        Assertions.assertEquals(List.of("image-request-first"),
                requestQueue.claimAvailable(userId, entrySource).collectList().block());
        requestQueue.releaseActiveRequest(userId, entrySource, "image-request-first").block();
        Assertions.assertEquals(List.of("image-request-next"),
                requestQueue.claimAvailable(userId, entrySource).collectList().block());
    }

    /**
     * 同一过期请求只能由一个实例领取恢复权；恢复收尾期间不能提前领取同分区后续请求。
     */
    @Test
    void shouldAllowOnlyOneRecoveryClaimAndBlockNextClaimUntilRelease() {
        Long userId = 9106L;
        String entrySource = CreationEntrySource.IMAGE_PAGE;

        requestQueue.enqueue(userId, entrySource, "image-request-running").block();
        requestQueue.enqueue(userId, entrySource, "image-request-next").block();
        Assertions.assertEquals(List.of("image-request-running"),
                requestQueue.claimAvailable(userId, entrySource).collectList().block());

        redisTemplate.opsForZSet().add(CreationAgentRequestQueue.activeRequestKey(userId, entrySource),
                "image-request-running", System.currentTimeMillis() - 1_000).block();

        CreationAgentRequestQueue.RecoveryClaim recoveryClaim = requestQueue
                .claimMissingLeaseRecovery(userId, entrySource, "image-request-running")
                .block();

        Assertions.assertNotNull(recoveryClaim);
        Assertions.assertTrue(requestQueue.renewRecoveryClaim(recoveryClaim).block());
        Assertions.assertTrue(requestQueue
                .claimMissingLeaseRecovery(userId, entrySource, "image-request-running")
                .blockOptional()
                .isEmpty());
        requestQueue.releaseActiveRequest(userId, entrySource, "image-request-running").block();
        Assertions.assertEquals(List.of(), requestQueue.claimAvailable(userId, entrySource).collectList().block());

        requestQueue.releaseRecoveredActiveRequest(recoveryClaim).block();

        Assertions.assertEquals(List.of("image-request-next"),
                requestQueue.claimAvailable(userId, entrySource).collectList().block());
    }

    /**
     * 恢复期间活动租约已被清理时，请求仍必须回到队头并释放恢复锁，避免同分区永久阻塞。
     */
    @Test
    void shouldRequeueRecoveredRequestWhenActiveLeaseWasAlreadyRemoved() {
        Long userId = 9107L;
        String entrySource = CreationEntrySource.IMAGE_PAGE;

        requestQueue.enqueue(userId, entrySource, "image-request-first").block();
        requestQueue.enqueue(userId, entrySource, "image-request-next").block();
        Assertions.assertEquals(List.of("image-request-first"),
                requestQueue.claimAvailable(userId, entrySource).collectList().block());
        redisTemplate.opsForZSet().add(CreationAgentRequestQueue.activeRequestKey(userId, entrySource),
                "image-request-first", System.currentTimeMillis() - 1_000).block();

        CreationAgentRequestQueue.RecoveryClaim recoveryClaim = requestQueue
                .claimMissingLeaseRecovery(userId, entrySource, "image-request-first")
                .block();
        Assertions.assertNotNull(recoveryClaim);
        redisTemplate.opsForZSet().remove(CreationAgentRequestQueue.activeRequestKey(userId, entrySource),
                "image-request-first").block();

        requestQueue.requeueRecoveredClaim(recoveryClaim).block();

        Assertions.assertEquals(List.of("image-request-first"),
                requestQueue.claimAvailable(userId, entrySource).collectList().block());
        requestQueue.releaseActiveRequest(userId, entrySource, "image-request-first").block();
        Assertions.assertEquals(List.of("image-request-next"),
                requestQueue.claimAvailable(userId, entrySource).collectList().block());
    }
}

package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.novanovastudio.common.BusinessException;
import java.time.Duration;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.data.redis.core.ReactiveValueOperations;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

/**
 * OAuth2一次性登录码服务测试
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-15 00:00
 */
class OAuth2LoginCodeServiceTest {

    /**
     * 验证Redis只保存登录码哈希。
     */
    @Test
    @DisplayName("创建登录码时Redis键不包含原始登录码")
    void shouldStoreHashedLoginCode() {
        ReactiveStringRedisTemplate redisTemplate = mock(ReactiveStringRedisTemplate.class);
        ReactiveValueOperations<String, String> valueOperations = mock(ReactiveValueOperations.class);
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(valueOperations.set(anyString(), eq("8"), any(Duration.class))).thenReturn(Mono.just(true));
        OAuth2LoginCodeService service = new OAuth2LoginCodeService(redisTemplate);

        String loginCode = service.create(8L).block();

        ArgumentCaptor<String> keyCaptor = ArgumentCaptor.forClass(String.class);
        verify(valueOperations).set(keyCaptor.capture(), eq("8"), any(Duration.class));
        assertFalse(keyCaptor.getValue().contains(loginCode));
    }

    /**
     * 验证一次性登录码只能消费一次。
     */
    @Test
    @DisplayName("一次性登录码重复消费时失败")
    void shouldConsumeLoginCodeOnlyOnce() {
        ReactiveStringRedisTemplate redisTemplate = mock(ReactiveStringRedisTemplate.class);
        ReactiveValueOperations<String, String> valueOperations = mock(ReactiveValueOperations.class);
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(valueOperations.getAndDelete(anyString())).thenReturn(Mono.just("8"), Mono.empty());
        OAuth2LoginCodeService service = new OAuth2LoginCodeService(redisTemplate);

        StepVerifier.create(service.consume("one-time-code")).expectNext(8L).verifyComplete();
        StepVerifier.create(service.consume("one-time-code")).expectError(BusinessException.class).verify();
    }
}

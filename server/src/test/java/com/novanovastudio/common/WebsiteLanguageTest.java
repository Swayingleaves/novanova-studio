package com.novanovastudio.common;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.Locale;
import org.junit.jupiter.api.Test;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import reactor.core.publisher.Flux;
import reactor.test.StepVerifier;

/**
 * 网站语言优先级和响应式并发隔离测试。
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-16 00:00
 */
class WebsiteLanguageTest {

    /** 验证语言权重、零权重与未支持语言的默认值。 */
    @Test
    void shouldSelectSupportedLanguageByWeight() {
        assertEquals(Locale.ENGLISH, WebsiteLanguage.fromHeader("en-US,en;q=0.9,zh-CN;q=0.8"));
        assertEquals(Locale.SIMPLIFIED_CHINESE, WebsiteLanguage.fromHeader("en;q=0.5,zh-CN;q=0.9"));
        assertEquals(Locale.ENGLISH, WebsiteLanguage.fromHeader("zh;q=0,en;q=1"));
        assertEquals(Locale.SIMPLIFIED_CHINESE, WebsiteLanguage.fromHeader("fr-FR"));
    }

    /** 验证原生事件订阅的显式语言优先于浏览器请求头。 */
    @Test
    void shouldUseExplicitSubscriptionLanguage() {
        var request = MockServerHttpRequest.get("/api/v1/ai/agent/events?locale=en").header("Accept-Language", "zh-CN");
        assertEquals(Locale.ENGLISH, WebsiteLanguage.resolve(MockServerWebExchange.from(request)));
    }

    /** 验证同时执行的中英文订阅没有共享可变语言状态。 */
    @Test
    void shouldIsolateConcurrentReactiveLanguages() {
        var chinese = WebsiteLanguage.current().map(locale -> SystemMessage.of("system.taskCanceled").render(locale))
                .contextWrite(context -> context.put(WebsiteLanguage.CONTEXT_KEY, Locale.SIMPLIFIED_CHINESE));
        var english = WebsiteLanguage.current().map(locale -> SystemMessage.of("system.taskCanceled").render(locale))
                .contextWrite(context -> context.put(WebsiteLanguage.CONTEXT_KEY, Locale.ENGLISH));
        StepVerifier.create(Flux.merge(chinese.delaySubscription(java.time.Duration.ofMillis(10)),
                        english.subscribeOn(reactor.core.scheduler.Schedulers.parallel())).collectList())
                .assertNext(messages -> {
                    assertEquals(2, messages.size());
                    org.junit.jupiter.api.Assertions.assertTrue(messages.contains("任务已取消"));
                    org.junit.jupiter.api.Assertions.assertTrue(messages.contains("Task canceled"));
                }).verifyComplete();
    }
}

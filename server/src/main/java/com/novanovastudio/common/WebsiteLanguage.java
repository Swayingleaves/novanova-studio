package com.novanovastudio.common;

import java.util.List;
import java.util.Locale;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

/**
 * 网站请求语言解析，禁止将用户语言存入全局变量或线程局部变量。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-16 00:00
 */
public final class WebsiteLanguage {

    /** Reactor上下文键。 */
    public static final String CONTEXT_KEY = WebsiteLanguage.class.getName();

    /**
     * 禁止实例化。
     */
    private WebsiteLanguage() {
    }

    /**
     * 从订阅参数或请求头选择语言。
     *
     * @param exchange ServerWebExchange 当前请求
     * @return Locale 当前请求语言
     */
    public static Locale resolve(ServerWebExchange exchange) {
        String path = exchange.getRequest().getPath().value();
        if (path.equals("/api/v1/ai/task/subscribe") || path.equals("/api/v1/ai/agent/events")) {
            String explicit = exchange.getRequest().getQueryParams().getFirst("locale");
            if ("en".equals(explicit)) return Locale.ENGLISH;
            if ("zh-cn".equals(explicit)) return Locale.SIMPLIFIED_CHINESE;
        }
        return fromHeader(exchange.getRequest().getHeaders().getFirst("Accept-Language"));
    }

    /**
     * 根据标准语言权重匹配中文和英文，其他语言使用简体中文。
     *
     * @param header String Accept-Language请求头
     * @return Locale 支持的语言
     */
    public static Locale fromHeader(String header) {
        if (header == null || header.isBlank()) return Locale.SIMPLIFIED_CHINESE;
        List<Locale.LanguageRange> ranges;
        try {
            ranges = Locale.LanguageRange.parse(header);
        } catch (IllegalArgumentException exception) {
            return Locale.SIMPLIFIED_CHINESE;
        }
        for (Locale.LanguageRange range : ranges) {
            if (range.getWeight() <= 0) continue;
            String language = range.getRange();
            if (language.equals("en") || language.startsWith("en-")) return Locale.ENGLISH;
            if (language.equals("zh") || language.startsWith("zh-")) return Locale.SIMPLIFIED_CHINESE;
        }
        return Locale.SIMPLIFIED_CHINESE;
    }

    /**
     * 读取当前响应式订阅的语言。
     *
     * @return Mono<Locale> 当前请求语言
     */
    public static Mono<Locale> current() {
        return Mono.deferContextual(context -> Mono.just(context.getOrDefault(CONTEXT_KEY, Locale.SIMPLIFIED_CHINESE)));
    }
}

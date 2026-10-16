package com.novanovastudio.config;

import com.novanovastudio.common.SystemMessage;
import com.novanovastudio.common.WebsiteLanguage;
import org.springframework.context.MessageSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.web.server.WebFilter;

/**
 * 网站双语资源与WebFlux语言上下文配置。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-16 00:00
 */
@Configuration
public class WebsiteLanguageConfiguration {

    /**
     * 注册系统消息源。
     *
     * @return MessageSource 完整双语消息资源
     */
    @Bean
    public MessageSource messageSource() {
        return SystemMessage.messageSource();
    }

    /**
     * 在鉴权前绑定请求语言，保证并发请求和事件订阅互不干扰。
     *
     * @return WebFilter 请求语言过滤器
     */
    @Bean
    @Order(Ordered.HIGHEST_PRECEDENCE + 1)
    public WebFilter websiteLanguageFilter() {
        return (exchange, chain) -> {
            java.util.Locale locale = WebsiteLanguage.resolve(exchange);
            exchange.getResponse().getHeaders().setContentLanguage(locale);
            return chain.filter(exchange).contextWrite(context -> context.put(WebsiteLanguage.CONTEXT_KEY, locale));
        };
    }
}

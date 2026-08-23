package com.novanovastudio.security;

import com.novanovastudio.config.NovanovaProperties;
import java.net.InetSocketAddress;
import lombok.RequiredArgsConstructor;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/**
 * @title        ClientAddressResolver.java
 * @description  可信代理感知的客户端地址解析
 * @createTime   2026-08-23
 */
@Component
@RequiredArgsConstructor
public class ClientAddressResolver {

    /** 服务配置 */
    private final NovanovaProperties properties;

    /**
     * 解析可信代理转发后的客户端地址。
     *
     * @param request ServerHttpRequest HTTP 请求
     * @return String 客户端来源地址
     */
    public String resolve(ServerHttpRequest request) {
        InetSocketAddress remoteAddress = request.getRemoteAddress();
        if (remoteAddress == null || remoteAddress.getAddress() == null) {
            return "unknown";
        }
        String directAddress = remoteAddress.getAddress().getHostAddress();
        if (!TrustedProxyMatcher.isTrustedProxyAddress(properties.getApp().getTrustedProxyAddresses(), directAddress)) {
            return directAddress;
        }
        String forwardedFor = request.getHeaders().getFirst("X-Forwarded-For");
        if (!StringUtils.hasText(forwardedFor)) {
            return directAddress;
        }
        String[] addresses = forwardedFor.split(",");
        for (int index = addresses.length - 1; index >= 0; index--) {
            String address = addresses[index].trim();
            if (!TrustedProxyMatcher.isLiteralIpAddress(address)) {
                return directAddress;
            }
            if (!TrustedProxyMatcher.isTrustedProxyAddress(properties.getApp().getTrustedProxyAddresses(), address)) {
                return address;
            }
        }
        return directAddress;
    }
}

package com.novanovastudio.security;

import com.novanovastudio.config.NovanovaProperties;
import java.net.InetSocketAddress;
import java.util.Arrays;
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
        if (!isTrustedProxyAddress(directAddress)) {
            return directAddress;
        }
        String forwardedFor = request.getHeaders().getFirst("X-Forwarded-For");
        if (!StringUtils.hasText(forwardedFor)) {
            return directAddress;
        }
        String[] addresses = forwardedFor.split(",");
        for (int index = addresses.length - 1; index >= 0; index--) {
            String address = addresses[index].trim();
            if (!isLiteralIpAddress(address)) {
                return directAddress;
            }
            if (!isTrustedProxyAddress(address)) {
                return address;
            }
        }
        return directAddress;
    }

    /**
     * 判断地址是否属于已配置的可信反向代理。
     *
     * @param address String 待判断地址
     * @return boolean 是否可信反向代理地址
     */
    private boolean isTrustedProxyAddress(String address) {
        return Arrays.stream(properties.getApp().getTrustedProxyAddresses().split(","))
                .map(String::trim)
                .filter(StringUtils::hasText)
                .anyMatch(address::equals);
    }

    /**
     * 判断请求头地址是否为 IPv4 或 IPv6 字面量。
     *
     * @param address String 待判断地址
     * @return boolean 是否为合法 IP 字面量
     */
    private boolean isLiteralIpAddress(String address) {
        return address.matches("[0-9a-fA-F:.]+");
    }
}

package com.novanovastudio.security;

import java.net.InetAddress;
import java.util.Arrays;
import org.springframework.util.StringUtils;

/**
 * @title        TrustedProxyMatcher.java
 * @description  可信代理地址匹配工具：列表项支持单个 IP（IPv4/IPv6）与 CIDR 段（如 172.18.0.0/16）
 * @createTime   2026-08-24
 */
public final class TrustedProxyMatcher {

    /** 禁止实例化 */
    private TrustedProxyMatcher() {
    }

    /**
     * 判断直连地址是否命中可信代理列表。
     *
     * @param trustedList String 可信代理列表（逗号分隔，每项为 IP 字面量或 CIDR）
     * @param address     String 待判断的 IP 字面量
     * @return boolean 是否命中可信代理
     */
    public static boolean isTrustedProxyAddress(String trustedList, String address) {
        if (!StringUtils.hasText(trustedList) || !StringUtils.hasText(address)) {
            return false;
        }
        return Arrays.stream(trustedList.split(","))
                .map(String::trim)
                .filter(StringUtils::hasText)
                .anyMatch(entry -> matches(entry, address));
    }

    /**
     * 判断地址是否为 IPv4 或 IPv6 字面量。
     *
     * @param address String 待判断地址
     * @return boolean 是否为合法 IP 字面量
     */
    public static boolean isLiteralIpAddress(String address) {
        return StringUtils.hasText(address) && address.matches("[0-9a-fA-F:.]+");
    }

    /**
     * 判断单个 IP 字面量是否命中列表条目（IP 或 IP/CIDR）。
     *
     * @param entry     String 列表条目
     * @param ipLiteral String IP 字面量
     * @return boolean 是否命中
     */
    private static boolean matches(String entry, String ipLiteral) {
        try {
            String[] parts = entry.split("/", 2);
            if (!isLiteralIpAddress(parts[0])) {
                return false;
            }
            byte[] addressBytes = InetAddress.getByName(ipLiteral).getAddress();
            byte[] networkBytes = InetAddress.getByName(parts[0]).getAddress();
            if (addressBytes.length != networkBytes.length) {
                // IPv4 与 IPv6 互不匹配
                return false;
            }
            int prefix = parts.length == 2 ? parsePrefix(parts[1], addressBytes.length * 8) : addressBytes.length * 8;
            if (prefix < 0) {
                return false;
            }
            int fullBytes = prefix / 8;
            for (int i = 0; i < fullBytes; i++) {
                if (addressBytes[i] != networkBytes[i]) {
                    return false;
                }
            }
            int remainder = prefix % 8;
            if (remainder > 0) {
                int mask = 0xFF << (8 - remainder);
                if ((addressBytes[fullBytes] & mask) != (networkBytes[fullBytes] & mask)) {
                    return false;
                }
            }
            return true;
        } catch (Exception exception) {
            return false;
        }
    }

    /**
     * 解析 CIDR 前缀长度。
     *
     * @param value  String 前缀长度文本
     * @param maxBits int 最大位数（IPv4 为 32，IPv6 为 128）
     * @return int 合法前缀长度，非法返回 -1
     */
    private static int parsePrefix(String value, int maxBits) {
        try {
            int prefix = Integer.parseInt(value);
            return prefix >= 0 && prefix <= maxBits ? prefix : -1;
        } catch (NumberFormatException exception) {
            return -1;
        }
    }
}

package com.novanovastudio.security.oauth2;

import java.util.List;
import java.util.Optional;

/**
 * 内置第三方 OAuth2 登录渠道目录。
 * <p>
 * 渠道标识、展示名称与回调路径属于代码固定值，凭据与启用状态由管理后台配置保存在数据库中。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-09 12:00
 */
public final class OAuth2ProviderCatalog {

    /** Google 登录渠道定义 */
    public static final ProviderDefinition GOOGLE = new ProviderDefinition("google", "Google", "/api/v1/auth/oauth/callback/google");

    /** linux.do 登录渠道定义 */
    public static final ProviderDefinition LINUX_DO = new ProviderDefinition("linuxDo", "LINUX DO", "/api/v1/auth/oauth/callback/linuxDo");

    /** 全部内置登录渠道，顺序与后台配置页展示顺序一致 */
    public static final List<ProviderDefinition> ALL = List.of(GOOGLE, LINUX_DO);

    private OAuth2ProviderCatalog() {
    }

    /**
     * 按渠道标识查询内置渠道定义。
     *
     * @param providerId String 渠道标识
     * @return Optional<ProviderDefinition> 渠道定义，不存在时为空
     */
    public static Optional<ProviderDefinition> find(String providerId) {
        return ALL.stream().filter(definition -> definition.providerId().equals(providerId)).findFirst();
    }

    /**
     * 内置登录渠道定义。
     *
     * @param providerId String 渠道标识
     * @param displayName String 渠道展示名称
     * @param callbackPath String 回调接口路径
     */
    public record ProviderDefinition(String providerId, String displayName, String callbackPath) {
    }
}

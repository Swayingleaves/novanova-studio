package com.novanovastudio.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * 平台支付配置的请求和响应。私钥和 APIv3 密钥只返回是否已设置。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-10 10:40
 */
public final class PaymentSettingsDtos {

    private PaymentSettingsDtos() {
    }

    /**
     * 管理后台可见的支付配置。密钥材料只返回是否已保存。
     *
     * @param alipay AlipaySettings 支付宝配置
     * @param wechat WechatSettings 微信支付配置
     */
    public record PaymentSettings(AlipaySettings alipay, WechatSettings wechat) {
    }

    /**
     * 管理后台可见的支付宝配置。
     *
     * @param enabled 是否启用
     * @param appId 应用标识
     * @param privateKeyConfigured 是否已保存应用私钥
     * @param publicKeyConfigured 是否已保存支付宝公钥
     * @param gatewayUrl 网关地址
     * @param notifyUrl 异步通知地址
     * @param returnUrl 同步回跳地址
     */
    public record AlipaySettings(boolean enabled, String appId, boolean privateKeyConfigured, boolean publicKeyConfigured,
                                  String gatewayUrl, String notifyUrl, String returnUrl) {
    }

    /**
     * 管理后台可见的微信支付配置。
     *
     * @param enabled 是否启用
     * @param appId 应用标识
     * @param merchantId 商户号
     * @param merchantSerialNumber 商户 API 证书序列号
     * @param privateKeyConfigured 是否已保存商户私钥
     * @param apiV3KeyConfigured 是否已保存 APIv3 密钥
     * @param publicKeyConfigured 是否已保存微信支付公钥
     * @param publicKeyId 微信支付公钥 ID
     * @param notifyUrl 支付通知地址
     */
    public record WechatSettings(boolean enabled, String appId, String merchantId, String merchantSerialNumber,
                                  boolean privateKeyConfigured, boolean apiV3KeyConfigured, boolean publicKeyConfigured,
                                  String publicKeyId, String notifyUrl) {
    }

    /**
     * 保存支付宝配置。私钥和公钥留空时保留已保存的值。
     *
     * @param enabled 是否启用
     * @param appId 应用标识
     * @param privateKey 应用私钥，留空表示不修改
     * @param publicKey 支付宝公钥，留空表示不修改
     * @param gatewayUrl 网关地址
     * @param notifyUrl 异步通知地址
     * @param returnUrl 同步回跳地址
     */
    public record UpdateAlipaySettings(
            @NotNull(message = "business.alipaySettingsIncomplete")
            Boolean enabled,
            @Size(max = 64, message = "business.alipayAppIdInvalid")
            String appId,
            @Size(max = 8000, message = "business.alipayPrivateKeyInvalid")
            String privateKey,
            @Size(max = 8000, message = "business.alipayPublicKeyInvalid")
            String publicKey,
            @Size(max = 255, message = "business.alipayGatewayInvalid")
            String gatewayUrl,
            @Size(max = 500, message = "business.alipayNotifyUrlInvalid")
            String notifyUrl,
            @Size(max = 500, message = "business.alipayReturnUrlInvalid")
            String returnUrl) {
    }

    /**
     * 保存微信支付配置。私钥、公钥和 APIv3 密钥留空时保留已保存的值。
     *
     * @param enabled 是否启用
     * @param appId 应用标识
     * @param merchantId 商户号
     * @param merchantSerialNumber 商户 API 证书序列号
     * @param privateKey 商户 API 私钥 PEM，留空表示不修改
     * @param apiV3Key APIv3 密钥，留空表示不修改
     * @param publicKey 微信支付公钥 PEM，留空表示不修改
     * @param publicKeyId 微信支付公钥 ID
     * @param notifyUrl 支付通知地址
     */
    public record UpdateWechatSettings(
            @NotNull(message = "business.wechatSettingsIncomplete")
            Boolean enabled,
            @Size(max = 64, message = "business.wechatAppIdInvalid")
            String appId,
            @Size(max = 32, message = "business.wechatMerchantIdInvalid")
            String merchantId,
            @Size(max = 64, message = "business.wechatSerialNumberInvalid")
            String merchantSerialNumber,
            @Size(max = 8000, message = "business.wechatPrivateKeyInvalid")
            String privateKey,
            @Size(max = 128, message = "business.wechatApiV3KeyInvalid")
            String apiV3Key,
            @Size(max = 8000, message = "business.wechatPublicKeyInvalid")
            String publicKey,
            @Size(max = 64, message = "business.wechatPublicKeyIdInvalid")
            String publicKeyId,
            @Size(max = 500, message = "business.wechatNotifyUrlInvalid")
            String notifyUrl) {
    }
}

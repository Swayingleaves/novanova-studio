package com.novanovastudio.repository;

import java.time.OffsetDateTime;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Mono;

/**
 * 平台支付配置数据访问。私钥和 APIv3 密钥列保存的是密文。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-10 10:40
 */
@Repository
public class PaymentSettingsRepository {

    /** 查询和回写共用的列。 */
    private static final String COLUMNS = """
            alipay_enabled, alipay_app_id, alipay_private_key, alipay_public_key, alipay_gateway_url, alipay_notify_url, alipay_return_url,
            wechat_enabled, wechat_app_id, wechat_merchant_id, wechat_merchant_serial_number, wechat_private_key, wechat_api_v3_key,
            wechat_public_key, wechat_public_key_id, wechat_notify_url, updated_at
            """;

    /** 数据库客户端。 */
    private final DatabaseClient databaseClient;

    /**
     * 构造支付配置仓储。
     *
     * @param databaseClient DatabaseClient 数据库客户端
     */
    public PaymentSettingsRepository(DatabaseClient databaseClient) {
        this.databaseClient = databaseClient;
    }

    /**
     * 读取唯一的支付配置。
     *
     * @return Mono<PaymentSettingsRow> 配置和更新时间
     */
    public Mono<PaymentSettingsRow> find() {
        return databaseClient.sql("SELECT " + COLUMNS + " FROM platform_payment_settings WHERE id = 1")
                .map((row, metadata) -> mapRow(row))
                .one();
    }

    /**
     * 更新支付宝配置，微信支付列保持不变。
     *
     * @param settings StoredPaymentSettings 待保存的整行，支付宝私钥必须已经加密
     * @return Mono<PaymentSettingsRow> 落库后的整行
     */
    public Mono<PaymentSettingsRow> updateAlipay(StoredPaymentSettings settings) {
        return databaseClient.sql("""
                        UPDATE platform_payment_settings
                        SET alipay_enabled = :alipayEnabled,
                            alipay_app_id = :alipayAppId,
                            alipay_private_key = :alipayPrivateKey,
                            alipay_public_key = :alipayPublicKey,
                            alipay_gateway_url = :alipayGatewayUrl,
                            alipay_notify_url = :alipayNotifyUrl,
                            alipay_return_url = :alipayReturnUrl,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = 1
                        RETURNING
                        """ + COLUMNS)
                .bind("alipayEnabled", settings.alipayEnabled())
                .bind("alipayAppId", settings.alipayAppId())
                .bind("alipayPrivateKey", settings.alipayPrivateKey())
                .bind("alipayPublicKey", settings.alipayPublicKey())
                .bind("alipayGatewayUrl", settings.alipayGatewayUrl())
                .bind("alipayNotifyUrl", settings.alipayNotifyUrl())
                .bind("alipayReturnUrl", settings.alipayReturnUrl())
                .map((row, metadata) -> mapRow(row))
                .one();
    }

    /**
     * 更新微信支付配置，支付宝列保持不变。
     *
     * @param settings StoredPaymentSettings 待保存的整行，微信私钥和 APIv3 密钥必须已经加密
     * @return Mono<PaymentSettingsRow> 落库后的整行
     */
    public Mono<PaymentSettingsRow> updateWechat(StoredPaymentSettings settings) {
        return databaseClient.sql("""
                        UPDATE platform_payment_settings
                        SET wechat_enabled = :wechatEnabled,
                            wechat_app_id = :wechatAppId,
                            wechat_merchant_id = :wechatMerchantId,
                            wechat_merchant_serial_number = :wechatMerchantSerialNumber,
                            wechat_private_key = :wechatPrivateKey,
                            wechat_api_v3_key = :wechatApiV3Key,
                            wechat_public_key = :wechatPublicKey,
                            wechat_public_key_id = :wechatPublicKeyId,
                            wechat_notify_url = :wechatNotifyUrl,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = 1
                        RETURNING
                        """ + COLUMNS)
                .bind("wechatEnabled", settings.wechatEnabled())
                .bind("wechatAppId", settings.wechatAppId())
                .bind("wechatMerchantId", settings.wechatMerchantId())
                .bind("wechatMerchantSerialNumber", settings.wechatMerchantSerialNumber())
                .bind("wechatPrivateKey", settings.wechatPrivateKey())
                .bind("wechatApiV3Key", settings.wechatApiV3Key())
                .bind("wechatPublicKey", settings.wechatPublicKey())
                .bind("wechatPublicKeyId", settings.wechatPublicKeyId())
                .bind("wechatNotifyUrl", settings.wechatNotifyUrl())
                .map((row, metadata) -> mapRow(row))
                .one();
    }

    /**
     * 把查询行映射为支付配置。
     *
     * @param row io.r2dbc.spi.Row 数据行
     * @return PaymentSettingsRow 配置和更新时间
     */
    private static PaymentSettingsRow mapRow(io.r2dbc.spi.Row row) {
        return new PaymentSettingsRow(new StoredPaymentSettings(
                Boolean.TRUE.equals(row.get("alipay_enabled", Boolean.class)),
                row.get("alipay_app_id", String.class),
                row.get("alipay_private_key", String.class),
                row.get("alipay_public_key", String.class),
                row.get("alipay_gateway_url", String.class),
                row.get("alipay_notify_url", String.class),
                row.get("alipay_return_url", String.class),
                Boolean.TRUE.equals(row.get("wechat_enabled", Boolean.class)),
                row.get("wechat_app_id", String.class),
                row.get("wechat_merchant_id", String.class),
                row.get("wechat_merchant_serial_number", String.class),
                row.get("wechat_private_key", String.class),
                row.get("wechat_api_v3_key", String.class),
                row.get("wechat_public_key", String.class),
                row.get("wechat_public_key_id", String.class),
                row.get("wechat_notify_url", String.class)),
                row.get("updated_at", OffsetDateTime.class));
    }

    /**
     * 数据库中的支付配置。私钥和 APIv3 密钥是密文或空字符串，公钥是原文或空字符串。
     *
     * @param alipayEnabled 是否启用支付宝
     * @param alipayAppId 支付宝应用标识
     * @param alipayPrivateKey 加密后的应用私钥
     * @param alipayPublicKey 支付宝公钥
     * @param alipayGatewayUrl 支付宝网关地址
     * @param alipayNotifyUrl 支付宝通知地址
     * @param alipayReturnUrl 支付宝回跳地址
     * @param wechatEnabled 是否启用微信支付
     * @param wechatAppId 微信应用标识
     * @param wechatMerchantId 微信商户号
     * @param wechatMerchantSerialNumber 商户证书序列号
     * @param wechatPrivateKey 加密后的商户私钥
     * @param wechatApiV3Key 加密后的 APIv3 密钥
     * @param wechatPublicKey 微信支付公钥
     * @param wechatPublicKeyId 微信支付公钥 ID
     * @param wechatNotifyUrl 微信支付通知地址
     */
    public record StoredPaymentSettings(boolean alipayEnabled, String alipayAppId, String alipayPrivateKey, String alipayPublicKey,
                                         String alipayGatewayUrl, String alipayNotifyUrl, String alipayReturnUrl,
                                         boolean wechatEnabled, String wechatAppId, String wechatMerchantId, String wechatMerchantSerialNumber,
                                         String wechatPrivateKey, String wechatApiV3Key, String wechatPublicKey, String wechatPublicKeyId,
                                         String wechatNotifyUrl) {
    }

    /**
     * 支付配置和它的更新时间。
     *
     * @param settings StoredPaymentSettings 支付配置
     * @param updatedAt OffsetDateTime 更新时间
     */
    public record PaymentSettingsRow(StoredPaymentSettings settings, OffsetDateTime updatedAt) {
    }
}

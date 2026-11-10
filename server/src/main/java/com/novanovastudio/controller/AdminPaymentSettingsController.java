package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.PaymentSettingsDtos;
import com.novanovastudio.security.RequireRole;
import com.novanovastudio.service.PaymentSettingsService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * 平台管理员支付配置接口。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-10 10:40
 */
@RestController
@RequiredArgsConstructor
@RequireRole("admin")
@RequestMapping("/api/v1/admin/payment")
public class AdminPaymentSettingsController {

    /** 支付配置服务。 */
    private final PaymentSettingsService paymentSettingsService;

    /**
     * 读取支付宝和微信支付配置。响应不包含密钥明文。
     *
     * @return Mono<ApiResponse<PaymentSettings>> 支付配置
     */
    @GetMapping("/getPaymentSettings")
    public Mono<ApiResponse<PaymentSettingsDtos.PaymentSettings>> getPaymentSettings() {
        return paymentSettingsService.getSettings().map(ApiResponse::ok);
    }

    /**
     * 保存支付宝配置。私钥和公钥留空时保留已保存的值。
     *
     * @param request UpdateAlipaySettings 支付宝配置
     * @return Mono<ApiResponse<PaymentSettings>> 保存后的支付配置
     */
    @PostMapping("/updateAlipaySettings")
    public Mono<ApiResponse<PaymentSettingsDtos.PaymentSettings>> updateAlipaySettings(
            @Valid @RequestBody PaymentSettingsDtos.UpdateAlipaySettings request) {
        return paymentSettingsService.updateAlipay(request).map(ApiResponse::ok);
    }

    /**
     * 保存微信支付配置。私钥、公钥和 APIv3 密钥留空时保留已保存的值。
     *
     * @param request UpdateWechatSettings 微信支付配置
     * @return Mono<ApiResponse<PaymentSettings>> 保存后的支付配置
     */
    @PostMapping("/updateWechatSettings")
    public Mono<ApiResponse<PaymentSettingsDtos.PaymentSettings>> updateWechatSettings(
            @Valid @RequestBody PaymentSettingsDtos.UpdateWechatSettings request) {
        return paymentSettingsService.updateWechat(request).map(ApiResponse::ok);
    }
}

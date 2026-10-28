package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.PaymentDtos;
import com.novanovastudio.security.AdminGuard;
import com.novanovastudio.security.RequireRole;
import com.novanovastudio.service.CreditPurchaseService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * 平台积分商品管理接口。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-10-27 14:40
 */
@RestController
@RequestMapping("/api/v1/config/creditProduct")
@RequireRole("admin")
@RequiredArgsConstructor
public class CreditProductConfigController {

    /** 积分购买服务。 */
    private final CreditPurchaseService purchaseService;
    /** 管理员权限校验。 */
    private final AdminGuard adminGuard;

    /**
     * 查询全部积分商品。
     *
     * @return Mono<ApiResponse<List<CreditProductResponse>>> 商品列表
     */
    @GetMapping("/listCreditProducts")
    public Mono<ApiResponse<List<PaymentDtos.CreditProductResponse>>> listProducts() {
        return adminGuard.requireAdmin().then(purchaseService.listAllProducts()).map(ApiResponse::ok);
    }

    /**
     * 新增积分商品。
     *
     * @param request CreateCreditProductRequest 商品参数
     * @return Mono<ApiResponse<CreditProductResponse>> 新商品
     */
    @PostMapping("/createCreditProduct")
    public Mono<ApiResponse<PaymentDtos.CreditProductResponse>> createProduct(@Valid @RequestBody PaymentDtos.CreateCreditProductRequest request) {
        return adminGuard.requireAdmin().then(purchaseService.createProduct(request)).map(ApiResponse::ok);
    }

    /**
     * 编辑积分商品。
     *
     * @param request UpdateCreditProductRequest 商品参数
     * @return Mono<ApiResponse<CreditProductResponse>> 修改后的商品
     */
    @PostMapping("/updateCreditProduct")
    public Mono<ApiResponse<PaymentDtos.CreditProductResponse>> updateProduct(@Valid @RequestBody PaymentDtos.UpdateCreditProductRequest request) {
        return adminGuard.requireAdmin().then(purchaseService.updateProduct(request)).map(ApiResponse::ok);
    }

    /**
     * 启用或停用积分商品。
     *
     * @param request UpdateCreditProductStatusRequest 商品状态参数
     * @return Mono<ApiResponse<CreditProductResponse>> 修改后的商品
     */
    @PostMapping("/updateCreditProductStatus")
    public Mono<ApiResponse<PaymentDtos.CreditProductResponse>> updateProductStatus(@Valid @RequestBody PaymentDtos.UpdateCreditProductStatusRequest request) {
        return adminGuard.requireAdmin().then(purchaseService.updateProductStatus(request)).map(ApiResponse::ok);
    }
}

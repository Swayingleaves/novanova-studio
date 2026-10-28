package com.novanovastudio.dto;

import com.alibaba.fastjson2.annotation.JSONField;
import com.novanovastudio.common.CreditAmountWriter;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * 积分商品和支付订单相关数据传输对象。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-10-27 14:00
 */
public final class PaymentDtos {

    /** 禁止实例化。 */
    private PaymentDtos() {
    }

    /**
     * 用户可购买的积分商品。
     *
     * @param id Long 商品标识
     * @param credits BigDecimal 商品积分数量
     * @param bonusCredits BigDecimal 赠送积分数量
     * @param totalCredits BigDecimal 实际到账积分数量
     * @param priceAmount String 人民币金额文本
     * @param sortOrder int 展示排序
     * @param enabled boolean 是否启用
     */
    public record CreditProductResponse(Long id,
                                        @JSONField(serializeUsing = CreditAmountWriter.class) BigDecimal credits,
                                        @JSONField(serializeUsing = CreditAmountWriter.class) BigDecimal bonusCredits,
                                        @JSONField(serializeUsing = CreditAmountWriter.class) BigDecimal totalCredits,
                                        String priceAmount,
                                        int sortOrder,
                                        boolean enabled) {
    }

    /**
     * 积分商品列表响应。
     *
     * @param products List<CreditProductResponse> 商品列表
     */
    public record CreditProductListResponse(List<CreditProductResponse> products) {
    }

    /**
     * 创建积分商品请求。
     *
     * @param credits BigDecimal 积分数量
     * @param bonusCredits BigDecimal 赠送积分数量
     * @param priceAmount BigDecimal 人民币金额
     * @param sortOrder int 展示排序
     * @param enabled boolean 是否启用
     */
    public record CreateCreditProductRequest(
            @NotNull(message = "积分数量不能为空")
            @DecimalMin(value = "0.000001", message = "积分数量必须大于零")
            @Digits(integer = 18, fraction = 6, message = "积分数量最多保留六位小数")
            BigDecimal credits,
            @NotNull(message = "赠送积分不能为空")
            @DecimalMin(value = "0", message = "赠送积分不能小于零")
            @Digits(integer = 18, fraction = 6, message = "赠送积分最多保留六位小数")
            BigDecimal bonusCredits,
            @NotNull(message = "商品金额不能为空")
            @DecimalMin(value = "0.01", message = "商品金额必须大于零")
            @Digits(integer = 10, fraction = 2, message = "商品金额最多保留两位小数")
            BigDecimal priceAmount,
            @Min(value = 0, message = "排序不能小于零") int sortOrder,
            @NotNull(message = "商品启用状态不能为空") Boolean enabled) {
    }

    /**
     * 修改积分商品请求。
     *
     * @param id Long 商品标识
     * @param credits BigDecimal 积分数量
     * @param bonusCredits BigDecimal 赠送积分数量
     * @param priceAmount BigDecimal 人民币金额
     * @param sortOrder int 展示排序
     * @param enabled boolean 是否启用
     */
    public record UpdateCreditProductRequest(
            @NotNull(message = "商品标识不能为空") Long id,
            @NotNull(message = "积分数量不能为空")
            @DecimalMin(value = "0.000001", message = "积分数量必须大于零")
            @Digits(integer = 18, fraction = 6, message = "积分数量最多保留六位小数")
            BigDecimal credits,
            @NotNull(message = "赠送积分不能为空")
            @DecimalMin(value = "0", message = "赠送积分不能小于零")
            @Digits(integer = 18, fraction = 6, message = "赠送积分最多保留六位小数")
            BigDecimal bonusCredits,
            @NotNull(message = "商品金额不能为空")
            @DecimalMin(value = "0.01", message = "商品金额必须大于零")
            @Digits(integer = 10, fraction = 2, message = "商品金额最多保留两位小数")
            BigDecimal priceAmount,
            @Min(value = 0, message = "排序不能小于零") int sortOrder,
            @NotNull(message = "商品启用状态不能为空") Boolean enabled) {
    }

    /**
     * 更新积分商品启用状态请求。
     *
     * @param id Long 商品标识
     * @param enabled Boolean 是否启用
     */
    public record UpdateCreditProductStatusRequest(@NotNull(message = "商品标识不能为空") Long id,
                                                   @NotNull(message = "商品启用状态不能为空") Boolean enabled) {
    }

    /**
     * 创建积分购买订单请求。
     *
     * @param productId Long 商品标识
     * @param paymentMethod String 支付方式
     */
    public record CreateCreditOrderRequest(@NotNull(message = "商品标识不能为空") Long productId,
                                           @NotBlank(message = "支付方式不能为空") String paymentMethod) {
    }

    /**
     * 取消积分购买订单请求。
     *
     * @param orderNo String 平台订单号
     */
    public record CancelCreditOrderRequest(@NotBlank(message = "订单号不能为空") String orderNo) {
    }

    /**
     * 创建积分购买订单响应。
     *
     * @param orderNo String 平台订单号
     * @param paymentMethod String 支付方式
     * @param status String 订单状态
     * @param paymentUrl String 支付渠道返回的扫码支付页面地址
     * @param priceAmount String 订单金额文本
     * @param expiresAt OffsetDateTime 订单超时时间
     */
    public record CreateCreditOrderResponse(String orderNo, String paymentMethod, String status, String paymentUrl,
                                            String priceAmount, OffsetDateTime expiresAt) {
    }

    /**
     * 积分购买订单状态响应。
     *
     * @param orderNo String 平台订单号
     * @param credits BigDecimal 到账积分数量
     * @param priceAmount String 订单金额文本
     * @param paymentMethod String 支付方式
     * @param status String 订单状态
     * @param paidAt String 支付完成时间
     */
    public record CreditOrderStatusResponse(String orderNo,
                                            @JSONField(serializeUsing = CreditAmountWriter.class) BigDecimal credits,
                                            String priceAmount,
                                            String paymentMethod,
                                            String status,
                                            String paidAt) {
    }

    /**
     * 积分购买订单列表项。
     *
     * @param orderNo String 平台订单号
     * @param credits BigDecimal 到账积分数量
     * @param priceAmount String 订单金额文本
     * @param paymentMethod String 支付方式
     * @param status String 订单状态
     * @param createdAt OffsetDateTime 下单时间
     * @param expiresAt OffsetDateTime 支付截止时间
     * @param paidAt OffsetDateTime 支付完成时间
     */
    public record CreditOrderItem(String orderNo,
                                  @JSONField(serializeUsing = CreditAmountWriter.class) BigDecimal credits,
                                  String priceAmount,
                                  String paymentMethod,
                                  String status,
                                  OffsetDateTime createdAt,
                                  OffsetDateTime expiresAt,
                                  OffsetDateTime paidAt) {
    }

    /**
     * 积分购买订单列表响应。
     *
     * @param orders List<CreditOrderItem> 订单列表
     */
    public record CreditOrderListResponse(List<CreditOrderItem> orders) {
    }
}

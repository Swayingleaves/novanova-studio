package com.novanovastudio.dto;

import jakarta.validation.constraints.*;
import java.math.BigDecimal;

/**
 * 永久云存储容量与套餐购买请求。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-19 12:00
 */
public final class StorageCapacityDtos {
    /** 禁止实例化。 */
    private StorageCapacityDtos() { }

    /**
     * @param freeGigabytes 当前空间每人免费容量，单位G
     */
    public record SettingsRequest(@NotNull @Min(0) Integer freeGigabytes) { }

    /**
     * @param id 套餐标识，新建时为空
     * @param revision 编辑时必须提交当前版本
     * @param name 套餐名称
     * @param capacityGigabytes 整数G容量
     * @param credits 积分价格，最多六位小数
     * @param enabled 是否上架
     */
    public record PackageRequest(String id, Integer revision, @NotBlank @Size(max = 100) String name,
                                 @NotNull @Min(1) Integer capacityGigabytes, @NotNull @DecimalMin("0.000001") BigDecimal credits,
                                 boolean enabled) { }

    /**
     * @param packageId 套餐标识
     * @param revision 用户确认的套餐版本
     * @param clientRequestId 本次购买唯一标识，重试沿用
     */
    public record PurchaseRequest(@NotBlank @Size(max = 64) String packageId, @NotNull @Min(1) Integer revision,
                                  @NotBlank @Size(max = 64) String clientRequestId) { }
}

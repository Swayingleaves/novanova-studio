package com.novanovastudio.common;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * 积分金额的精确运算与数据库精度约束。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-18 10:00
 */
public final class CreditAmounts {
    /** 数据库存储的最大小数位数。 */
    public static final int SCALE = 6;
    /** 禁止实例化。 */
    private CreditAmounts() { }

    /**
     * 将整数或十进制字符串转为精确积分，不接受非有限值。
     * @param value 原始金额
     * @return 已校验的金额
     * @throws BusinessException 超出精度或数值范围时抛出
     */
    public static BigDecimal of(Object value) {
        try {
            BigDecimal amount = value instanceof BigDecimal decimal ? decimal : new BigDecimal(value.toString());
            amount = amount.setScale(SCALE, RoundingMode.UNNECESSARY);
            if (amount.precision() > 24) throw new ArithmeticException();
            return amount;
        } catch (ArithmeticException | NumberFormatException | NullPointerException exception) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "积分最多支持六位小数且不能超过十八位整数");
        }
    }

    /**
     * 精确乘以业务数量。
     * @param amount 单价
     * @param count 数量
     * @return 已校验的总金额
     */
    public static BigDecimal multiply(BigDecimal amount, long count) { return of(amount.multiply(BigDecimal.valueOf(count))); }

    /**
     * 按业务调用次数分配金额。
     * @param amount 总金额
     * @param count 次数
     * @return 六位小数单次金额
     */
    public static BigDecimal divide(BigDecimal amount, long count) { return amount.divide(BigDecimal.valueOf(count), SCALE, RoundingMode.HALF_UP); }

    /**
     * 格式化接口金额，避免科学计数法与尾随零。
     * @param amount 积分金额
     * @return 普通十进制字符串
     */
    public static String text(BigDecimal amount) { return of(amount).stripTrailingZeros().toPlainString(); }
}

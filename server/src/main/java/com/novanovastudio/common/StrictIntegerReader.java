package com.novanovastudio.common;

import com.alibaba.fastjson2.JSONException;
import com.alibaba.fastjson2.JSONReader;
import com.alibaba.fastjson2.reader.ObjectReader;
import java.lang.reflect.Type;
import java.math.BigDecimal;

/**
 * 严格读取整数配置，避免小数截断和整数溢出。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-22 00:00
 */
public final class StrictIntegerReader implements ObjectReader<Integer> {
    /**
     * 读取可空整数，不接受字符串、布尔值或超出整数范围的数值。
     * @param reader JSONReader JSON读取器
     * @param fieldType Type 字段类型
     * @param fieldName Object 字段名称
     * @param features long 解析选项
     * @return Integer 完整整数或空值
     * @throws JSONException 输入不是有效整数时抛出
     */
    @Override
    public Integer readObject(JSONReader reader, Type fieldType, Object fieldName, long features) {
        Object value = reader.readAny();
        if (value == null) return null;
        if (value instanceof Number number) {
            try {
                return new BigDecimal(number.toString()).intValueExact();
            } catch (ArithmeticException | NumberFormatException exception) {
                throw new JSONException("配置项必须为有效整数：" + fieldName, exception);
            }
        }
        throw new JSONException("配置项必须为有效整数：" + fieldName);
    }
}

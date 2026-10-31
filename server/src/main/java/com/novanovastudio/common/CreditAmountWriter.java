package com.novanovastudio.common;

import com.alibaba.fastjson2.JSONWriter;
import com.alibaba.fastjson2.writer.ObjectWriter;
import java.lang.reflect.Type;
import java.math.BigDecimal;

/**
 * 仅供积分字段显式使用的十进制字符串序列化器，普通小数保留数值类型。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-18 15:30
 */
public final class CreditAmountWriter implements ObjectWriter<BigDecimal> {

    /**
     * 输出无科学计数法、无尾随零的精确积分金额。
     * @param writer JSON输出器
     * @param object 积分金额，允许为空
     * @param fieldName 积分字段名称
     * @param fieldType 字段声明类型
     * @param features 字段序列化选项
     * @throws BusinessException 积分超出六位小数或十八位整数时抛出
     */
    @Override
    public void write(JSONWriter writer, Object object, Object fieldName, Type fieldType, long features) {
        writer.writeString(object == null ? null : CreditAmounts.text((BigDecimal) object));
    }
}

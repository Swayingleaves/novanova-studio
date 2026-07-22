package com.novanovastudio.repository;

import java.util.List;
import org.springframework.r2dbc.core.DatabaseClient;

/**
 * @title        R2dbcBindings.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  R2DBC参数绑定工具
 * @createTime   2026-06-24 18:25:00
 */
public final class R2dbcBindings {

    /**
     * 禁止实例化
     */
    private R2dbcBindings() {
    }

    /**
     * 绑定可能为空的参数
     *
     * @param spec GenericExecuteSpec SQL执行规格
     * @param name String 参数名
     * @param value T 参数值
     * @param type Class<T> 参数类型
     * @return GenericExecuteSpec 绑定后的SQL执行规格
     */
    public static <T> DatabaseClient.GenericExecuteSpec bindNullable(DatabaseClient.GenericExecuteSpec spec, String name, T value, Class<T> type) {
        // R2DBC需要显式声明空值类型，非空值则正常绑定。
        return value == null ? spec.bindNull(name, type) : spec.bind(name, value);
    }

    /**
     * 构建集合参数占位符
     *
     * @param baseName String 参数名前缀
     * @param size int 参数数量
     * @return String 逗号分隔的命名占位符
     */
    public static String namedPlaceholders(String baseName, int size) {
        // R2DBC 对 IN 集合参数兼容性有限，统一展开为多个命名参数。
        if (size <= 0) {
            throw new IllegalArgumentException("集合参数数量必须大于0");
        }
        StringBuilder builder = new StringBuilder();
        for (int index = 0; index < size; index++) {
            if (index > 0) {
                builder.append(", ");
            }
            builder.append(':').append(baseName).append(index);
        }
        return builder.toString();
    }

    /**
     * 绑定集合参数
     *
     * @param spec GenericExecuteSpec SQL执行规格
     * @param baseName String 参数名前缀
     * @param values List<?> 参数值列表
     * @return GenericExecuteSpec 绑定后的SQL执行规格
     */
    public static DatabaseClient.GenericExecuteSpec bindList(DatabaseClient.GenericExecuteSpec spec, String baseName, List<?> values) {
        // 按顺序绑定集合中的每个值，与 namedPlaceholders 生成的占位符一一对应。
        DatabaseClient.GenericExecuteSpec boundSpec = spec;
        for (int index = 0; index < values.size(); index++) {
            boundSpec = boundSpec.bind(baseName + index, values.get(index));
        }
        return boundSpec;
    }
}

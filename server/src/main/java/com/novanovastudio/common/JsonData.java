package com.novanovastudio.common;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;

/**
 * @title        JsonData.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  JSON数据工具
 * @createTime   2026-06-24 10:42:00
 */
public class JsonData {

    /**
     * 解析JSON节点
     *
     * @param value String JSON字符串
     * @return JSONObject JSON对象
     */
    public JSONObject parseObject(String value) {
        try {
            // 使用Fastjson2解析JSON对象字符串。
            return JSON.parseObject(value);
        } catch (Exception exception) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "JSON数据格式不合法");
        }
    }

    /**
     * 转换为JSON字符串
     *
     * @param value Object 任意对象
     * @return String JSON字符串
     */
    public String stringify(Object value) {
        try {
            // 使用Fastjson2序列化对象。
            return JSON.toJSONString(value);
        } catch (Exception exception) {
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, "序列化JSON失败: " + exception.getMessage());
        }
    }
}

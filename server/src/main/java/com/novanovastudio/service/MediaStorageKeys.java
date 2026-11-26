package com.novanovastudio.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 从业务快照里收集媒体存储键，供删除后的引用检查使用。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-26 22:20
 */
public final class MediaStorageKeys {

    /** 业务媒体键形如 image:xxx，不把网址或对象键算进去。 */
    private static final Pattern STORAGE_KEY = Pattern.compile("^(image|video|audio|file|media):[A-Za-z0-9_-]{1,128}$");

    private MediaStorageKeys() {
    }

    /**
     * 收集多段文本里的媒体存储键。
     *
     * @param payloads 原始文本、存储键或 JSON
     * @return 去重后的媒体存储键
     */
    public static List<String> fromPayloads(List<String> payloads) {
        Set<String> keys = new LinkedHashSet<>();
        if (payloads == null) {
            return List.of();
        }
        for (String payload : payloads) {
            collect(payload, keys);
        }
        return List.copyOf(keys);
    }

    /**
     * 找出旧快照里有、新快照里没有的媒体存储键。
     *
     * @param previous 保存前的快照
     * @param next 保存后的快照
     * @return 本次移除的媒体存储键
     */
    public static List<String> removed(String previous, String next) {
        Set<String> before = new LinkedHashSet<>();
        Set<String> after = new LinkedHashSet<>();
        collect(previous, before);
        collect(next, after);
        before.removeAll(after);
        return List.copyOf(before);
    }

    private static void collect(String payload, Set<String> keys) {
        if (payload == null || payload.isBlank()) {
            return;
        }
        String trimmed = payload.trim();
        if (STORAGE_KEY.matcher(trimmed).matches()) {
            keys.add(trimmed);
            return;
        }
        if (trimmed.startsWith("{")) {
            walk(JSON.parseObject(trimmed), keys);
        } else if (trimmed.startsWith("[")) {
            walk(JSON.parseArray(trimmed), keys);
        }
    }

    private static void walk(Object value, Set<String> keys) {
        if (value instanceof JSONObject object) {
            for (Object child : object.values()) {
                walk(child, keys);
            }
            return;
        }
        if (value instanceof JSONArray array) {
            for (Object child : array) {
                walk(child, keys);
            }
            return;
        }
        if (value instanceof String text && STORAGE_KEY.matcher(text).matches()) {
            keys.add(text);
        }
    }
}

package com.novanovastudio.ai;

/**
 * @title        MultipartPart.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  multipart请求片段
 * @createTime   2026-06-24 20:35:00
 * @param name String 表单字段名
 * @param fileName String 文件名
 * @param contentType String 内容类型
 * @param data byte[] 字段内容
 */
public record MultipartPart(String name, String fileName, String contentType, byte[] data) {
}

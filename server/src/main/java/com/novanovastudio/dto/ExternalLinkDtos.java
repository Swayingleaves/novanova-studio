package com.novanovastudio.dto;

/**
 * 右上角展示外链配置数据传输对象。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-13 14:20
 */
public final class ExternalLinkDtos {

    private ExternalLinkDtos() {
    }

    /** 公开外链配置，封面地址已按可访问地址签发 */
    public record ExternalLinkConfig(String title, String url, String description, String coverUrl) {
    }

    /** 保存请求，标题和链接同时为空表示移除入口 */
    public record SaveExternalLinkConfigRequest(String title, String url, String description, String coverUrl) {
    }
}

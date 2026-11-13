package com.novanovastudio.entity;

import java.time.OffsetDateTime;
import lombok.Data;

/**
 * 平台全局展示外链配置持久化记录。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-13 14:20
 */
public final class PlatformExternalLinkConfigRecords {

    private PlatformExternalLinkConfigRecords() {
    }

    /** 展示外链配置记录 */
    @Data
    public static class ExternalLinkConfigRecord {
        /** 入口按钮与弹窗标题 */
        private String title;
        /** 前往按钮跳转的目标地址 */
        private String url;
        /** 弹窗中的说明文字 */
        private String description;
        /** 弹窗中展示的封面图片地址，为空时不展示封面 */
        private String coverUrl;
        /** 创建时间 */
        private OffsetDateTime createdAt;
        /** 更新时间 */
        private OffsetDateTime updatedAt;
    }
}

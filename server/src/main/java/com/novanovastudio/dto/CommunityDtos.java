package com.novanovastudio.dto;

import java.util.List;

/**
 * 平台全局社群配置数据传输对象。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-29 15:30
 */
public final class CommunityDtos {

    private CommunityDtos() {
    }

    /** 公开社群条目，只包含展示需要的名称、图片地址与排序值 */
    public record CommunityConfig(String name, String imageUrl, int sortOrder) {
    }

    /** 保存请求中的单条社群配置，提交顺序决定展示顺序 */
    public record CommunityConfigInput(String name, String imageUrl) {
    }

    /** 整份社群配置保存请求，空列表表示清空全部社群 */
    public record SaveCommunityConfigsRequest(List<CommunityConfigInput> configs) {
    }
}

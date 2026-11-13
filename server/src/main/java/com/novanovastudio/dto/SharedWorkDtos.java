package com.novanovastudio.dto;

import com.alibaba.fastjson2.JSONObject;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 作品投稿、审核和公开展示数据，不包含源存储配置。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-06 10:00
 */
public final class SharedWorkDtos {
    /** 禁止实例化。 */
    private SharedWorkDtos() { }

    /** 投稿参数，来源内容始终由服务端读取。 */
    public record SubmitRequest(@NotBlank String sourceType, @NotBlank String sourceId,
                                @NotBlank String workType, String roundId, String resultId, String nodeId,
                                @NotBlank @Size(max = 200) String title,
                                @Size(max = 2000) String description, @NotBlank @Size(max = 50) String category,
                                boolean includeGenerationInformation, @NotBlank @Size(max = 64) String requestId,
                                String sourceVersion) { }

    /** 提交前的实际公开内容预览及来源版本。 */
    public record PreviewResult(JSONObject snapshot, String sourceVersion) { }

    /** 作者撤回参数。 */
    public record WorkRequest(@NotBlank String shareCode) { }

    /** 审核和下架参数。 */
    public record ReviewRequest(@NotBlank String shareCode, @NotBlank String action, @Size(max = 2000) String reason) { }

    /** 不含私有快照和来源信息的作品摘要。previewUrl 是列表上的临时预览地址，详情以快照内媒体为准。 */
    public record WorkItem(String shareCode, String title, String description, String category, String creatorName,
                           String workType, String status, String reviewReason, String createdAt, String publishedAt, String previewUrl) { }

    /** 分页作品列表。 */
    public record WorkPage(List<WorkItem> items, long total, int page, int pageSize) { }

    /** 公开内容或获准查看的投稿内容。 */
    public record WorkDetail(WorkItem work, JSONObject snapshot) { }

    /** 媒体临时访问授权。 */
    public record MediaAccess(String url, String expiresAt) { }

    /** 官方与用户作品的统一卡片数据。likeCount 为点赞总数，liked 表示当前访客是否已点赞。 */
    public record FantasticItem(String id, String source, String shareCode, String title, String description,
                                String category, String creatorName, String workType, String mediaUrl,
                                String thumbnailUrl, String targetPath, String promptContent, long likeCount, boolean liked) { }

    /** 首页内容点赞参数。 */
    public record LikeRequest(@NotBlank @Size(max = 200) String targetKey) { }

    /** 切换后的点赞状态与内容点赞总数。 */
    public record LikeResult(long likeCount, boolean liked) { }

    /** 首页服务端分页结果。 */
    public record FantasticPage(List<FantasticItem> items, long total, int page, int pageSize) { }

    /** 复制后的个人画布标识。 */
    public record CopyResult(String documentId) { }

    /** 分享视频封面补偿结果。scanned 为本次扫描条数，refreshed 为成功补齐数，failed 为仍失败数。 */
    public record CoverRefreshResult(int scanned, int refreshed, int failed) { }
}

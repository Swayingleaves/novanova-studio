package com.novanovastudio.entity;

import java.time.OffsetDateTime;
import lombok.Data;

/**
 * 画布视频合成异步任务实体。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-11 00:00
 */
@Data
public class VideoCompositionTask {

    /** 任务ID */
    private String id;

    /** 用户ID */
    private Long userId;

    /** 任务状态 */
    private String status;

    /** 任务进度 */
    private Integer progress;

    /** 源视频媒体存储键JSON */
    private String sourceStorageKeys;

    /** 合成结果JSON */
    private String resultData;

    /** 错误信息 */
    private String errorMessage;

    /** 开始时间 */
    private OffsetDateTime startedAt;

    /** 完成时间 */
    private OffsetDateTime completedAt;

    /** 创建时间 */
    private OffsetDateTime createdAt;

    /** 更新时间 */
    private OffsetDateTime updatedAt;
}

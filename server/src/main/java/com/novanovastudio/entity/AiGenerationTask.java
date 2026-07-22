package com.novanovastudio.entity;

import java.time.OffsetDateTime;
import lombok.Data;

/**
 * @title        AiGenerationTask.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  AI生成任务实体
 * @createTime   2026-06-24 10:56:00
 */
@Data
public class AiGenerationTask {

    /** 主键ID */
    private String id;

    /** 用户ID */
    private Long userId;

    /** 任务类型 */
    private String taskType;

    /** 模型名称 */
    private String model;

    /** 渠道名称 */
    private String provider;

    /** 状态 */
    private String status;

    /** 任务进度 */
    private Integer progress;

    /** 请求数据JSON */
    private String requestData;

    /** 结果数据JSON */
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

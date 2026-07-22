package com.novanovastudio.entity;

import java.time.OffsetDateTime;
import lombok.Data;

/**
 * @title        PersistenceRecords.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  业务持久化记录实体集合
 * @createTime   2026-06-24 10:56:00
 */
public final class PersistenceRecords {

    /**
     * 禁止实例化
     */
    private PersistenceRecords() {
    }

    /**
     * 画布、素材、生成记录通用JSON快照记录
     */
    @Data
    public static class SnapshotRecord {

        /** 主键ID */
        private String id;

        /** 用户ID */
        private Long userId;

        /** 记录类型 */
        private String type;

        /** 标题 */
        private String title;

        /** 记录数据JSON */
        private String data;

        /** 状态 */
        private Integer status;

        /** 创建时间 */
        private OffsetDateTime createdAt;

        /** 更新时间 */
        private OffsetDateTime updatedAt;
    }

    /**
     * 图片、视频生成记录实体
     */
    @Data
    public static class GenerationLogRecord extends SnapshotRecord {

        /** 生成任务状态：idle、running、success、failed */
        private String generationStatus;

        /** 最近一次生成任务完成时间 */
        private OffsetDateTime generationCompletedAt;

        /** 用户最近查看记录时间 */
        private OffsetDateTime generationViewedAt;
    }

    /**
     * 媒体文件元数据记录
     */
    @Data
    public static class MediaFileRecord {

        /** 媒体存储键 */
        private String storageKey;

        /** 用户ID */
        private Long userId;

        /** 媒体类型 */
        private String kind;

        /** 来源URL */
        private String sourceUrl;

        /** 对象存储服务商 */
        private String objectStorageProvider;

        /** 对象存储访问URL */
        private String objectStorageUrl;

        /** 对象存储对象键 */
        private String objectStorageKey;

        /** 存储桶 */
        private String bucket;

        /** 地域 */
        private String region;

        /** MIME类型 */
        private String mimeType;

        /** 文件字节数 */
        private Long bytes;

        /** 宽度 */
        private Integer width;

        /** 高度 */
        private Integer height;

        /** 时长毫秒数 */
        private Integer durationMs;

        /** 扩展元数据JSON */
        private String metadata;

        /** 状态 */
        private Integer status;

        /** 创建时间 */
        private OffsetDateTime createdAt;

        /** 更新时间 */
        private OffsetDateTime updatedAt;
    }

    /**
     * 用户AI渠道记录
     */
    @Data
    public static class UserAiChannelRecord {

        /** 主键ID */
        private Long id;

        /** 用户ID */
        private Long userId;

        /** 前端渠道ID */
        private String channelId;

        /** 渠道名称 */
        private String name;

        /** 基础URL */
        private String baseUrl;

        /** 加密后的API Key */
        private String apiKeyEncrypted;

        /** 接口调用格式 */
        private String apiFormat;

        /** 模型列表JSON */
        private String models;

        /** 排序值 */
        private Integer sortOrder;

        /** 状态 */
        private Integer status;

        /** 创建时间 */
        private OffsetDateTime createdAt;

        /** 更新时间 */
        private OffsetDateTime updatedAt;
    }

    /**
     * 用户AI模型配置记录
     */
    @Data
    public static class UserAiModelConfigRecord {

        /** 主键ID */
        private Long id;

        /** 用户ID */
        private Long userId;

        /** 模型配置ID */
        private String modelConfigId;

        /** 所属渠道ID */
        private String channelId;

        /** 模型名称 */
        private String modelName;

        /** 模型类型 */
        private String modelType;

        /** 模型能力列表JSON */
        private String capabilities;

        /** 是否为默认模型 */
        private Boolean defaultModel;

        /** 排序值 */
        private Integer sortOrder;

        /** 单次生成消耗积分 */
        private Integer creditCost;

        /** 创建时间 */
        private OffsetDateTime createdAt;

        /** 更新时间 */
        private OffsetDateTime updatedAt;
    }

    /**
     * 用户对象存储配置记录
     */
    @Data
    public static class UserObjectStorageRecord {

        /** 主键ID */
        private Long id;

        /** 用户ID */
        private Long userId;

        /** 前端对象存储配置ID */
        private String storageId;

        /** 对象存储名称 */
        private String name;

        /** 对象存储供应商 */
        private String provider;

        /** 加密后的访问密钥 */
        private String accessKeyEncrypted;

        /** 加密后的SecretKey */
        private String secretKeyEncrypted;

        /** 存储桶 */
        private String bucket;

        /** 地域 */
        private String region;

        /** 服务Endpoint */
        private String endpoint;

        /** 上传目录 */
        private String directory;

        /** 公开访问基础URL */
        private String publicBaseUrl;

        /** 是否默认对象存储 */
        private Boolean defaultStorage;

        /** 最后测试时间 */
        private String lastTestedAt;

        /** 状态 */
        private Integer status;

        /** 创建时间 */
        private OffsetDateTime createdAt;

        /** 更新时间 */
        private OffsetDateTime updatedAt;
    }

}

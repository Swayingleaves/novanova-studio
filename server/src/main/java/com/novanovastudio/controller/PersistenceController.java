package com.novanovastudio.controller;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.CreditDtos;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.security.RequireRole;
import com.novanovastudio.service.CreditService;
import com.novanovastudio.service.PersistenceService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.codec.multipart.FilePart;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * @title        PersistenceController.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  响应式业务持久化接口
 * @createTime   2026-06-24 18:45:00
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class PersistenceController {

    /** 业务持久化服务 */
    private final PersistenceService persistenceService;

    /** 积分服务 */
    private final CreditService creditService;

    /**
     * 查询积分设置。
     *
     * @return Mono<ApiResponse<CreditSettingsResponse>> 积分设置
     */
    @GetMapping("/config/credit/getCreditSettings")
    @RequireRole("admin")
    public Mono<ApiResponse<CreditDtos.CreditSettingsResponse>> getCreditSettings() {
        return creditService.getSettings().map(ApiResponse::ok);
    }

    /**
     * 更新积分设置。
     *
     * @param request UpdateCreditSettingsRequest 积分设置请求
     * @return Mono<ApiResponse<CreditSettingsResponse>> 保存后的积分设置
     */
    @PostMapping("/config/credit/updateCreditSettings")
    @RequireRole("admin")
    public Mono<ApiResponse<CreditDtos.CreditSettingsResponse>> updateCreditSettings(@Valid @RequestBody CreditDtos.UpdateCreditSettingsRequest request) {
        return creditService.updateSettings(request).map(ApiResponse::ok);
    }

    /**
     * 查询当前用户渠道列表
     *
     * @return Mono<ApiResponse<ChannelListResponse>> 渠道列表
     */
    @GetMapping("/config/channel/listChannels")
    @RequireRole("admin")
    public Mono<ApiResponse<PersistenceDtos.ChannelListResponse>> listChannels() {
        return persistenceService.listChannels().map(list -> ApiResponse.ok(new PersistenceDtos.ChannelListResponse(list)));
    }

    /**
     * 查询当前用户对象存储列表
     *
     * @return Mono<ApiResponse<ObjectStorageListResponse>> 对象存储列表
     */
    @GetMapping("/config/objectStorage/listObjectStorages")
    @RequireRole("admin")
    public Mono<ApiResponse<PersistenceDtos.ObjectStorageListResponse>> listObjectStorages() {
        return persistenceService.listObjectStorages().map(list -> ApiResponse.ok(new PersistenceDtos.ObjectStorageListResponse(list)));
    }

    /** 创建当前用户渠道。 */
    @PostMapping("/config/channel/createChannel") @RequireRole("admin")
    public Mono<ApiResponse<AiTaskDtos.AiChannelConfig>> createChannel(@Valid @RequestBody PersistenceDtos.ChannelMutationRequest request) {
        return persistenceService.createChannel(request).map(ApiResponse::ok);
    }

    /** 修改当前用户渠道。 */
    @PostMapping("/config/channel/updateChannel") @RequireRole("admin")
    public Mono<ApiResponse<AiTaskDtos.AiChannelConfig>> updateChannel(@Valid @RequestBody PersistenceDtos.ChannelMutationRequest request) {
        return persistenceService.updateChannel(request).map(ApiResponse::ok);
    }

    /**
     * 从第三方渠道拉取模型列表。
     *
     * @param request ChannelModelRefreshRequest 渠道连接配置
     * @return Mono<ApiResponse<ChannelModelRefreshResponse>> 模型列表响应
     */
    @PostMapping("/config/channel/refreshChannelModels") @RequireRole("admin")
    public Mono<ApiResponse<PersistenceDtos.ChannelModelRefreshResponse>> refreshChannelModels(
            @Valid @RequestBody PersistenceDtos.ChannelModelRefreshRequest request) {
        return persistenceService.refreshChannelModels(request)
                .map(models -> ApiResponse.ok(new PersistenceDtos.ChannelModelRefreshResponse(models)));
    }

    /** 删除当前用户渠道。 */
    @PostMapping("/config/channel/deleteChannel") @RequireRole("admin")
    public Mono<ApiResponse<String>> deleteChannel(@Valid @RequestBody PersistenceDtos.ChannelIdRequest request) {
        return persistenceService.deleteChannel(request.channelId()).thenReturn(ApiResponse.ok("ok"));
    }

    /** 查询当前用户模型配置。 */
    @GetMapping("/config/model/listModelConfigs") @RequireRole("admin")
    public Mono<ApiResponse<PersistenceDtos.ModelConfigListResponse>> listModelConfigs() {
        return persistenceService.listModelConfigs().map(list -> ApiResponse.ok(new PersistenceDtos.ModelConfigListResponse(list)));
    }

    /** 创建当前用户模型配置。 */
    @PostMapping("/config/model/createModelConfig") @RequireRole("admin")
    public Mono<ApiResponse<PersistenceDtos.ModelConfig>> createModelConfig(@Valid @RequestBody PersistenceDtos.CreateModelConfigRequest request) {
        return persistenceService.createModelConfig(request).map(ApiResponse::ok);
    }

    /** 修改当前用户模型配置。 */
    @PostMapping("/config/model/updateModelConfig") @RequireRole("admin")
    public Mono<ApiResponse<PersistenceDtos.ModelConfig>> updateModelConfig(@Valid @RequestBody PersistenceDtos.UpdateModelConfigRequest request) {
        return persistenceService.updateModelConfig(request).map(ApiResponse::ok);
    }

    /** 删除当前用户模型配置。 */
    @PostMapping("/config/model/deleteModelConfig") @RequireRole("admin")
    public Mono<ApiResponse<String>> deleteModelConfig(@Valid @RequestBody PersistenceDtos.IdRequest request) {
        return persistenceService.deleteModelConfig(request.id()).thenReturn(ApiResponse.ok("ok"));
    }

    /** 设置当前用户默认模型。 */
    @PostMapping("/config/model/setDefaultModel") @RequireRole("admin")
    public Mono<ApiResponse<String>> setDefaultModel(@Valid @RequestBody PersistenceDtos.SetDefaultModelRequest request) {
        return persistenceService.setDefaultModel(request).thenReturn(ApiResponse.ok("ok"));
    }

    /** 创建对象存储。 */
    @PostMapping("/config/objectStorage/createObjectStorage") @RequireRole("admin")
    public Mono<ApiResponse<JSONObject>> createObjectStorage(@Valid @RequestBody PersistenceDtos.ObjectStorageConfig request) {
        return persistenceService.createObjectStorage(request).map(ApiResponse::ok);
    }

    /** 修改对象存储。 */
    @PostMapping("/config/objectStorage/updateObjectStorage") @RequireRole("admin")
    public Mono<ApiResponse<JSONObject>> updateObjectStorage(@Valid @RequestBody PersistenceDtos.ObjectStorageConfig request) {
        return persistenceService.updateObjectStorage(request).map(ApiResponse::ok);
    }

    /** 删除对象存储。 */
    @PostMapping("/config/objectStorage/deleteObjectStorage") @RequireRole("admin")
    public Mono<ApiResponse<String>> deleteObjectStorage(@Valid @RequestBody PersistenceDtos.ObjectStorageIdRequest request) {
        return persistenceService.deleteObjectStorage(request.storageId()).thenReturn(ApiResponse.ok("ok"));
    }

    /** 设置默认对象存储。 */
    @PostMapping("/config/objectStorage/setDefaultObjectStorage") @RequireRole("admin")
    public Mono<ApiResponse<String>> setDefaultObjectStorage(@Valid @RequestBody PersistenceDtos.ObjectStorageIdRequest request) {
        return persistenceService.setDefaultObjectStorage(request.storageId()).thenReturn(ApiResponse.ok("ok"));
    }

    /**
     * 测试当前请求提供的对象存储配置。
     * <p>
     * 该接口仅上传测试文件，不依赖默认对象存储，也不会保存当前配置。
     *
     * @param request ObjectStorageConfig 当前待测试的对象存储配置
     * @return Mono<ApiResponse<ObjectStorageFile>> 测试文件的对象存储信息
     */
    @PostMapping("/config/objectStorage/testObjectStorage") @RequireRole("admin")
    public Mono<ApiResponse<PersistenceDtos.ObjectStorageFile>> testObjectStorage(@RequestBody PersistenceDtos.ObjectStorageConfig request) {
        return persistenceService.testObjectStorage(request).map(ApiResponse::ok);
    }

    /**
     * 查询画布项目列表
     *
     * @return Mono<ApiResponse<ProjectListResponse>> 项目列表
     */
    @GetMapping("/canvas/listProjects")
    public Mono<ApiResponse<PersistenceDtos.ProjectListResponse>> listProjects() {
        return persistenceService.listProjects().map(projects -> ApiResponse.ok(new PersistenceDtos.ProjectListResponse(projects)));
    }

    /**
     * 查询画布项目详情
     *
     * @param request IdRequest 请求
     * @return Mono<ApiResponse<ProjectResponse>> 项目详情
     */
    @PostMapping("/canvas/getProject")
    public Mono<ApiResponse<PersistenceDtos.ProjectResponse>> getProject(@Valid @RequestBody PersistenceDtos.IdRequest request) {
        return persistenceService.getProject(request.id()).map(project -> ApiResponse.ok(new PersistenceDtos.ProjectResponse(project)));
    }

    /**
     * 保存画布项目
     *
     * @param request SaveProjectRequest 请求
     * @return Mono<ApiResponse<String>> 响应
     */
    @PostMapping("/canvas/saveProject")
    public Mono<ApiResponse<String>> saveProject(@Valid @RequestBody PersistenceDtos.SaveProjectRequest request) {
        return persistenceService.saveProject(request.project()).thenReturn(ApiResponse.ok("ok"));
    }

    /**
     * 删除画布项目
     *
     * @param request DeleteIdsRequest 请求
     * @return Mono<ApiResponse<String>> 响应
     */
    @PostMapping("/canvas/deleteProjects")
    public Mono<ApiResponse<String>> deleteProjects(@Valid @RequestBody PersistenceDtos.DeleteIdsRequest request) {
        return persistenceService.deleteProjects(request.ids()).thenReturn(ApiResponse.ok("ok"));
    }

    /**
     * 查询素材列表
     *
     * @return Mono<ApiResponse<AssetListResponse>> 素材列表
     */
    @GetMapping("/assets/listAssets")
    public Mono<ApiResponse<PersistenceDtos.AssetListResponse>> listAssets() {
        return persistenceService.listAssets().map(assets -> ApiResponse.ok(new PersistenceDtos.AssetListResponse(assets)));
    }

    /**
     * 保存素材
     *
     * @param request SaveAssetRequest 请求
     * @return Mono<ApiResponse<String>> 响应
     */
    @PostMapping("/assets/saveAsset")
    public Mono<ApiResponse<String>> saveAsset(@Valid @RequestBody PersistenceDtos.SaveAssetRequest request) {
        return persistenceService.saveAsset(request.asset()).thenReturn(ApiResponse.ok("ok"));
    }

    /**
     * 删除素材
     *
     * @param request DeleteIdsRequest 请求
     * @return Mono<ApiResponse<String>> 响应
     */
    @PostMapping("/assets/deleteAsset")
    public Mono<ApiResponse<String>> deleteAsset(@Valid @RequestBody PersistenceDtos.DeleteIdsRequest request) {
        return persistenceService.deleteAssets(request.ids()).thenReturn(ApiResponse.ok("ok"));
    }

    /**
     * 上传媒体
     *
     * @param file Mono<FilePart> 文件
     * @param kind String 类型
     * @param storageKey String 存储键
     * @param mimeType String MIME类型
     * @param width Integer 宽度
     * @param height Integer 高度
     * @param durationMs Integer 时长
     * @param metadata String 扩展元数据JSON
     * @return Mono<ApiResponse<UploadedMediaResponse>> 上传结果
     */
    @PostMapping("/media/uploadMedia")
    public Mono<ApiResponse<PersistenceDtos.UploadedMediaResponse>> uploadMedia(@RequestPart("file") Mono<FilePart> file,
                                                                                @RequestPart("kind") String kind,
                                                                                @RequestPart(value = "storageKey", required = false) String storageKey,
                                                                                @RequestPart(value = "mimeType", required = false) String mimeType,
                                                                                @RequestPart(value = "width", required = false) String width,
                                                                                @RequestPart(value = "height", required = false) String height,
                                                                                @RequestPart(value = "durationMs", required = false) String durationMs,
                                                                                @RequestPart(value = "metadata", required = false) String metadata) {
        return file.flatMap(filePart -> persistenceService.uploadMedia(filePart, new PersistenceDtos.RegisterRemoteMediaRequest(kind, null, storageKey, mimeType, null, parseIntOrNull(width), parseIntOrNull(height), parseIntOrNull(durationMs), parseMetadata(metadata)))).map(ApiResponse::ok);
    }

    /**
     * 登记远程媒体
     *
     * @param request RegisterRemoteMediaRequest 请求
     * @return Mono<ApiResponse<UploadedMediaResponse>> 媒体信息
     */
    @PostMapping("/media/registerRemoteMedia")
    public Mono<ApiResponse<PersistenceDtos.UploadedMediaResponse>> registerRemoteMedia(@Valid @RequestBody PersistenceDtos.RegisterRemoteMediaRequest request) {
        return persistenceService.registerRemoteMedia(request).map(ApiResponse::ok);
    }

    /**
     * 查询媒体信息
     *
     * @param request MediaInfoRequest 请求
     * @return Mono<ApiResponse<UploadedMediaResponse>> 媒体信息
     */
    @PostMapping("/media/getMediaInfo")
    public Mono<ApiResponse<PersistenceDtos.UploadedMediaResponse>> getMediaInfo(@Valid @RequestBody PersistenceDtos.MediaInfoRequest request) {
        return persistenceService.getMediaInfo(request.storageKey()).map(ApiResponse::ok);
    }

    /**
     * 下载当前用户的媒体文件。
     *
     * @param request MediaInfoRequest 媒体存储键请求
     * @return Mono<ResponseEntity<byte[]>> 带附件响应头的媒体二进制内容
     */
    @PostMapping("/media/downloadMedia")
    public Mono<ResponseEntity<byte[]>> downloadMedia(@Valid @RequestBody PersistenceDtos.MediaInfoRequest request) {
        return persistenceService.downloadMedia(request.storageKey())
                .map(media -> ResponseEntity.ok()
                        .contentType(MediaType.parseMediaType(media.mimeType()))
                        .contentLength(media.data().length)
                        .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + media.fileName() + "\"")
                        .body(media.data()));
    }

    /**
     * 将当前用户登记的远程媒体转存到默认对象存储。
     *
     * @param request TransferRemoteMediaRequest 媒体存储键请求
     * @return Mono<ApiResponse<UploadedMediaResponse>> 转存后的媒体信息
     */
    @PostMapping("/media/uploadRemoteMediaToObjectStorage")
    public Mono<ApiResponse<PersistenceDtos.UploadedMediaResponse>> uploadRemoteMediaToObjectStorage(
            @Valid @RequestBody PersistenceDtos.TransferRemoteMediaRequest request) {
        return persistenceService.uploadRemoteMediaToObjectStorage(request.storageKey()).map(ApiResponse::ok);
    }

    /**
     * 删除媒体
     *
     * @param request DeleteMediaRequest 请求
     * @return Mono<ApiResponse<String>> 响应
     */
    @PostMapping("/media/deleteMedia")
    public Mono<ApiResponse<String>> deleteMedia(@Valid @RequestBody PersistenceDtos.DeleteMediaRequest request) {
        return persistenceService.deleteMedia(request.storageKeys()).thenReturn(ApiResponse.ok("ok"));
    }

    /**
     * 查询生成记录列表
     *
     * @param logType String 记录类型
     * @return Mono<ApiResponse<GenerationLogListResponse>> 生成记录列表
     */
    @GetMapping("/generationLogs/listGenerationLogs")
    public Mono<ApiResponse<PersistenceDtos.GenerationLogListResponse>> listGenerationLogs(@RequestParam(required = false) String logType) {
        return persistenceService.listGenerationLogs(logType).map(logs -> ApiResponse.ok(new PersistenceDtos.GenerationLogListResponse(logs)));
    }

    /**
     * 保存生成记录
     *
     * @param request SaveGenerationLogRequest 请求
     * @return Mono<ApiResponse<String>> 响应
     */
    @PostMapping("/generationLogs/saveGenerationLog")
    public Mono<ApiResponse<String>> saveGenerationLog(@Valid @RequestBody PersistenceDtos.SaveGenerationLogRequest request) {
        return persistenceService.saveGenerationLog(request.logType(), request.log()).thenReturn(ApiResponse.ok("ok"));
    }

    /**
     * 修改生成记录标题
     *
     * @param request RenameGenerationLogTitleRequest 请求
     * @return Mono<ApiResponse<String>> 响应
     */
    @PostMapping("/generationLogs/renameGenerationLogTitle")
    public Mono<ApiResponse<String>> renameGenerationLogTitle(@Valid @RequestBody PersistenceDtos.RenameGenerationLogTitleRequest request) {
        return persistenceService.renameGenerationLogTitle(request.id(), request.title()).thenReturn(ApiResponse.ok("ok"));
    }

    /**
     * 标记生成记录已查看。
     *
     * @param request IdRequest 生成记录ID请求
     * @return Mono<ApiResponse<String>> 响应
     */
    @PostMapping("/generationLogs/markGenerationLogViewed")
    public Mono<ApiResponse<String>> markGenerationLogViewed(@Valid @RequestBody PersistenceDtos.IdRequest request) {
        return persistenceService.markGenerationLogViewed(request.id()).thenReturn(ApiResponse.ok("ok"));
    }

    /**
     * 删除生成记录
     *
     * @param request DeleteIdsRequest 请求
     * @return Mono<ApiResponse<String>> 响应
     */
    @PostMapping("/generationLogs/deleteGenerationLogs")
    public Mono<ApiResponse<String>> deleteGenerationLogs(@Valid @RequestBody PersistenceDtos.DeleteIdsRequest request) {
        return persistenceService.deleteGenerationLogs(request.ids()).thenReturn(ApiResponse.ok("ok"));
    }

    /**
     * 解析上传媒体的扩展元数据
     *
     * @param metadata String 扩展元数据JSON
     * @return JSONObject 扩展元数据
     */
    private JSONObject parseMetadata(String metadata) {
        if (metadata == null || metadata.isBlank()) {
            return null;
        }
        try {
            return JSON.parseObject(metadata);
        } catch (Exception exception) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "媒体扩展元数据JSON格式不合法");
        }
    }

    /**
     * 安全解析整型参数
     *
     * @param value String 整型字符串
     * @return Integer 解析后的整型值，无效时返回null
     */
    private Integer parseIntOrNull(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return Integer.parseInt(value.trim());
        } catch (NumberFormatException exception) {
            return null;
        }
    }
}

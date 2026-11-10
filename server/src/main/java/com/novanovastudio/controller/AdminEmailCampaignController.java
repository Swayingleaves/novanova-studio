package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.EmailCampaignDtos;
import com.novanovastudio.dto.EmailSettingsDtos;
import com.novanovastudio.security.RequireRole;
import com.novanovastudio.service.EmailCampaignService;
import com.novanovastudio.service.EmailSettingsService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * 平台管理员邮件群发接口。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-24 16:00
 */
@RestController
@RequiredArgsConstructor
@RequireRole("admin")
@RequestMapping("/api/v1/admin/email")
public class AdminEmailCampaignController {
    /** 群发业务服务。 */
    private final EmailCampaignService service;
    /** 邮件服务器与注册后缀配置。 */
    private final EmailSettingsService emailSettingsService;

    /**
     * 读取 SMTP、发件人和注册邮箱后缀。响应不包含授权码明文。
     *
     * @return 邮件服务配置
     */
    @GetMapping("/getEmailServiceSettings")
    public Mono<ApiResponse<EmailSettingsDtos.EmailServiceSettings>> getEmailServiceSettings() {
        return emailSettingsService.getSettings().map(ApiResponse::ok);
    }

    /**
     * 保存 SMTP、发件人和注册邮箱后缀。授权码留空时保留已保存的值。
     *
     * @param request 邮件服务配置
     * @return 保存后的邮件服务配置
     */
    @PostMapping("/updateEmailServiceSettings")
    public Mono<ApiResponse<EmailSettingsDtos.EmailServiceSettings>> updateEmailServiceSettings(
            @Valid @RequestBody EmailSettingsDtos.UpdateEmailServiceSettings request) {
        return emailSettingsService.updateSettings(request).map(ApiResponse::ok);
    }

    /** @return 群发全局配置 */
    @GetMapping("/getSettings")
    public Mono<ApiResponse<EmailCampaignDtos.Settings>> getSettings() { return service.getSettings().map(ApiResponse::ok); }

    /**
     * @param request 待预览的邮件正文
     * @return 与发送使用相同处理流程的邮件文档
     */
    @PostMapping("/previewContent")
    public Mono<ApiResponse<EmailCampaignDtos.Preview>> previewContent(@Valid @RequestBody EmailCampaignDtos.PreviewRequest request) {
        return service.previewContent(request).map(ApiResponse::ok);
    }

    /**
     * @param page 页码
     * @param pageSize 分页大小
     * @param keyword 搜索词
     * @param emailDomains 可选邮箱后缀，可重复传入选择多个域名
     * @return 有邮箱用户分页
     */
    @GetMapping("/listRecipientUsers")
    public Mono<ApiResponse<EmailCampaignDtos.UserPage>> listRecipientUsers(@RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize, @RequestParam(required = false) String keyword,
            @RequestParam(required = false) List<String> emailDomains) {
        return service.listUsers(page, pageSize, keyword, emailDomains).map(ApiResponse::ok);
    }

    /** @return 当前有邮箱用户使用的域名及人数 */
    @GetMapping("/listEmailDomains")
    public Mono<ApiResponse<List<EmailCampaignDtos.EmailDomain>>> listEmailDomains() {
        return service.listEmailDomains().map(ApiResponse::ok);
    }

    /**
     * @param request 图文与收件范围
     * @return 已入队的群发任务
     */
    @PostMapping("/createCampaign")
    public Mono<ApiResponse<EmailCampaignDtos.Campaign>> createCampaign(@Valid @RequestBody EmailCampaignDtos.CreateRequest request) {
        return service.createCampaign(request).map(ApiResponse::ok);
    }

    /**
     * @param page 页码
     * @param pageSize 分页大小
     * @return 群发记录分页
     */
    @GetMapping("/listCampaigns")
    public Mono<ApiResponse<EmailCampaignDtos.CampaignPage>> listCampaigns(@RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize) { return service.listCampaigns(page, pageSize).map(ApiResponse::ok); }

    /**
     * @param campaignId 任务主键
     * @return 正文与任务详情
     */
    @GetMapping("/getCampaignDetail")
    public Mono<ApiResponse<EmailCampaignDtos.Detail>> getCampaignDetail(@RequestParam long campaignId) {
        return service.getDetail(campaignId).map(ApiResponse::ok);
    }

    /**
     * @param campaignId 任务主键
     * @return 轻量任务状态汇总
     */
    @GetMapping("/getCampaign")
    public Mono<ApiResponse<EmailCampaignDtos.Campaign>> getCampaign(@RequestParam long campaignId) {
        return service.getCampaign(campaignId).map(ApiResponse::ok);
    }

    /**
     * @param campaignId 任务主键
     * @param page 页码
     * @param pageSize 分页大小
     * @param status 发送状态
     * @return 逐用户发送记录
     */
    @GetMapping("/listDeliveries")
    public Mono<ApiResponse<EmailCampaignDtos.DeliveryPage>> listDeliveries(@RequestParam long campaignId,
            @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String status) { return service.listDeliveries(campaignId, page, pageSize, status).map(ApiResponse::ok); }

    /**
     * @param request 待取消任务
     * @return 取消完成结果
     */
    @PostMapping("/cancelCampaign")
    public Mono<ApiResponse<String>> cancelCampaign(@Valid @RequestBody EmailCampaignDtos.CampaignRequest request) {
        return service.cancelCampaign(request.campaignId()).thenReturn(ApiResponse.ok("ok"));
    }
}

package com.novanovastudio.controller;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.security.AdminGuard;
import com.novanovastudio.service.StorageBillingService;
import com.novanovastudio.service.StorageCapacityService;
import com.novanovastudio.service.StorageFileService;
import com.novanovastudio.dto.StorageCapacityDtos;
import com.novanovastudio.dto.StorageFileDtos;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Mono;

/**
 * 存储占用、费率和账单接口。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-18 10:00
 */
@RestController
@RequestMapping("/api/v1/storage")
@RequiredArgsConstructor
public class StorageBillingController {
    /** 存储计费服务。 */
    private final StorageBillingService service;
    /** 永久容量及扩容购买。 */
    private final StorageCapacityService capacityService;
    /** 本人云文件管理。 */
    private final StorageFileService fileService;
    /** 当前空间管理员校验。 */
    private final AdminGuard adminGuard;

    /**
     * @return 本人当前空间免费、已购、已用、总容量及上传预占字节数
     */
    @GetMapping("/getCapacity")
    public Mono<ApiResponse<JSONObject>> getCapacity() { return capacityService.getCapacity().map(ApiResponse::ok); }

    /**
     * @param request 文件名、分类、排序及分页参数
     * @return 本人当前空间实际云文件列表
     */
    @GetMapping("/listFiles")
    public Mono<ApiResponse<JSONObject>> listFiles(@Valid @ModelAttribute StorageFileDtos.ListRequest request) {
        return fileService.listFiles(request).map(ApiResponse::ok);
    }

    /**
     * @param objectId 当前用户的对象标识
     * @param purpose preview或download
     * @return 五分钟只读访问链接及到期时间
     */
    @GetMapping("/getFileAccess")
    public Mono<ApiResponse<JSONObject>> getFileAccess(@RequestParam String objectId, @RequestParam String purpose) {
        return fileService.getFileAccess(objectId, purpose).map(ApiResponse::ok);
    }

    /**
     * @param request 本人对象标识
     * @return 异步删除状态，物理删除完成后才释放容量
     */
    @PostMapping("/deleteFile")
    public Mono<ApiResponse<JSONObject>> deleteFile(@Valid @RequestBody StorageFileDtos.DeleteRequest request) {
        return fileService.deleteFile(request.objectId()).map(ApiResponse::ok);
    }

    /**
     * 默认存储提供方的可购套餐及实际扣款钱包。
     *
     * @return 默认存储提供方的可购套餐及实际扣款钱包
     */
    @GetMapping("/listCapacityPackages")
    public Mono<ApiResponse<JSONObject>> listCapacityPackages() { return capacityService.listPackages().map(ApiResponse::ok); }

    /**
     * 购买结果与最新余额、容量。
     *
     * @param request 用户确认的套餐版本及幂等标识
     * @return 购买结果与最新余额、容量
     */
    @PostMapping("/purchaseCapacity")
    public Mono<ApiResponse<JSONObject>> purchaseCapacity(@Valid @RequestBody StorageCapacityDtos.PurchaseRequest request) {
        return capacityService.purchase(request).map(ApiResponse::ok);
    }

    /**
     * 当前空间管理员可维护的免费容量和自有套餐。
     *
     * @return 当前空间管理员可维护的免费容量和自有套餐
     */
    @GetMapping("/getCapacitySettings")
    public Mono<ApiResponse<JSONObject>> getCapacitySettings() { return adminGuard.requireAdmin().then(capacityService.getSettings()).map(ApiResponse::ok); }

    /**
     * 保存结果。
     *
     * @param request 当前空间免费容量
     * @return 保存结果
     */
    @PostMapping("/saveCapacitySettings")
    public Mono<ApiResponse<String>> saveCapacitySettings(@Valid @RequestBody StorageCapacityDtos.SettingsRequest request) {
        return adminGuard.requireAdmin().then(capacityService.saveSettings(request)).thenReturn(ApiResponse.ok("ok"));
    }

    /**
     * 保存结果。
     *
     * @param request 当前空间自有套餐内容
     * @return 保存结果
     */
    @PostMapping("/saveCapacityPackage")
    public Mono<ApiResponse<String>> saveCapacityPackage(@Valid @RequestBody StorageCapacityDtos.PackageRequest request) {
        return adminGuard.requireAdmin().then(capacityService.savePackage(request)).thenReturn(ApiResponse.ok("ok"));
    }

    /**
     * 本人当前空间存储占用。
     *
     * @return 本人当前空间存储占用
     */
    @GetMapping("/getUsage")
    public Mono<ApiResponse<List<JSONObject>>> getUsage() { return service.getUsage(false).map(ApiResponse::ok); }
    /**
     * 管理员可见的当前空间存储占用汇总。
     *
     * @return 管理员可见的当前空间存储占用汇总
     */
    @GetMapping("/getTeamUsage")
    public Mono<ApiResponse<List<JSONObject>>> getTeamUsage() { return adminGuard.requireAdmin().then(service.getUsage(true)).map(ApiResponse::ok); }
    /**
     * 本人当前空间账单。
     *
     * @return 本人当前空间账单
     */
    @GetMapping("/listBills")
    public Mono<ApiResponse<List<JSONObject>>> listBills() { return service.listBills(false).map(ApiResponse::ok); }
    /**
     * 当前空间成员账单。
     *
     * @return 当前空间成员账单
     */
    @GetMapping("/listTeamBills")
    public Mono<ApiResponse<List<JSONObject>>> listTeamBills() { return adminGuard.requireAdmin().then(service.listBills(true)).map(ApiResponse::ok); }
    /**
     * 历史文件待确认存储身份，不包含成员私有内容。
     *
     * @return 历史文件待确认存储身份，不包含成员私有内容
     */
    @GetMapping("/listUnregisteredStorageGroups")
    public Mono<ApiResponse<List<JSONObject>>> listUnregisteredStorageGroups() { return adminGuard.requireAdmin().then(service.listUnregisteredStorageGroups()).map(ApiResponse::ok); }
    /**
     * 历史对象补录结果。
     *
     * @param request 管理员明确选择的存储
     * @return 历史对象补录结果
     */
    @PostMapping("/registerExistingMedia")
    public Mono<ApiResponse<String>> registerExistingMedia(@Valid @RequestBody ExistingMediaRequest request) {
        return adminGuard.requireAdmin().then(service.registerExistingMedia(request.storageId())).thenReturn(ApiResponse.ok("ok"));
    }
    /**
     * @param storageId 明确确认的自有存储配置
     */
    public record ExistingMediaRequest(@NotBlank String storageId) { }
}

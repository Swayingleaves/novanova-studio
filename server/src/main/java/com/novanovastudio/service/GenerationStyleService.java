package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.GenerationStyleDtos;
import com.novanovastudio.entity.GenerationStyleRecords;
import com.novanovastudio.repository.GenerationStyleRepository;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Mono;

/**
 * 图片和视频生成风格业务服务，同时提供统一的风格解析与快照校验能力。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-31 00:00
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class GenerationStyleService {

    /** 当前生成请求最多选择一个风格。 */
    public static final int MAX_SELECTED_STYLE_COUNT = 1;
    /** 历史重生成最多保留三个风格快照。 */
    public static final int MAX_HISTORY_STYLE_SNAPSHOT_COUNT = 3;
    /** 默认排序值。 */
    private static final int DEFAULT_SORT_ORDER = 1000;
    /** 最大分页数量。 */
    private static final int MAX_PAGE_SIZE = 100;

    /** 风格仓储。 */
    private final GenerationStyleRepository repository;

    /**
     * 查询用户侧启用风格。
     *
     * @param generationType 生成类型
     * @return 用户侧风格列表
     */
    public Mono<GenerationStyleDtos.StyleOptionListResponse> listUserStyles(String generationType) {
        String type = normalizeGenerationType(generationType);
        GenerationStyleDtos.StyleListRequest request = new GenerationStyleDtos.StyleListRequest("", type, null, 1, MAX_PAGE_SIZE);
        return repository.listStyles(request, true)
                .map(this::toOption)
                .collectList()
                .map(GenerationStyleDtos.StyleOptionListResponse::new);
    }

    /**
     * 查询管理端风格列表。
     *
     * @param request 管理端查询请求
     * @return 管理端风格列表
     */
    public Mono<GenerationStyleDtos.StyleListResponse> listAdminStyles(GenerationStyleDtos.StyleListRequest request) {
        GenerationStyleDtos.StyleListRequest normalized = normalizeListRequest(request);
        return Mono.zip(repository.listStyles(normalized, false).map(this::toItem).collectList(), repository.countStyles(normalized, false))
                .map(tuple -> new GenerationStyleDtos.StyleListResponse(tuple.getT1(), tuple.getT2()));
    }

    /**
     * 创建风格。
     *
     * @param request 创建请求
     * @return 操作完成信号
     */
    public Mono<Void> createStyle(GenerationStyleDtos.CreateStyleRequest request) {
        GenerationStyleRecords.StyleRecord record = buildRecord(
                request.generationType(), request.name(), request.stylePrompt(), request.coverUrl(), request.category(), request.status(), request.sortOrder());
        return repository.createStyle(record)
                .doOnSuccess(id -> log.info("创建生成风格成功: id={}, type={}", id, record.getGenerationType()))
                .then();
    }

    /**
     * 更新风格。
     *
     * @param request 更新请求
     * @return 操作完成信号
     */
    public Mono<Void> updateStyle(GenerationStyleDtos.UpdateStyleRequest request) {
        if (request.id() == null || request.id() <= 0) {
            return Mono.error(invalid("风格ID不能为空"));
        }
        GenerationStyleRecords.StyleRecord record = buildRecord(
                request.generationType(), request.name(), request.stylePrompt(), request.coverUrl(), request.category(), request.status(), request.sortOrder());
        record.setId(request.id());
        return repository.updateStyle(record)
                .flatMap(rows -> rows > 0 ? Mono.<Void>empty() : Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "风格不存在")))
                .doOnSuccess(ignored -> log.info("更新生成风格成功: id={}", request.id()));
    }

    /**
     * 更新风格状态。
     *
     * @param request 状态请求
     * @return 操作完成信号
     */
    public Mono<Void> updateStyleStatus(GenerationStyleDtos.UpdateStyleStatusRequest request) {
        if (request.id() == null || request.id() <= 0) {
            return Mono.error(invalid("风格ID不能为空"));
        }
        int status = normalizeStatus(request.status());
        return repository.updateStyleStatus(request.id(), status)
                .flatMap(rows -> rows > 0 ? Mono.<Void>empty() : Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "风格不存在")))
                .doOnSuccess(ignored -> log.info("更新生成风格状态成功: id={}, status={}", request.id(), status));
    }

    /**
     * 批量软删除风格。
     *
     * @param request 删除请求
     * @return 操作完成信号
     */
    public Mono<Void> deleteStyles(GenerationStyleDtos.DeleteStylesRequest request) {
        List<Long> ids = request.ids() == null ? List.of() : request.ids().stream()
                .filter(Objects::nonNull)
                .filter(id -> id > 0)
                .distinct()
                .toList();
        if (ids.isEmpty()) {
            return Mono.error(invalid("请选择要删除的风格"));
        }
        return repository.deleteStyles(ids).doOnSuccess(ignored -> log.info("删除生成风格成功: ids={}", ids));
    }

    /**
     * 按请求中的ID或历史快照解析风格。
     * <p>
     * 普通生成只允许使用启用风格ID；历史重生成只使用已保存快照，二者不能同时提交。
     *
     * @param generationType 生成类型
     * @param styleIds 普通生成风格ID
     * @param snapshots 历史重生成风格快照
     * @return 按用户选择顺序排列的风格快照
     */
    public Mono<List<GenerationStyleDtos.GenerationStyleSnapshot>> resolveStyles(
            String generationType, List<Long> styleIds, List<GenerationStyleDtos.GenerationStyleSnapshot> snapshots) {
        return Mono.defer(() -> {
            String type = normalizeGenerationType(generationType);
            List<Long> ids = normalizeIds(styleIds);
            // 不使用 List.copyOf，先保留空元素，交给统一快照校验返回明确参数错误。
            List<GenerationStyleDtos.GenerationStyleSnapshot> history = snapshots == null
                    ? List.of() : new java.util.ArrayList<>(snapshots);
            if (!ids.isEmpty() && !history.isEmpty()) {
                return Mono.<List<GenerationStyleDtos.GenerationStyleSnapshot>>error(invalid("风格ID和风格快照不能同时提交"));
            }
            if (!history.isEmpty()) {
                return Mono.fromCallable(() -> validateSnapshots(type, history));
            }
            if (ids.isEmpty()) {
                return Mono.just(List.<GenerationStyleDtos.GenerationStyleSnapshot>of());
            }
            return repository.findEnabledByIds(type, ids)
                    .collectMap(GenerationStyleRecords.StyleRecord::getId, record -> record, LinkedHashMap::new)
                    .flatMap(found -> {
                        List<Long> missing = ids.stream().filter(id -> !isUsableRecord(found.get(id), type)).toList();
                        if (!missing.isEmpty()) {
                            return Mono.<List<GenerationStyleDtos.GenerationStyleSnapshot>>error(
                                    invalid("存在不可用或类型不匹配的风格ID: " + missing));
                        }
                        return Mono.just(ids.stream().map(id -> toSnapshot(found.get(id))).toList());
                    });
        });
    }

    /**
     * 校验并复制历史风格快照。
     *
     * @param generationType 生成类型
     * @param snapshots 历史快照
     * @return 校验后的快照
     */
    private List<GenerationStyleDtos.GenerationStyleSnapshot> validateSnapshots(
            String generationType, List<GenerationStyleDtos.GenerationStyleSnapshot> snapshots) {
        if (snapshots.size() > MAX_HISTORY_STYLE_SNAPSHOT_COUNT) {
            throw invalid("最多保留3个风格快照");
        }
        Map<Long, Boolean> ids = new LinkedHashMap<>();
        return snapshots.stream().map(snapshot -> {
            if (snapshot == null || snapshot.id() == null || snapshot.id() <= 0) {
                throw invalid("风格快照ID不合法");
            }
            if (ids.put(snapshot.id(), Boolean.TRUE) != null) {
                throw invalid("风格快照不能重复");
            }
            if (!generationType.equals(snapshot.generationType())) {
                throw invalid("风格快照类型与生成类型不匹配");
            }
            if (!StringUtils.hasText(snapshot.name()) || !StringUtils.hasText(snapshot.stylePrompt())) {
                throw invalid("风格快照缺少名称或提示词");
            }
            return new GenerationStyleDtos.GenerationStyleSnapshot(snapshot.id(), snapshot.name().trim(), generationType, snapshot.stylePrompt().trim());
        }).toList();
    }

    /** 规范化ID并拒绝重复值。 */
    private List<Long> normalizeIds(List<Long> styleIds) {
        if (styleIds == null || styleIds.isEmpty()) {
            return List.of();
        }
        if (styleIds.stream().anyMatch(Objects::isNull)) {
            throw invalid("风格ID不能为空");
        }
        List<Long> ids = styleIds.stream().map(Long::valueOf).toList();
        if (ids.stream().anyMatch(id -> id <= 0)) {
            throw invalid("风格ID不合法");
        }
        if (ids.stream().distinct().count() != ids.size()) {
            throw invalid("风格不能重复选择");
        }
        if (ids.size() > MAX_SELECTED_STYLE_COUNT) {
            throw invalid("最多选择1个风格");
        }
        return ids;
    }

    /** 规范化生成类型。 */
    private String normalizeGenerationType(String generationType) {
        String type = generationType == null ? "" : generationType.trim().toLowerCase(Locale.ROOT);
        if (!GenerationStyleRecords.TYPE_IMAGE.equals(type) && !GenerationStyleRecords.TYPE_VIDEO.equals(type)) {
            throw invalid("风格类型只支持image或video");
        }
        return type;
    }

    /** 规范化状态。 */
    private int normalizeStatus(Integer status) {
        int value = status == null ? GenerationStyleRecords.STATUS_ENABLED : status;
        if (value != GenerationStyleRecords.STATUS_ENABLED && value != GenerationStyleRecords.STATUS_DISABLED) {
            throw invalid("风格状态只支持启用或停用");
        }
        return value;
    }

    /** 构建风格记录。 */
    private GenerationStyleRecords.StyleRecord buildRecord(String generationType, String name, String stylePrompt, String coverUrl,
                                                           String category, Integer status, Integer sortOrder) {
        GenerationStyleRecords.StyleRecord record = new GenerationStyleRecords.StyleRecord();
        record.setGenerationType(normalizeGenerationType(generationType));
        record.setName(required(name, "风格名称不能为空"));
        record.setStylePrompt(required(stylePrompt, "风格提示词不能为空"));
        record.setCoverUrl(required(coverUrl, "风格封面不能为空"));
        record.setCategory(required(category, "风格分类不能为空"));
        record.setStatus(normalizeStatus(status));
        if (sortOrder != null && sortOrder < 0) {
            throw invalid("风格排序值不能小于0");
        }
        record.setSortOrder(sortOrder == null ? DEFAULT_SORT_ORDER : sortOrder);
        return record;
    }

    /** 规范化列表请求。 */
    private GenerationStyleDtos.StyleListRequest normalizeListRequest(GenerationStyleDtos.StyleListRequest request) {
        GenerationStyleDtos.StyleListRequest source = request == null
                ? new GenerationStyleDtos.StyleListRequest("", "all", null, 1, 20) : request;
        String type = source.generationType() == null || source.generationType().isBlank()
                || "all".equalsIgnoreCase(source.generationType()) ? "all" : normalizeGenerationType(source.generationType());
        Integer status = source.status();
        if (status != null && status != 0 && status != 1) {
            throw invalid("风格状态只支持启用或停用");
        }
        return new GenerationStyleDtos.StyleListRequest(source.keyword() == null ? "" : source.keyword().trim(), type,
                status, Math.max(1, source.page()), Math.min(MAX_PAGE_SIZE, Math.max(1, source.pageSize())));
    }

    /** 风格记录转用户选项。 */
    private GenerationStyleDtos.StyleOption toOption(GenerationStyleRecords.StyleRecord record) {
        return new GenerationStyleDtos.StyleOption(record.getId(), record.getName(), record.getGenerationType(), record.getCoverUrl(), record.getCategory());
    }

    /** 风格记录转管理端条目。 */
    private GenerationStyleDtos.StyleItem toItem(GenerationStyleRecords.StyleRecord record) {
        return new GenerationStyleDtos.StyleItem(record.getId(), record.getGenerationType(), record.getName(), record.getStylePrompt(), record.getCoverUrl(), record.getCategory(),
                record.getStatus(), record.getSortOrder(), formatTime(record.getCreatedAt()), formatTime(record.getUpdatedAt()));
    }

    /** 风格记录转快照。 */
    private GenerationStyleDtos.GenerationStyleSnapshot toSnapshot(GenerationStyleRecords.StyleRecord record) {
        return new GenerationStyleDtos.GenerationStyleSnapshot(record.getId(), record.getName(), record.getGenerationType(), record.getStylePrompt());
    }

    /** 校验仓储返回记录仍满足生成侧可用条件。 */
    private boolean isUsableRecord(GenerationStyleRecords.StyleRecord record, String generationType) {
        return record != null && generationType.equals(record.getGenerationType())
                && Objects.equals(record.getStatus(), GenerationStyleRecords.STATUS_ENABLED)
                && record.getDeletedAt() == null
                && StringUtils.hasText(record.getName())
                && StringUtils.hasText(record.getStylePrompt());
    }

    /** 必填文本。 */
    private String required(String value, String message) {
        if (!StringUtils.hasText(value)) {
            throw invalid(message);
        }
        return value.trim();
    }

    /** 格式化时间。 */
    private String formatTime(java.time.OffsetDateTime value) {
        return value == null ? null : value.toString();
    }

    /** 构建参数异常。 */
    private BusinessException invalid(String message) {
        return new BusinessException(ErrorCode.PARAM_INVALID, message);
    }
}

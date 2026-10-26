package com.novanovastudio.service;

import java.math.BigDecimal;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.ScriptDtos;
import com.novanovastudio.repository.ScriptRepository;
import com.novanovastudio.repository.NovelAdaptationRepository;
import com.novanovastudio.repository.ScriptSourceRepository;
import com.novanovastudio.security.CurrentUserProvider;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.ToIntFunction;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.reactive.TransactionalOperator;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 剧本创作项目、结构化正文、版本和生产准备度业务服务。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-20 11:00
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ScriptService {

    /** 剧本关系数据仓储。 */
    private final ScriptRepository repository;

    /** 当前用户提供器。 */
    private final CurrentUserProvider currentUserProvider;

    /** 响应式事务操作器。 */
    private final TransactionalOperator transactionalOperator;

    /** Bean Validation结构校验器。 */
    private final Validator validator;

    /** 剧本变化到漫剧下游的单向影响标记服务。 */
    private final ComicDramaImpactService comicDramaImpactService;

    /** 小说改编正式产物的来源关联。 */
    private final NovelAdaptationRepository novelAdaptationRepository;

    /** 原文导入记录，用于在项目详情中回传原文类型。 */
    private final ScriptSourceRepository scriptSourceRepository;

    /** 概览与世界观基调这类单对象追溯目标使用的固定标识，与前端停点界面的勾选项一致。 */
    private static final String OVERVIEW_TARGET_ID = "overview";
    private static final String WORLD_SETTING_TARGET_ID = "worldSetting";

    /** 正文块来源取值：来自原著事实。 */
    private static final String ORIGIN_ORIGINAL = "original";

    /** 正文块来源取值：AI 新增的改编创作。 */
    private static final String ORIGIN_ADAPTED = "adapted";

    /**
     * 模型此前被要求在正文里写的改编标记。
     * <p>
     * 标记会随剧本正文流入分集工作台与后续配音、成片链路，因此来源改由 {@code origin} 字段承载；
     * 这里保留识别与摘除，既兼容模型的旧习惯，也用于清理存量正文。
     */
    private static final Pattern ADAPTATION_MARK = Pattern.compile("【改编创作[^】]*】");

    /**
     * 分页查询当前用户的剧本项目。
     *
     * @param page int 页码
     * @param pageSize int 每页数量
     * @param keyword String 搜索关键字
     * @param stage String 阶段筛选
     * @param contentType String 内容形式筛选
     * @return Mono<ProjectListResponse> 项目列表
     */
    public Mono<ScriptDtos.ProjectListResponse> listProjects(int page, int pageSize, String keyword,
                                                             String stage, String contentType) {
        int normalizedPage = Math.max(1, page);
        int normalizedPageSize = Math.min(100, Math.max(1, pageSize));
        return currentUserProvider.currentUserId().flatMap(userId -> Mono.zip(
                repository.listProjects(userId, text(keyword), text(stage), text(contentType),
                        (normalizedPage - 1) * normalizedPageSize, normalizedPageSize).collectList(),
                repository.countProjects(userId, text(keyword), text(stage), text(contentType)),
                (projects, total) -> new ScriptDtos.ProjectListResponse(projects, total, normalizedPage, normalizedPageSize)));
    }

    /**
     * 查询全部启用的剧本模板和结构段。
     *
     * @return 模板及结构段列表
     */
    public Mono<List<ScriptDtos.ScriptTemplate>> listTemplates() {
        return repository.listTemplates().concatMap(template -> repository.listTemplateSections(template.templateKey()).collectList()
                .map(sections -> new ScriptDtos.ScriptTemplate(template.templateKey(), template.category(), template.name(),
                        template.description(), template.contentType(), template.genre(), template.structureType(),
                        template.recommendedEpisodeCount(), sections))).collectList();
    }

    /**
     * 创建空白或模板剧本项目。
     *
     * @param request CreateProjectRequest 创建请求
     * @return Mono<ProjectDetail> 新建项目详情
     */
    public Mono<ScriptDtos.ProjectDetail> createProject(ScriptDtos.CreateProjectRequest request) {
        return currentUserProvider.currentUserId().flatMap(userId -> {
            String projectId = UUID.randomUUID().toString();
            Mono<ScriptDtos.ScriptTemplate> templateMono = StringUtils.hasText(request.templateKey())
                    ? repository.getTemplate(request.templateKey()).switchIfEmpty(notFound("剧本模板不存在"))
                    : Mono.empty();
            return templateMono.defaultIfEmpty(emptyTemplate(request.contentType()))
                    .flatMap(template -> repository.listTemplateSections(template.templateKey()).collectList()
                            .defaultIfEmpty(List.of()).flatMap(sections -> {
                                ScriptDtos.ProjectOverview overview = new ScriptDtos.ProjectOverview(
                                        request.title().trim(), StringUtils.hasText(request.contentType()) ? request.contentType().trim() : template.contentType(),
                                        text(template.genre()), text(request.logline()), "", 0,
                                        template.recommendedEpisodeCount(), "", "", "", "", "");
                                ScriptRepository.ProjectRecord record = new ScriptRepository.ProjectRecord(projectId, userId, overview,
                                        "idea", 0, 0, null, null, null);
                                List<ScriptDtos.OutlineSection> outlines = new ArrayList<>();
                                for (int index = 0; index < sections.size(); index++) {
                                    ScriptDtos.TemplateSection section = sections.get(index);
                                    outlines.add(new ScriptDtos.OutlineSection(UUID.randomUUID().toString(), section.sectionType(),
                                            section.title(), "", index));
                                }
                                Mono<Void> operation = repository.createProject(record)
                                        .then(outlines.isEmpty() ? Mono.empty() : repository.replaceOutline(projectId, outlines, List.of()));
                                return transactionalOperator.transactional(operation.then(recalculateProgress(userId, projectId)))
                                        .then(getProjectDetail(userId, projectId));
                            }));
        }).doOnSuccess(project -> log.info("剧本项目创建完成: projectId={}", project.id()));
    }

    /**
     * 查询当前用户的剧本项目基础详情。
     *
     * @param projectId 剧本项目标识
     * @return 不包含分集正文的项目详情
     */
    public Mono<ScriptDtos.ProjectDetail> getProject(String projectId) {
        return currentUserProvider.currentUserId().flatMap(userId -> getProjectDetail(userId, projectId));
    }

    /**
     * 软删除当前用户的多个剧本项目。
     *
     * @param projects 待删除项目及其期望修订号
     * @return 每个已删除项目的新修订信息
     */
    public Mono<List<ScriptDtos.DeletedProjectResult>> deleteProjects(List<ScriptDtos.ProjectDeletion> projects) {
        ids(projects.stream().map(ScriptDtos.ProjectDeletion::projectId).toList(), "待删除项目");
        return currentUserProvider.currentUserId().flatMap(userId -> transactionalOperator.transactional(
                        Flux.fromIterable(projects).concatMap(project -> repository.deleteProject(
                                        userId, project.projectId(), project.expectedRevision())
                                .switchIfEmpty(Mono.error(conflictException()))).collectList())
                .doOnSuccess(deleted -> log.info("剧本项目删除完成: userId={}, projectCount={}", userId, deleted.size())));
    }

    /**
     * 使用乐观锁保存故事概览。
     *
     * @param request 故事概览保存请求
     * @return 最新项目修订信息
     */
    public Mono<ScriptDtos.MutationResult> saveOverview(ScriptDtos.SaveOverviewRequest request) {
        return currentUserProvider.currentUserId().flatMap(userId -> requireProject(userId, request.projectId())
                .then(hasSameOverview(userId, request))
                // 内容完全一致时不写库、不推进修订号、不标记下游，避免无编辑动作把漫剧全部下游改成需要更新
                .flatMap(unchanged -> unchanged
                        ? repository.getProject(userId, request.projectId()).map(this::mutationResult)
                        : transactionalOperator.transactional(
                                repository.updateOverview(userId, request.projectId(), request.expectedRevision(), request.overview())
                                        .flatMap(this::requireRevisionAdvanced)
                                        .then(recalculateProgress(userId, request.projectId())))
                        .flatMap(result -> comicDramaImpactService.markUpstreamChanges(request.projectId(), "overview", List.of(request.projectId()),
                                "故事概览发生变化").thenReturn(result))));
    }

    /**
     * 保存故事大纲和关键事件，并校验稳定标识和引用归属。
     *
     * @param request 大纲保存请求
     * @return 最新项目修订信息
     */
    public Mono<ScriptDtos.MutationResult> saveOutline(ScriptDtos.SaveOutlineRequest request) {
        validateContinuousOrder(request.sections().stream().map(ScriptDtos.OutlineSection::sortOrder).toList(), "大纲结构段");
        validateContinuousOrder(request.events().stream().map(ScriptDtos.StoryEvent::sortOrder).toList(), "故事事件");
        Set<String> sectionIds = ids(request.sections().stream().map(ScriptDtos.OutlineSection::id).toList(), "大纲结构段");
        ids(request.events().stream().map(ScriptDtos.StoryEvent::id).toList(), "故事事件");
        request.events().forEach(event -> requireOptionalReference(event.outlineSectionId(), sectionIds, "故事事件关联了不存在的大纲结构段"));
        List<String> outlineIds = request.sections().stream().map(ScriptDtos.OutlineSection::id).toList();
        List<String> eventIds = request.events().stream().map(ScriptDtos.StoryEvent::id).toList();
        return currentUserProvider.currentUserId().flatMap(userId -> requireProject(userId, request.projectId())
                .then(requireStableIdsAvailable(request.projectId(), "outline", outlineIds, "大纲结构段标识已属于其他项目"))
                .then(requireStableIdsAvailable(request.projectId(), "event", eventIds, "故事事件标识已属于其他项目"))
                // 没有实际编辑时前端仍会回写整份大纲，内容一致就不再走保存与下游标记，
                // 否则一次空回写会把全部镜头已采用的提示词无谓改成 needsUpdate。
                .then(hasSameOutline(request))
                .flatMap(unchanged -> unchanged
                        ? repository.getProject(userId, request.projectId()).map(this::mutationResult)
                        : Mono.zip(repository.listEpisodes(request.projectId()).map(ScriptDtos.EpisodeSummary::id).collectList(),
                        repository.listSceneParents(request.projectId()).collectList())
                        .flatMap(ownedReferences -> {
                            Set<String> episodeIds = Set.copyOf(ownedReferences.getT1());
                            Map<String, String> sceneParentIds = ownedReferences.getT2().stream().collect(
                                    java.util.stream.Collectors.toMap(ScriptRepository.SceneParentRecord::sceneId,
                                            ScriptRepository.SceneParentRecord::episodeId));
                            request.events().forEach(event -> {
                                requireOptionalReference(event.episodeId(), episodeIds, "故事事件关联了不存在的分集");
                                requireStoryEventSceneReference(event, sceneParentIds, "故事事件关联了不存在或不属于对应分集的场次");
                            });
                            return transactionalOperator.transactional(
                                    advance(userId, request.projectId(), request.expectedRevision())
                                            .then(repository.replaceOutline(request.projectId(), request.sections(), request.events()))
                                            .then(recalculateProgress(userId, request.projectId())))
                                    .flatMap(result -> comicDramaImpactService.markUpstreamChanges(request.projectId(), "overview",
                                            List.of(request.projectId()), "故事大纲或关键事件发生变化").thenReturn(result));
                        })));
    }

    /**
     * 判断故事概览与库中现有内容是否完全一致。
     * <p>
     * 前端在没有实际编辑时也会回写整份概览，概览属于全项目粒度的上游，
     * 若不比对内容就标记下游，会把全部镜头已采用的提示词无谓改成需要更新。
     *
     * @param userId 当前用户标识
     * @param request 概览保存请求
     * @return 内容是否未发生变化
     */
    private Mono<Boolean> hasSameOverview(Long userId, ScriptDtos.SaveOverviewRequest request) {
        return getProjectDetail(userId, request.projectId())
                .map(detail -> JSON.toJSONString(detail.overview()).equals(JSON.toJSONString(request.overview())));
    }

    /**
     * 判断故事大纲与关键事件是否与库中现有内容完全一致。
     *
     * @param request 大纲保存请求
     * @return 内容是否未发生变化
     */
    private Mono<Boolean> hasSameOutline(ScriptDtos.SaveOutlineRequest request) {
        return Mono.zip(
                        repository.listOutlineSections(request.projectId()).collectList(),
                        repository.listStoryEvents(request.projectId()).collectList())
                .map(current -> JSON.toJSONString(bySortOrder(current.getT1(), ScriptDtos.OutlineSection::sortOrder))
                        .equals(JSON.toJSONString(bySortOrder(request.sections(), ScriptDtos.OutlineSection::sortOrder)))
                        && JSON.toJSONString(bySortOrder(current.getT2(), ScriptDtos.StoryEvent::sortOrder))
                        .equals(JSON.toJSONString(bySortOrder(request.events(), ScriptDtos.StoryEvent::sortOrder))));
    }

    /**
     * 按排序字段归一化列表，抵消前端提交顺序与库中读取顺序的差异。
     *
     * @param items 待归一化列表
     * @param sortOrder 排序字段读取器
     * @return 按排序字段升序排列的新列表
     */
    private <T> List<T> bySortOrder(List<T> items, ToIntFunction<T> sortOrder) {
        return items.stream().sorted(Comparator.comparingInt(sortOrder)).toList();
    }

    /**
     * 保存人物设定与人物关系，拒绝删除仍被正文引用的人物。
     *
     * @param request 人物区块保存请求
     * @return 最新项目修订信息
     */
    public Mono<ScriptDtos.MutationResult> saveCharacters(ScriptDtos.SaveCharactersRequest request) {
        validateContinuousOrder(request.characters().stream().map(ScriptDtos.Character::sortOrder).toList(), "人物");
        validateContinuousOrder(request.relations().stream().map(ScriptDtos.CharacterRelation::sortOrder).toList(), "人物关系");
        Set<String> characterIds = ids(request.characters().stream().map(ScriptDtos.Character::id).toList(), "人物");
        ids(request.relations().stream().map(ScriptDtos.CharacterRelation::id).toList(), "人物关系");
        request.relations().forEach(relation -> {
            requireReference(relation.sourceCharacterId(), characterIds, "人物关系起点不存在");
            requireReference(relation.targetCharacterId(), characterIds, "人物关系终点不存在");
            if (relation.sourceCharacterId().equals(relation.targetCharacterId())) {
                throw invalid("人物关系不能指向同一人物");
            }
        });
        List<String> characterIdsToSave = request.characters().stream().map(ScriptDtos.Character::id).toList();
        List<String> relationIdsToSave = request.relations().stream().map(ScriptDtos.CharacterRelation::id).toList();
        return currentUserProvider.currentUserId().flatMap(userId -> requireProject(userId, request.projectId())
                .then(requireStableIdsAvailable(request.projectId(), "character", characterIdsToSave, "人物标识已属于其他项目"))
                .then(requireStableIdsAvailable(request.projectId(), "relation", relationIdsToSave, "人物关系标识已属于其他项目"))
                .then(repository.listCharacters(request.projectId()).collectList())
                .flatMap(current -> {
                    List<String> deletedIds = current.stream().map(ScriptDtos.Character::id).filter(id -> !characterIds.contains(id)).toList();
                    return repository.countCharacterReferences(request.projectId(), deletedIds).flatMap(referenceCount -> {
                        if (referenceCount > 0) return repository.listCharacterReferenceLocations(request.projectId(), deletedIds)
                                .collectList().flatMap(locations -> Mono.<ScriptDtos.MutationResult>error(invalid(
                                        "待删除人物仍被引用：" + String.join("、", locations) + "。请先移除对应场次或对白引用")));
                        return transactionalOperator.transactional(advance(userId, request.projectId(), request.expectedRevision())
                                .then(repository.replaceCharacters(request.projectId(), request.characters(), request.relations()))
                                .then(recalculateProgress(userId, request.projectId())))
                                .flatMap(result -> comicDramaImpactService.markUpstreamChanges(request.projectId(), "character",
                                        java.util.stream.Stream.concat(characterIdsToSave.stream(), deletedIds.stream()).distinct().toList(),
                                        "人物文字设定或人物关系发生变化").thenReturn(result));
                    });
                }));
    }

    /**
     * 保存世界观、分类条目和地点，拒绝删除仍被场次引用的地点。
     *
     * @param request 世界观区块保存请求
     * @return 最新项目修订信息
     */
    public Mono<ScriptDtos.MutationResult> saveWorld(ScriptDtos.SaveWorldRequest request) {
        validateContinuousOrder(request.worldItems().stream().map(ScriptDtos.WorldItem::sortOrder).toList(), "世界观条目");
        validateContinuousOrder(request.locations().stream().map(ScriptDtos.Location::sortOrder).toList(), "地点");
        ids(request.worldItems().stream().map(ScriptDtos.WorldItem::id).toList(), "世界观条目");
        Set<String> locationIds = ids(request.locations().stream().map(ScriptDtos.Location::id).toList(), "地点");
        List<String> worldItemIds = request.worldItems().stream().map(ScriptDtos.WorldItem::id).toList();
        List<String> locationIdsToSave = request.locations().stream().map(ScriptDtos.Location::id).toList();
        return currentUserProvider.currentUserId().flatMap(userId -> requireProject(userId, request.projectId())
                .then(requireStableIdsAvailable(request.projectId(), "worldItem", worldItemIds, "世界观条目标识已属于其他项目"))
                .then(requireStableIdsAvailable(request.projectId(), "location", locationIdsToSave, "地点标识已属于其他项目"))
                .then(repository.listLocations(request.projectId()).collectList())
                .flatMap(current -> {
                    List<String> deletedIds = current.stream().map(ScriptDtos.Location::id)
                            .filter(id -> !locationIds.contains(id)).toList();
                    return repository.countLocationReferences(request.projectId(), deletedIds).flatMap(referenceCount -> {
                        if (referenceCount > 0) return repository.listLocationReferenceLocations(request.projectId(), deletedIds)
                                .collectList().flatMap(locations -> Mono.<ScriptDtos.MutationResult>error(invalid(
                                        "待删除地点仍被引用：" + String.join("、", locations) + "。请先修改对应场次")));
                        return transactionalOperator.transactional(advance(userId, request.projectId(), request.expectedRevision())
                                .then(repository.replaceWorld(request.projectId(), request.worldSetting(), request.worldItems(), request.locations()))
                                .then(recalculateProgress(userId, request.projectId())))
                                .flatMap(result -> comicDramaImpactService.markUpstreamChanges(request.projectId(), "world",
                                        java.util.stream.Stream.concat(locationIdsToSave.stream(), deletedIds.stream()).distinct().toList(),
                                        "世界观或地点文字设定发生变化").thenReturn(result));
                    });
                }));
    }

    /**
     * 查询当前用户项目中的单集完整正文。
     *
     * @param projectId 剧本项目标识
     * @param episodeId 分集稳定标识
     * @return 单集、场次和正文块
     */
    public Mono<ScriptDtos.EpisodeDetail> getEpisode(String projectId, String episodeId) {
        return currentUserProvider.currentUserId().flatMap(userId -> requireProject(userId, projectId)
                .then(loadEpisode(projectId, episodeId)));
    }

    /**
     * 保存单集、场次和结构化正文。
     *
     * @param request 单集保存请求
     * @return 最新项目修订信息
     */
    public Mono<ScriptDtos.MutationResult> saveEpisode(ScriptDtos.SaveEpisodeRequest request) {
        validateEpisode(request.episodeDetail());
        List<String> episodeIds = List.of(request.episodeDetail().episode().id());
        List<String> sceneIds = request.episodeDetail().scenes().stream().map(ScriptDtos.Scene::id).toList();
        List<String> blockIds = request.episodeDetail().scenes().stream().flatMap(scene -> scene.blocks().stream())
                .map(ScriptDtos.ScriptBlock::id).toList();
        return currentUserProvider.currentUserId().flatMap(userId -> requireProject(userId, request.projectId())
                .then(requireStableIdsAvailable(request.projectId(), "episode", episodeIds, "分集标识已属于其他项目"))
                .then(requireStableIdsAvailable(request.projectId(), "scene", sceneIds, "场次标识已属于其他项目"))
                .then(requireStableIdsAvailable(request.projectId(), "block", blockIds, "正文块标识已属于其他项目"))
                .then(requireEpisodeParentIds(request.episodeDetail()))
                .then(Mono.zip(repository.listCharacters(request.projectId()).map(ScriptDtos.Character::id).collectList(),
                        repository.listLocations(request.projectId()).map(ScriptDtos.Location::id).collectList(),
                        repository.listEpisodes(request.projectId()).collectList()))
                .flatMap(references -> {
                    validateEpisodeReferences(request.episodeDetail(), Set.copyOf(references.getT1()), Set.copyOf(references.getT2()));
                    validateEpisodePosition(references.getT3(), request.episodeDetail().episode());
                    return transactionalOperator.transactional(advance(userId, request.projectId(), request.expectedRevision())
                            .then(repository.replaceEpisode(request.projectId(), request.episodeDetail()))
                            .then(recalculateProgress(userId, request.projectId())))
                            .flatMap(result -> comicDramaImpactService.markUpstreamChanges(request.projectId(), "episode",
                                    episodeIds, "分集或剧本正文发生变化")
                                    .then(comicDramaImpactService.markUpstreamChanges(request.projectId(), "scene",
                                            sceneIds, "场次或场次正文发生变化"))
                                    .thenReturn(result));
                }));
    }

    /**
     * 调整项目全部分集的顺序与集号。
     *
     * @param request 分集顺序请求
     * @return 最新项目修订信息
     */
    public Mono<ScriptDtos.MutationResult> reorderEpisodes(ScriptDtos.ReorderEpisodesRequest request) {
        ids(request.episodeIds(), "分集");
        return currentUserProvider.currentUserId().flatMap(userId -> requireProject(userId, request.projectId())
                .then(repository.listEpisodes(request.projectId()).map(ScriptDtos.EpisodeSummary::id).collectList())
                .flatMap(currentIds -> {
                    if (!new HashSet<>(currentIds).equals(new HashSet<>(request.episodeIds())) || currentIds.size() != request.episodeIds().size()) {
                        return Mono.error(invalid("分集顺序必须包含项目全部分集且不能重复"));
                    }
                    return transactionalOperator.transactional(advance(userId, request.projectId(), request.expectedRevision())
                            .then(repository.reorderEpisodes(request.projectId(), request.episodeIds()))
                            .then(recalculateProgress(userId, request.projectId())))
                            .flatMap(result -> comicDramaImpactService.markUpstreamChanges(request.projectId(), "overview",
                                    List.of(request.projectId()), "分集顺序发生变化").thenReturn(result));
                }));
    }

    /**
     * 删除指定分集及其级联场次和正文。
     *
     * @param request 分集删除请求
     * @return 最新项目修订信息
     */
    public Mono<ScriptDtos.MutationResult> deleteEpisode(ScriptDtos.DeleteEpisodeRequest request) {
        return currentUserProvider.currentUserId().flatMap(userId -> transactionalOperator.transactional(
                advance(userId, request.projectId(), request.expectedRevision())
                        .then(repository.deleteEpisode(request.projectId(), request.episodeId()))
                        .flatMap(count -> count == 1 ? Mono.empty() : Mono.error(notFoundException("分集不存在")))
                        // 删除中间分集后重新编号，保持集号与排序连续，后续才能继续追加分集。
                        .then(repository.listEpisodes(request.projectId()).map(ScriptDtos.EpisodeSummary::id).collectList())
                        .flatMap(remainingIds -> repository.reorderEpisodes(request.projectId(), remainingIds))
                        .then(recalculateProgress(userId, request.projectId())))
                .flatMap(result -> comicDramaImpactService.markUpstreamChanges(request.projectId(), "episode",
                        List.of(request.episodeId()), "分集及其场次已删除").thenReturn(result)));
    }

    /**
     * 查询当前用户项目的版本摘要列表。
     *
     * @param projectId 剧本项目标识
     * @return 版本摘要列表
     */
    public Mono<List<ScriptDtos.VersionSummary>> listVersions(String projectId) {
        return currentUserProvider.currentUserId().flatMap(userId -> requireProject(userId, projectId)
                .then(repository.listVersions(projectId).collectList()));
    }

    /**
     * 查询当前用户项目的指定版本详情。
     *
     * @param projectId 剧本项目标识
     * @param versionId 版本稳定标识
     * @return 包含完整快照的版本详情
     */
    public Mono<ScriptDtos.VersionDetail> getVersion(String projectId, String versionId) {
        return currentUserProvider.currentUserId().flatMap(userId -> requireProject(userId, projectId)
                .then(repository.getVersion(projectId, versionId)).switchIfEmpty(notFound("版本不存在")));
    }

    /**
     * 创建手动命名的不可变版本快照。
     *
     * @param request 命名版本创建请求
     * @return 新建版本摘要
     */
    public Mono<ScriptDtos.VersionSummary> createVersion(ScriptDtos.CreateVersionRequest request) {
        return currentUserProvider.currentUserId().flatMap(userId -> getSnapshotForUser(
                userId, request.projectId(), request.expectedRevision()).flatMap(snapshot -> {
                    String versionId = UUID.randomUUID().toString();
                    return repository.createVersion(versionId, request.projectId(), userId, request.versionName().trim(),
                            "manual", text(request.changeSummary()), request.expectedRevision(), JSON.parseObject(JSON.toJSONString(snapshot)))
                            .thenReturn(new ScriptDtos.VersionSummary(versionId, request.versionName().trim(), "manual",
                                    text(request.changeSummary()), request.expectedRevision(), OffsetDateTime.now()));
                }));
    }

    /**
     * 恢复指定版本，并把关系快照重新写入正式表。
     *
     * @param request 版本恢复请求
     * @return 最新项目修订信息
     */
    public Mono<ScriptDtos.MutationResult> restoreVersion(ScriptDtos.RestoreVersionRequest request) {
        return currentUserProvider.currentUserId().flatMap(userId -> Mono.zip(
                requireProjectRevision(userId, request.projectId(), request.expectedRevision()),
                repository.getVersion(request.projectId(), request.versionId()).switchIfEmpty(notFound("版本不存在")))
                .flatMap(tuple -> {
                    ScriptDtos.ProjectSnapshot snapshot = tuple.getT2().snapshotData().toJavaObject(ScriptDtos.ProjectSnapshot.class);
                    validateSnapshot(request.projectId(), snapshot);
                    Mono<Void> restore = repository.updateOverview(userId, request.projectId(), request.expectedRevision(), snapshot.project().overview())
                            .flatMap(this::requireRevisionAdvanced).then()
                            .then(repository.clearProjectContent(request.projectId()))
                            .then(repository.replaceCharacters(request.projectId(), snapshot.project().characters(), snapshot.project().characterRelations()))
                            .then(repository.replaceWorld(request.projectId(), snapshot.project().worldSetting(), snapshot.project().worldItems(), snapshot.project().locations()))
                            .thenMany(Flux.fromIterable(snapshot.episodeDetails()).concatMap(detail -> repository.replaceEpisode(request.projectId(), detail))).then()
                            .then(repository.replaceOutline(request.projectId(), snapshot.project().outlineSections(), snapshot.project().storyEvents()));
                    return requireSnapshotStableIdsAvailable(request.projectId(), snapshot)
                            .then(transactionalOperator.transactional(restore.then(recalculateProgress(userId, request.projectId()))))
                            .flatMap(result -> comicDramaImpactService.markUpstreamChanges(request.projectId(), "versionRestore",
                                    List.of(request.versionId()), "恢复剧本历史版本").thenReturn(result));
                }));
    }

    /**
     * 查询进入漫剧创作前的生产准备度。
     *
     * @param projectId 剧本项目标识
     * @return 分项准备度检查结果
     */
    public Mono<ScriptDtos.ProductionReadiness> getProductionReadiness(String projectId) {
        return currentUserProvider.currentUserId().flatMap(userId -> getProjectDetail(userId, projectId)
                .flatMap(project -> Mono.zip(
                        Flux.fromIterable(project.episodes()).concatMap(episode -> loadEpisode(projectId, episode.id())).collectList(),
                        repository.listAiDrafts(projectId).filter(draft -> "pending".equals(draft.status())).collectList(),
                        (episodes, drafts) -> new Object[]{project, episodes, drafts}))).map(values -> {
            ScriptDtos.ProjectDetail project = (ScriptDtos.ProjectDetail) values[0];
            @SuppressWarnings("unchecked")
            List<ScriptDtos.EpisodeDetail> episodes = (List<ScriptDtos.EpisodeDetail>) values[1];
            @SuppressWarnings("unchecked")
            List<ScriptDtos.AiDraft> pendingDrafts = (List<ScriptDtos.AiDraft>) values[2];
            List<ScriptDtos.ReadinessItem> items = new ArrayList<>();
            items.add(readiness("story", StringUtils.hasText(project.overview().synopsis()) ? "ready" : "missing",
                    "故事梗概", "用于下游理解完整剧情", "overview"));
            items.add(readiness("episodes", project.episodes().isEmpty() ? "missing" : "ready",
                    "分集结构", "至少需要一个可用分集", "episodes"));
            boolean hasScriptContent = episodes.stream().flatMap(episode -> episode.scenes().stream())
                    .flatMap(scene -> scene.blocks().stream()).anyMatch(block -> StringUtils.hasText(block.content()));
            items.add(readiness("scriptContent", hasScriptContent ? "ready" : "missing",
                    "可用剧本正文", "至少需要一个包含有效内容的正文块", "episodes"));
            List<ScriptDtos.Scene> scenes = episodes.stream().flatMap(episode -> episode.scenes().stream()).toList();
            boolean sceneMetadataReady = !scenes.isEmpty() && scenes.stream().allMatch(scene ->
                    StringUtils.hasText(scene.locationId()) && StringUtils.hasText(scene.timeDescription())
                            && !scene.characterIds().isEmpty());
            items.add(readiness("sceneMetadata", sceneMetadataReady ? "ready" : "suggested",
                    "场次生产信息", "建议为每个场次补齐地点、时间与出场人物", "episodes"));
            items.add(readiness("characters", project.characters().isEmpty() ? "suggested" : "ready",
                    "主要人物", "建议补充主要人物的目标、动机与外貌文字设定", "characters"));
            items.add(readiness("locations", project.locations().isEmpty() ? "suggested" : "ready",
                    "场景地点", "建议为主要场次补充地点文字设定", "world"));
            items.add(readiness("pendingAiDrafts", pendingDrafts.isEmpty() ? "ready" : "suggested",
                    "待确认AI草稿", pendingDrafts.isEmpty() ? "没有待处理的AI草稿"
                            : "存在" + pendingDrafts.size() + "个待确认AI草稿，建议先确认或放弃", "aiDrafts"));
            boolean ready = items.stream().noneMatch(item -> "missing".equals(item.status()));
            return new ScriptDtos.ProductionReadiness(projectId, ready, items);
        });
    }

    /**
     * 确认进入漫剧创作，仅标记阶段，不触发生成或扣费。
     *
     * @param projectId 剧本项目标识
     * @param expectedRevision 期望修订号
     * @return 最新项目修订信息
     */
    public Mono<ScriptDtos.MutationResult> enterComicDrama(String projectId, long expectedRevision) {
        return currentUserProvider.currentUserId().flatMap(userId -> transactionalOperator.transactional(
                repository.enterProduction(userId, projectId, expectedRevision).flatMap(this::requireRevisionAdvanced)
                        .then(repository.getProject(userId, projectId)).map(this::mutationResult)));
    }

    /**
     * 查询当前用户项目的AI草稿列表。
     *
     * @param projectId 剧本项目标识
     * @return AI草稿列表
     */
    public Mono<List<ScriptDtos.AiDraft>> listAiDrafts(String projectId) {
        return currentUserProvider.currentUserId().flatMap(userId -> requireProject(userId, projectId)
                .then(repository.listAiDrafts(projectId).collectList()));
    }

    /**
     * 放弃待确认的AI草稿。
     *
     * @param request 草稿放弃请求
     * @return 当前项目修订信息
     */
    public Mono<ScriptDtos.MutationResult> discardAiDraft(ScriptDtos.DiscardAiDraftRequest request) {
        return currentUserProvider.currentUserId().flatMap(userId -> transactionalOperator.transactional(
                requireProjectRevision(userId, request.projectId(), request.expectedRevision())
                        .flatMap(project -> repository.updateAiDraftStatus(request.projectId(), request.draftId(),
                                        "discarded", new JSONObject())
                                .flatMap(count -> count == 1
                                        ? Mono.just(mutationResult(project))
                                        : Mono.error(notFoundException("待确认AI草稿不存在"))))));
    }

    /**
     * 为已完成鉴权的AI服务读取指定用户项目快照。
     *
     * @param userId Long 当前用户ID
     * @param projectId String 剧本项目ID
     * @param expectedRevision long 期望修订号
     * @return Mono&lt;ProjectSnapshot&gt; 当前完整项目快照
     */
    public Mono<ScriptDtos.ProjectSnapshot> getSnapshotForUser(Long userId, String projectId, long expectedRevision) {
        return requireProjectRevision(userId, projectId, expectedRevision).then(createSnapshot(userId, projectId))
                .flatMap(snapshot -> requireProjectRevision(userId, projectId, expectedRevision).thenReturn(snapshot));
    }

    /**
     * 确认应用用户编辑后的AI草稿，并在同一事务内创建修改前版本。
     *
     * @param request ApplyAiDraftRequest 草稿应用请求
     * @return Mono&lt;MutationResult&gt; 新修订号与完成度
     */
    public Mono<ScriptDtos.MutationResult> applyAiDraft(ScriptDtos.ApplyAiDraftRequest request) {
        return currentUserProvider.currentUserId().flatMap(userId -> Mono.zip(
                        requireProjectRevision(userId, request.projectId(), request.expectedRevision()),
                        getPendingAiDraft(userId, request.projectId(), request.draftId()))
                .flatMap(tuple -> {
                    ScriptDtos.AiDraft draft = tuple.getT2();
                    if (draft.baseRevision() != request.expectedRevision()) {
                        return Mono.<ScriptDtos.MutationResult>error(new BusinessException(ErrorCode.DATA_CONFLICT,
                                "AI草稿基于旧修订生成，请重新生成草稿"));
                    }
                    return transactionalOperator.transactional(createSnapshot(userId, request.projectId())
                        .flatMap(snapshot -> {
                            JSONObject currentSource = targetSnapshot(snapshot, draft.targetType(), draft.targetId());
                            if (!Objects.equals(currentSource, draft.sourceData())) {
                                return Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT,
                                        "AI草稿对应的目标内容已经变化，请重新生成草稿"));
                            }
                            return applyValidatedAiDraft(userId, request, draft, snapshot, true);
                        }));
                }));
    }

    /**
     * 原子应用同一停点的小说改编草稿，先校验共同基线，再按本批写入后的修订与内容依次合并。
     *
     * @param projectId String 剧本项目标识
     * @param expectedRevision long 整批草稿的共同基线修订号
     * @param draftIds List&lt;String&gt; 按生成顺序排列的待确认草稿标识
     * @return Mono&lt;Void&gt; 全部应用完成信号，任一冲突使整批回滚
     */
    public Mono<Void> applyAdaptationDrafts(String projectId, long expectedRevision, List<String> draftIds) {
        return applyAdaptationDrafts(projectId, expectedRevision, draftIds, true);
    }

    /**
     * 批量应用改编草稿，可关闭逐条版本快照。
     * <p>
     * 逐集正文批量生成会连续应用上百份草稿，逐条保存完整项目快照既没有审阅价值也会让版本表失控；
     * 该路径由调用方在整批开始前保存一份检查点版本，因此这里跳过逐条版本。
     *
     * @param projectId String 剧本项目标识
     * @param expectedRevision long 整批草稿的共同基线修订号
     * @param draftIds List&lt;String&gt; 按生成顺序排列的待确认草稿标识
     * @param perDraftVersion boolean 是否逐条保存修改前版本
     * @return Mono&lt;Void&gt; 全部应用完成信号
     */
    public Mono<Void> applyAdaptationDrafts(String projectId, long expectedRevision, List<String> draftIds,
                                            boolean perDraftVersion) {
        return currentUserProvider.currentUserId().flatMap(userId -> transactionalOperator.transactional(
                getSnapshotForUser(userId, projectId, expectedRevision).flatMap(baseline ->
                        Flux.fromIterable(draftIds).concatMap(id -> getPendingAiDraft(userId, projectId, id))
                                .collectList().flatMap(drafts -> {
                                    // 整批写入前校验，不能把真实人工修改或不同生成基线当成本批修订递增。
                                    for (ScriptDtos.AiDraft draft : drafts) {
                                        if (!draft.actionType().startsWith("novelAdaptation")) {
                                            return Mono.error(invalid("批量应用只支持小说改编草稿"));
                                        }
                                        if (draft.baseRevision() != expectedRevision) {
                                            return Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT,
                                                    "AI草稿基于旧修订生成，请重新生成草稿"));
                                        }
                                        if (!Objects.equals(targetSnapshot(baseline, draft.targetType(), draft.targetId()),
                                                draft.sourceData())) {
                                            return Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT,
                                                    "AI草稿对应的目标内容已经变化，请重新生成草稿"));
                                        }
                                    }
                                    Mono<Long> chain = Mono.just(expectedRevision);
                                    for (ScriptDtos.AiDraft draft : drafts) {
                                        chain = chain.flatMap(revision -> getSnapshotForUser(userId, projectId, revision)
                                                .flatMap(snapshot -> applyValidatedAiDraft(userId,
                                                        new ScriptDtos.ApplyAiDraftRequest(projectId, revision, draft.id(),
                                                                JSON.parseObject(JSON.toJSONString(draft.draftData())),
                                                                allAiDraftTargetIds(draft.targetType(), targetSnapshot(snapshot,
                                                                        draft.targetType(), draft.targetId()))),
                                                        draft, snapshot, perDraftVersion))
                                                .map(ScriptDtos.MutationResult::revision));
                                    }
                                    return chain.then();
                                }))));
    }

    /**
     * 写入已完成基线校验的草稿，沿用版本、事实来源、目标修订与下游影响处理。
     *
     * @param userId Long 当前用户标识
     * @param request ApplyAiDraftRequest 当前写入修订与选定内容
     * @param draft AiDraft 已校验的待确认草稿
     * @param snapshot ProjectSnapshot 本次写入前的完整项目快照
     * @param perDraftVersion boolean 是否在写入前保存修改前版本
     * @return Mono&lt;MutationResult&gt; 写入后的项目修订信息
     */
    private Mono<ScriptDtos.MutationResult> applyValidatedAiDraft(Long userId, ScriptDtos.ApplyAiDraftRequest request,
                                                                  ScriptDtos.AiDraft draft, ScriptDtos.ProjectSnapshot snapshot,
                                                                  boolean perDraftVersion) {
        // 在合并和来源追溯前分配正式标识，待确认的大纲草稿也沿用同一套映射规则。
        if ("outline".equals(draft.targetType())) assignOutlineIds(request.draftData(), snapshot);
        MergedAdaptationDraft merged = mergeAdaptationDraft(draft, request.draftData(), snapshot,
                request.selectedTargetIds() == null ? List.of() : request.selectedTargetIds());
        Mono<Void> operation = (perDraftVersion
                ? repository.createVersion(UUID.randomUUID().toString(), request.projectId(), userId,
                        "AI修改前", "ai", "应用AI动作：" + draft.actionType(), request.expectedRevision(),
                        JSON.parseObject(JSON.toJSONString(snapshot)))
                : Mono.<Long>empty())
                .then(novelAdaptationRepository.requireTargetSelectionForDraft(draft.id(), draft.projectId(),
                        draft.targetType(), draft.targetId(), request.selectedTargetIds()))
                .then(applyDraftData(userId, draft, merged.data(), snapshot, request.expectedRevision()))
                .then(novelAdaptationRepository.recordApplied(draft.id(), draft.projectId(),
                        draft.targetType(), draft.targetId(), merged.data(), merged.changedTargetIds()))
                .then(repository.updateAiDraftStatus(request.projectId(), request.draftId(), "applied", merged.data())
                        .flatMap(count -> count == 1 ? Mono.empty() : Mono.error(conflictException())));
        return operation.then(recalculateProgress(userId, request.projectId()))
                .flatMap(result -> markAppliedDraftImpact(draft, merged.data(), snapshot).thenReturn(result));
    }

    /**
     * 在批量写入前保存一次整批检查点版本，供批量逐集应用后整体回退。
     *
     * @param projectId String 剧本项目标识
     * @param expectedRevision long 当前项目修订号
     * @param userId Long 当前离线用户标识
     * @param versionName String 版本名称
     * @param changeSummary String 修改摘要
     * @return Mono&lt;Void&gt; 版本创建完成信号
     */
    public Mono<Void> createCheckpointVersion(String projectId, long expectedRevision, Long userId,
                                              String versionName, String changeSummary) {
        return getSnapshotForUser(userId, projectId, expectedRevision).flatMap(snapshot ->
                repository.createVersion(UUID.randomUUID().toString(), projectId, userId, versionName, "ai",
                        changeSummary, expectedRevision, JSON.parseObject(JSON.toJSONString(snapshot))));
    }

    /**
     * 合并小说改编草稿，保留未选中的正式内容，并只允许覆盖明确勾选的旧目标。
     *
     * @param draft 待应用改编草稿
     * @param data 用户审阅后的草稿数据
     * @param snapshot 当前正式内容快照
     * @param selectedTargetIds 用户明确选择更新的现有目标
     * @return 合并后的完整数据与本次更新目标
     */
    private MergedAdaptationDraft mergeAdaptationDraft(ScriptDtos.AiDraft draft, JSONObject data,
                                                        ScriptDtos.ProjectSnapshot snapshot,
                                                        List<String> selectedTargetIds) {
        if (!draft.actionType().startsWith("novelAdaptation")) return new MergedAdaptationDraft(data, List.of());
        Set<String> selected = Set.copyOf(selectedTargetIds);
        // 同一停点可能有多份同阶段草稿，合并必须保留本批此前已写入的内容。
        JSONObject source = targetSnapshot(snapshot, draft.targetType(), draft.targetId());
        normalizeDraftIds(draft.targetType(), source, data);
        JSONObject merged = new JSONObject();
        List<String> changed = new ArrayList<>();
        switch (draft.targetType()) {
            case "overview" -> {
                // 概览是单对象，用固定标识参与勾选判断，未勾选时保留现有概览。
                if (selected.contains(OVERVIEW_TARGET_ID)) {
                    merged.putAll(data);
                    changed.add(OVERVIEW_TARGET_ID);
                } else {
                    merged.putAll(source);
                }
            }
            case "characters" -> {
                merged.put("characters", mergeArray(source.getJSONArray("characters"), data.getJSONArray("characters"), selected, "sortOrder", changed));
                // 关系跟随两端人物：只有两端都被勾选的现有关系才允许被草稿覆盖；关系变更不参与来源追溯。
                merged.put("relations", mergeArray(source.getJSONArray("relations"), data.getJSONArray("relations"),
                        selectedRelationIds(source, selected), "sortOrder", new ArrayList<>()));
            }
            case "world" -> {
                // 世界观基调属于全局归纳，没有稳定标识，用固定标识参与勾选判断。
                JSONObject setting = selected.contains(WORLD_SETTING_TARGET_ID)
                        ? data.getJSONObject("worldSetting") : source.getJSONObject("worldSetting");
                merged.put("worldSetting", setting == null ? new JSONObject() : setting);
                merged.put("worldItems", mergeArray(source.getJSONArray("worldItems"), data.getJSONArray("worldItems"), selected, "sortOrder", changed));
                merged.put("locations", mergeArray(source.getJSONArray("locations"), data.getJSONArray("locations"), selected, "sortOrder", changed));
            }
            case "outline" -> {
                // 结构段标识每次改编都是新生成的 UUID，两套大纲之间没有交集；按 id 合并会把上一套整段保留、
                // 新的一套追加，表现为两套幕并存、幕号重复。当勾选范围覆盖现有全部条目时（一键应用与批量
                // 应用都是这种全量情况），把草稿当作整套大纲：旧内容不参与合并，未出现在草稿里的条目随之移除。
                JSONObject base = coversAll(selected, "outline", source) ? new JSONObject() : source;
                merged.put("sections", mergeArray(base.getJSONArray("sections"), data.getJSONArray("sections"), selected, "sortOrder", changed));
                merged.put("events", mergeArray(base.getJSONArray("events"), data.getJSONArray("events"), selected, "sortOrder", changed));
            }
            case "episodes" -> {
                JSONArray episodes = mergeArray(source.getJSONArray("episodes"),
                        data.getJSONArray("episodes"), selected, "sortOrder", changed, true);
                // 完成状态是服务端字段：草稿未给时按规划态补齐，模型漏填不该让整批分集作废。
                for (int index = 0; index < episodes.size(); index++) {
                    JSONObject episode = episodes.getJSONObject(index);
                    if (!StringUtils.hasText(episode.getString("completionStatus"))) {
                        episode.put("completionStatus", "planning");
                    }
                }
                merged.put("episodes", episodes);
            }
            case "episode" -> {
                JSONObject oldEpisode = source.getJSONObject("episode");
                JSONObject newEpisode = data.getJSONObject("episode");
                JSONObject episode = selected.contains(draft.targetId()) ? newEpisode : oldEpisode;
                if (selected.contains(draft.targetId())) changed.add(draft.targetId());
                merged.put("episode", episode);
                // 重新生成整集时模型会重排场次、把已有正文块搬到别的场次，旧场次的标识与归属都不再适用；
                // 全量应用按整套替换（旧场次不参与合并），只勾选部分场次时才按标识逐条合并。
                JSONArray base = coversAll(selected, "episode", source) ? new JSONArray() : source.getJSONArray("scenes");
                JSONArray scenes = mergeArray(base, data.getJSONArray("scenes"), selected,
                        "sortOrder", changed, false, true);
                for (int i = 0; i < scenes.size(); i++) {
                    JSONObject scene = scenes.getJSONObject(i);
                    scene.put("sceneNumber", i + 1);
                    JSONArray blocks = scene.getJSONArray("blocks");
                    if (blocks != null) for (int j = 0; j < blocks.size(); j++) blocks.getJSONObject(j).put("sortOrder", j);
                }
                merged.put("scenes", scenes);
            }
            default -> throw invalid("小说改编草稿目标类型不受支持");
        }
        if (!selected.isEmpty()) {
            Set<String> known = new HashSet<>();
            switch (draft.targetType()) {
                case "overview" -> known.add(OVERVIEW_TARGET_ID);
                case "characters" -> collectIds(source.getJSONArray("characters"), known);
                case "world" -> {
                    known.add(WORLD_SETTING_TARGET_ID);
                    collectIds(source.getJSONArray("worldItems"), known);
                    collectIds(source.getJSONArray("locations"), known);
                }
                case "outline" -> {
                    collectIds(source.getJSONArray("sections"), known);
                    collectIds(source.getJSONArray("events"), known);
                }
                case "episodes" -> collectIds(source.getJSONArray("episodes"), known);
                case "episode" -> {
                    collectIds(source.getJSONArray("scenes"), known);
                    JSONObject episode = source.getJSONObject("episode");
                    if (episode != null) known.add(episode.getString("id"));
                }
                default -> { }
            }
            if (!known.containsAll(selected)) throw invalid("选择的更新目标与当前改编阶段不匹配，请刷新后重试");
        }
        return new MergedAdaptationDraft(merged, changed.stream().distinct().toList());
    }

    /**
     * 把草稿条目的标识对齐到现有正式条目：名称（或关系两端）一致的复用旧标识。
     *
     * <p>草稿标识由模型生成，与库中已有标识必然不同。若不归一化，合并只会不断追加新条目，
     * 重新生成一次就把人物、地点翻一倍。归一化后同名条目按标识命中并被更新，人工手写的条目
     * 因不在草稿里而天然保留。</p>
     *
     * @param targetType 目标类型
     * @param source 应用时的正式内容快照
     * @param data 待归一化的草稿数据，就地改写
     */
    private void normalizeDraftIds(String targetType, JSONObject source, JSONObject data) {
        switch (targetType) {
            case "characters" -> {
                Map<String, String> remapped = normalizeIdsByName(source.getJSONArray("characters"), data.getJSONArray("characters"));
                remapRelationEndpoints(data.getJSONArray("relations"), remapped);
                normalizeRelationIds(source, data);
            }
            case "world" -> {
                normalizeIdsByName(source.getJSONArray("worldItems"), data.getJSONArray("worldItems"));
                normalizeIdsByName(source.getJSONArray("locations"), data.getJSONArray("locations"));
            }
            default -> { }
        }
    }

    /** 按名称把草稿条目标识改写为现有同名条目的标识，返回被改写条目的原标识到现有标识的映射。 */
    private Map<String, String> normalizeIdsByName(JSONArray source, JSONArray proposed) {
        Map<String, String> remapped = new java.util.HashMap<>();
        if (source == null || proposed == null) return remapped;
        Map<String, JSONObject> existingByName = new java.util.HashMap<>();
        for (int i = 0; i < source.size(); i++) {
            JSONObject item = source.getJSONObject(i);
            String name = item.getString("name");
            if (name != null) existingByName.putIfAbsent(name.trim(), item);
        }
        for (int i = 0; i < proposed.size(); i++) {
            JSONObject item = proposed.getJSONObject(i);
            String name = item.getString("name");
            JSONObject existing = name == null ? null : existingByName.get(name.trim());
            if (existing == null) continue;
            String existingId = existing.getString("id");
            String draftId = item.getString("id");
            if (existingId.equals(draftId)) continue;
            remapped.put(draftId, existingId);
            item.put("id", existingId);
        }
        return remapped;
    }

    /** 人物标识改写后同步更新草稿关系的两端引用，避免关系指向已不存在的标识。 */
    private void remapRelationEndpoints(JSONArray relations, Map<String, String> remapped) {
        if (relations == null || remapped.isEmpty()) return;
        for (int i = 0; i < relations.size(); i++) {
            JSONObject relation = relations.getJSONObject(i);
            String source = relation.getString("sourceCharacterId");
            String target = relation.getString("targetCharacterId");
            if (source != null && remapped.containsKey(source)) relation.put("sourceCharacterId", remapped.get(source));
            if (target != null && remapped.containsKey(target)) relation.put("targetCharacterId", remapped.get(target));
        }
    }

    /** 按关系两端（忽略方向）把草稿关系标识改写为现有同端点关系的标识。 */
    private void normalizeRelationIds(JSONObject source, JSONObject data) {
        JSONArray existing = source.getJSONArray("relations");
        JSONArray proposed = data.getJSONArray("relations");
        if (existing == null || proposed == null) return;
        Map<String, String> idByEndpoints = new java.util.HashMap<>();
        for (int i = 0; i < existing.size(); i++) {
            JSONObject relation = existing.getJSONObject(i);
            idByEndpoints.putIfAbsent(endpointKey(relation), relation.getString("id"));
        }
        for (int i = 0; i < proposed.size(); i++) {
            JSONObject relation = proposed.getJSONObject(i);
            String existingId = idByEndpoints.get(endpointKey(relation));
            if (existingId != null) relation.put("id", existingId);
        }
    }

    /** 关系端点键，忽略源头与目标的方向差异。 */
    private String endpointKey(JSONObject relation) {
        String source = relation.getString("sourceCharacterId");
        String target = relation.getString("targetCharacterId");
        if (source == null || target == null) return "";
        return source.compareTo(target) <= 0 ? source + "\u0000" + target : target + "\u0000" + source;
    }

    /** 关系跟随两端人物：只有两端都被勾选的现有关系才允许被草稿覆盖，避免人工拉好的连线被静默改写。 */
    private Set<String> selectedRelationIds(JSONObject source, Set<String> selectedCharacters) {
        Set<String> ids = new HashSet<>();
        JSONArray relations = source.getJSONArray("relations");
        if (relations == null) return ids;
        for (int i = 0; i < relations.size(); i++) {
            JSONObject relation = relations.getJSONObject(i);
            if (selectedCharacters.contains(relation.getString("sourceCharacterId"))
                    && selectedCharacters.contains(relation.getString("targetCharacterId"))) {
                ids.add(relation.getString("id"));
            }
        }
        return ids;
    }

    /**
     * 草稿可更新的全部正式目标标识，用于一键应用改编草稿时默认全量覆盖。
     *
     * @param draft 待应用的剧本AI草稿
     * @return List&lt;String&gt; 正式目标标识
     */
    public List<String> allAiDraftTargetIds(ScriptDtos.AiDraft draft) {
        return allAiDraftTargetIds(draft.targetType(), draft.sourceData());
    }

    /**
     * 提取给定正式内容快照中的全部可更新目标，供批量应用使用当前内容合并。
     *
     * @param targetType String 草稿目标类型
     * @param source JSONObject 当前正式内容快照
     * @return List&lt;String&gt; 正式目标标识
     */
    private List<String> allAiDraftTargetIds(String targetType, JSONObject source) {
        Set<String> ids = new HashSet<>();
        if (source == null) source = new JSONObject();
        switch (targetType) {
            case "overview" -> ids.add(OVERVIEW_TARGET_ID);
            case "characters" -> collectIds(source.getJSONArray("characters"), ids);
            case "world" -> {
                ids.add(WORLD_SETTING_TARGET_ID);
                collectIds(source.getJSONArray("worldItems"), ids);
                collectIds(source.getJSONArray("locations"), ids);
            }
            case "outline" -> {
                collectIds(source.getJSONArray("sections"), ids);
                collectIds(source.getJSONArray("events"), ids);
            }
            case "episodes" -> collectIds(source.getJSONArray("episodes"), ids);
            case "episode" -> {
                collectIds(source.getJSONArray("scenes"), ids);
                JSONObject episode = source.getJSONObject("episode");
                if (episode != null) ids.add(episode.getString("id"));
            }
            default -> { }
        }
        return new ArrayList<>(ids);
    }

    /** 按稳定标识合并数组并连续重排，新增条目排在已有正式条目之后。 */
    private JSONArray mergeArray(JSONArray source, JSONArray proposed, Set<String> selected, String orderField,
                                 List<String> changed, boolean episodeNumbers) {
        return mergeArray(source, proposed, selected, orderField, changed, episodeNumbers, false);
    }

    /** 按稳定标识合并普通条目数组。 */
    private JSONArray mergeArray(JSONArray source, JSONArray proposed, Set<String> selected, String orderField,
                                 List<String> changed) {
        return mergeArray(source, proposed, selected, orderField, changed, false, false);
    }

    /** 按稳定标识合并数组，并可为场次重排编号。 */
    private JSONArray mergeArray(JSONArray source, JSONArray proposed, Set<String> selected, String orderField,
                                 List<String> changed, boolean episodeNumbers, boolean scenes) {
        JSONArray result = new JSONArray();
        Map<String, JSONObject> oldById = new java.util.LinkedHashMap<>();
        Map<String, JSONObject> proposedById = new java.util.LinkedHashMap<>();
        if (source != null) for (int i = 0; i < source.size(); i++) oldById.put(source.getJSONObject(i).getString("id"), source.getJSONObject(i));
        if (proposed != null) for (int i = 0; i < proposed.size(); i++) proposedById.put(proposed.getJSONObject(i).getString("id"), proposed.getJSONObject(i));
        for (Map.Entry<String, JSONObject> entry : oldById.entrySet()) {
            String id = entry.getKey();
            JSONObject value = selected.contains(id) && proposedById.containsKey(id) ? proposedById.get(id) : entry.getValue();
            if (value != entry.getValue()) changed.add(id);
            result.add(value);
        }
        for (Map.Entry<String, JSONObject> entry : proposedById.entrySet()) {
            if (!oldById.containsKey(entry.getKey())) {
                result.add(entry.getValue());
                changed.add(entry.getKey());
            }
        }
        for (int i = 0; i < result.size(); i++) {
            JSONObject value = result.getJSONObject(i);
            value.put(orderField, i);
            if (episodeNumbers) value.put("episodeNumber", i + 1);
            if (scenes) value.put("sceneNumber", i + 1);
        }
        return result;
    }

    /** 收集结构条目中的稳定标识。 */
    private void collectIds(JSONArray items, Set<String> ids) {
        if (items != null) for (int i = 0; i < items.size(); i++) ids.add(items.getJSONObject(i).getString("id"));
    }

    /**
     * 勾选范围是否覆盖了现有内容的全部目标标识。
     * <p>
     * 覆盖全部时本次应用视为整套替换，未出现在草稿里的旧条目不再保留；只勾选一部分时仍按稳定标识逐条合并。
     * 现有内容为空时同样成立——此时本来就没有需要保留的旧内容。标识集合沿用
     * {@link #allAiDraftTargetIds(String, JSONObject)}，与 {@code selected} 的计算口径保持一处。
     *
     * @param selected Set&lt;String&gt; 本次勾选的目标标识
     * @param targetType String 草稿目标类型
     * @param source JSONObject 当前正式内容快照
     * @return boolean 是否覆盖全部
     */
    private boolean coversAll(Set<String> selected, String targetType, JSONObject source) {
        return selected.containsAll(allAiDraftTargetIds(targetType, source));
    }

    /** 合并结果。 */
    private record MergedAdaptationDraft(JSONObject data, List<String> changedTargetIds) { }

    /**
     * 提取AI目标当前内容，用于草稿生成与应用前冲突校验。
     *
     * @param snapshot ProjectSnapshot 完整项目快照
     * @param targetType String 目标类型
     * @param targetId String 目标稳定标识
     * @return JSONObject 目标内容快照
     */
    public JSONObject targetSnapshot(ScriptDtos.ProjectSnapshot snapshot, String targetType, String targetId) {
        Object target = switch (targetType) {
            case "overview" -> snapshot.project().overview();
            case "outline" -> new ScriptDtos.OutlineDraft(snapshot.project().outlineSections(), snapshot.project().storyEvents());
            case "characters" -> new ScriptDtos.CharacterDraft(snapshot.project().characters(), snapshot.project().characterRelations());
            case "world" -> new ScriptDtos.WorldDraft(snapshot.project().worldSetting(), snapshot.project().worldItems(), snapshot.project().locations());
            case "episodes" -> new ScriptDtos.EpisodePlanDraft(snapshot.project().episodes());
            case "episode" -> findEpisode(snapshot, targetId);
            case "scene" -> findScene(snapshot, targetId);
            case "block" -> findBlock(snapshot, targetId);
            default -> throw invalid("不支持的AI草稿目标类型");
        };
        return JSON.parseObject(JSON.toJSONString(target));
    }

    /**
     * 为AI服务持久化待确认草稿。
     *
     * @param userId 当前用户标识
     * @param projectId 剧本项目标识
     * @param revision 草稿生成时的修订号
     * @param actionType AI动作类型
     * @param targetType 目标类型
     * @param targetId 目标稳定标识
     * @param instruction 用户补充要求
     * @param model 文本模型标识
     * @param chargedCredits 已扣积分
     * @param sourceData 原内容快照
     * @param draftData AI草稿内容
     * @return 已持久化草稿
     */
    public Mono<ScriptDtos.AiDraft> saveAiDraft(Long userId, String projectId, long revision, String actionType,
                                                String targetType, String targetId, String instruction, String model,
                                                BigDecimal chargedCredits, JSONObject sourceData, JSONObject draftData) {
        // 单集草稿的场次与正文块标识由模型自造，必须在落库前换成唯一标识，否则应用时必然撞上其他项目。
        if ("episode".equals(targetType)) assignEpisodeIds(draftData);
        normalizeBlockOrigins(targetType, draftData);
        String draftId = UUID.randomUUID().toString();
        ScriptDtos.AiDraft draft = new ScriptDtos.AiDraft(draftId, projectId, actionType, targetType, targetId,
                revision, text(instruction), sourceData, draftData, model, chargedCredits, "pending", OffsetDateTime.now());
        return repository.createAiDraft(userId, draft).thenReturn(draft);
    }

    /**
     * 给单集草稿的场次与正文块分配服务端生成的唯一标识。
     *
     * <p>场次与正文块的标识是全局主键，模型自造的 {@code scene-1}、{@code block-1} 这类顺序短标识会撞上
     * 其他项目已占用的行（提示「场次标识已属于其他项目」）。而重新生成整集时模型还会重排场次、
     * 把已有正文块搬到别的场次，此时沿用模型回填的旧标识会撞上「标识已属于其他分集／场次」——
     * 只要保留旧标识就存在这种错位风险，因此这里一律换新。旧的一场场次与正文由
     * {@code mergeAdaptationDraft} 在勾选全量时按整套替换，不会因为换新标识而变成叠加。</p>
     *
     * @param draftData JSONObject 模型产出的单集草稿
     * @return void 无返回值
     */
    private void assignEpisodeIds(JSONObject draftData) {
        JSONArray scenes = draftData == null ? null : draftData.getJSONArray("scenes");
        if (scenes == null) return;
        for (int index = 0; index < scenes.size(); index++) {
            JSONObject scene = scenes.getJSONObject(index);
            scene.put("id", UUID.randomUUID().toString());
            JSONArray blocks = scene.getJSONArray("blocks");
            if (blocks == null) continue;
            for (int blockIndex = 0; blockIndex < blocks.size(); blockIndex++) {
                blocks.getJSONObject(blockIndex).put("id", UUID.randomUUID().toString());
            }
        }
    }

    /**
     * 把草稿正文块里的改编标记摘出来，改成结构化的来源字段。
     *
     * <p>此前提示词要求模型在正文里写「【改编创作】」，标记于是跟着正文进了正式剧本，还会被
     * 分集工作台与后续配音、成片链路一起带走；现在来源由 {@code origin} 字段表达，正文只放剧本内容。
     * 模型沿用旧习惯写出标记时，标记本身就是「这段是新增创作」的声明，据此补上 {@code adapted} 再摘掉标记。</p>
     *
     * @param targetType String 草稿目标类型
     * @param draftData JSONObject 模型产出的草稿
     * @return void 无返回值
     */
    private void normalizeBlockOrigins(String targetType, JSONObject draftData) {
        if (draftData == null) return;
        switch (targetType) {
            case "episode" -> {
                JSONArray scenes = draftData.getJSONArray("scenes");
                if (scenes == null) break;
                for (int index = 0; index < scenes.size(); index++) {
                    normalizeBlockOrigin(scenes.getJSONObject(index).getJSONArray("blocks"));
                }
            }
            case "scene" -> normalizeBlockOrigin(draftData.getJSONArray("blocks"));
            case "block" -> normalizeBlockOrigin(draftData);
            default -> { }
        }
    }

    /** 逐个正文块归一来源。 */
    private void normalizeBlockOrigin(JSONArray blocks) {
        if (blocks == null) return;
        for (int index = 0; index < blocks.size(); index++) {
            normalizeBlockOrigin(blocks.getJSONObject(index));
        }
    }

    /** 单个正文块：正文里的改编标记转成来源字段，并从正文摘掉；其余一律按原著事实处理。 */
    private void normalizeBlockOrigin(JSONObject block) {
        String content = block.getString("content");
        if (content != null && ADAPTATION_MARK.matcher(content).find()) {
            block.put("origin", ORIGIN_ADAPTED);
            block.put("content", ADAPTATION_MARK.matcher(content).replaceAll("").trim());
            return;
        }
        if (!ORIGIN_ADAPTED.equals(block.getString("origin"))) block.put("origin", ORIGIN_ORIGINAL);
    }

    /**
     * 为AI服务校验并创建分析报告。
     *
     * @param userId 当前用户标识
     * @param projectId 剧本项目标识
     * @param scopeType 分析范围
     * @param scopeId 单集范围标识
     * @param model 文本模型标识
     * @param chargedCredits 已扣积分
     * @param sourceRevision 分析对应修订号
     * @param generated Agent返回的分析结构
     * @return 已持久化分析报告
     */
    public Mono<ScriptDtos.AnalysisReport> saveAnalysisReport(Long userId, String projectId, String scopeType,
                                                              String scopeId, String model, BigDecimal chargedCredits,
                                                              long sourceRevision, ScriptDtos.GeneratedAnalysis generated) {
        String reportId = UUID.randomUUID().toString();
        List<ScriptDtos.AnalysisIssue> issues = new ArrayList<>();
        List<ScriptDtos.GeneratedAnalysisIssue> sourceIssues = generated.issues();
        for (int index = 0; index < sourceIssues.size(); index++) {
            ScriptDtos.GeneratedAnalysisIssue issue = sourceIssues.get(index);
            issues.add(new ScriptDtos.AnalysisIssue(UUID.randomUUID().toString(), text(issue.category()),
                    issue.severity(), blankToNull(issue.episodeId()), blankToNull(issue.sceneId()),
                    blankToNull(issue.blockId()), required(issue.title(), "分析问题标题"), required(issue.reason(), "分析依据"),
                    required(issue.suggestion(), "修改建议"), index));
        }
        ScriptDtos.AnalysisReport report = new ScriptDtos.AnalysisReport(reportId, projectId, scopeType, scopeId,
                required(generated.summary(), "分析总结"), model, chargedCredits, sourceRevision, OffsetDateTime.now(), issues);
        return transactionalOperator.transactional(repository.createAnalysisReport(report, userId)).thenReturn(report);
    }

    /**
     * 为AI服务查询当前用户的待确认草稿。
     *
     * @param userId 当前用户标识
     * @param projectId 剧本项目标识
     * @param draftId 草稿稳定标识
     * @return 待确认草稿
     */
    public Mono<ScriptDtos.AiDraft> getPendingAiDraft(Long userId, String projectId, String draftId) {
        return requireProject(userId, projectId).then(repository.getPendingAiDraft(projectId, draftId))
                .switchIfEmpty(notFound("待确认AI草稿不存在"));
    }

    /**
     * 根据目标类型校验并应用AI草稿数据。
     *
     * @param userId 当前用户标识
     * @param draft 待应用草稿
     * @param draftData 用户确认后的草稿数据
     * @param snapshot 应用前项目快照
     * @param expectedRevision 期望修订号
     * @return 正式数据写入完成信号
     */
    private Mono<Void> applyDraftData(Long userId, ScriptDtos.AiDraft draft, JSONObject draftData,
                                      ScriptDtos.ProjectSnapshot snapshot, long expectedRevision) {
        // 保存草稿时已归一，这里兜住仍在草稿里保留旧标记的存量草稿，保证正文落库前一定是干净的。
        normalizeBlockOrigins(draft.targetType(), draftData);
        try {
            return switch (draft.targetType()) {
                case "overview" -> "storyDirections".equals(draft.actionType())
                        ? applyStoryDirectionDraft(userId, draft.projectId(), expectedRevision,
                        validated(ScriptStructuredDraftParser.parseStoryDirectionDraft(draftData)),
                        snapshot.project().overview())
                        : applyOverviewDraft(userId, draft.projectId(), expectedRevision,
                        validated(draftData.toJavaObject(ScriptDtos.ProjectOverview.class)));
                case "outline" -> applyOutlineDraft(userId, draft.projectId(), expectedRevision,
                        ScriptStructuredDraftParser.parseOutlineDraft(draftData), snapshot);
                case "characters" -> applyCharacterDraft(userId, draft.projectId(), expectedRevision,
                        ScriptStructuredDraftParser.parseCharacterDraft(draftData));
                case "world" -> applyWorldDraft(userId, draft.projectId(), expectedRevision,
                        ScriptStructuredDraftParser.parseWorldDraft(draftData));
                case "episodes" -> applyEpisodePlanDraft(userId, draft.projectId(), expectedRevision,
                        ScriptStructuredDraftParser.parseEpisodePlanDraft(draftData));
                case "episode" -> applyEpisodeDraft(userId, draft.projectId(), expectedRevision,
                        validated(ScriptStructuredDraftParser.parseEpisodeDetail(draftData)), draft.targetId());
                case "scene" -> applySceneDraft(userId, draft.projectId(), expectedRevision,
                        validated(ScriptStructuredDraftParser.parseScene(draftData)), draft.targetId(), snapshot);
                case "block" -> applyBlockDraft(userId, draft.projectId(), expectedRevision,
                        validated(ScriptStructuredDraftParser.parseScriptBlock(draftData)), draft.targetId(), snapshot);
                default -> Mono.error(invalid("不支持的AI草稿目标类型"));
            };
        } catch (RuntimeException exception) {
            if (exception instanceof BusinessException businessException) throw businessException;
            if (exception instanceof ScriptStructuredDraftParser.DraftStructureException structureException) {
                throw invalid("AI草稿结构不合法：" + structureException.getMessage());
            }
            log.error("解析AI草稿结构失败: projectId={}, draftId={}, actionType={}, targetType={}, exceptionType={}",
                    draft.projectId(), draft.id(), draft.actionType(), draft.targetType(),
                    exception.getClass().getSimpleName(), exception);
            throw invalid("AI草稿结构不合法，无法应用");
        }
    }

    /**
     * 根据已应用AI草稿的目标类型精确标记漫剧下游影响。
     *
     * @param draft 已应用AI草稿
     * @param draftData 用户确认后的草稿数据
     * @param snapshot 应用前剧本快照
     * @return 新增影响记录数量
     */
    private Mono<Long> markAppliedDraftImpact(ScriptDtos.AiDraft draft, JSONObject draftData,
                                              ScriptDtos.ProjectSnapshot snapshot) {
        return switch (draft.targetType()) {
            case "overview", "outline", "episodes" -> comicDramaImpactService.markUpstreamChanges(
                    draft.projectId(), "overview", List.of(draft.projectId()), "应用AI剧本草稿：" + draft.actionType());
            case "characters" -> comicDramaImpactService.markUpstreamChanges(draft.projectId(), "character",
                    draftData.getJSONArray("characters") == null ? List.of() : draftData.getJSONArray("characters").stream()
                            .map(value -> ((JSONObject) value).getString("id")).filter(StringUtils::hasText).toList(),
                    "应用AI人物草稿");
            case "world" -> comicDramaImpactService.markUpstreamChanges(draft.projectId(), "world",
                    draftData.getJSONArray("locations") == null ? List.of() : draftData.getJSONArray("locations").stream()
                            .map(value -> ((JSONObject) value).getString("id")).filter(StringUtils::hasText).toList(),
                    "应用AI世界观草稿");
            case "episode" -> comicDramaImpactService.markUpstreamChanges(draft.projectId(), "episode",
                    List.of(draft.targetId()), "应用AI分集草稿");
            case "scene" -> comicDramaImpactService.markUpstreamChanges(draft.projectId(), "scene",
                    List.of(draft.targetId()), "应用AI场次草稿");
            case "block" -> {
                String sceneId = snapshot.episodeDetails().stream().flatMap(episode -> episode.scenes().stream())
                        .filter(scene -> scene.blocks().stream().anyMatch(block -> block.id().equals(draft.targetId())))
                        .map(ScriptDtos.Scene::id).findFirst().orElse(draft.projectId());
                yield comicDramaImpactService.markUpstreamChanges(draft.projectId(), "scene", List.of(sceneId), "应用AI正文块草稿");
            }
            default -> Mono.just(0L);
        };
    }

    /**
     * 应用故事概览草稿。
     *
     * @param userId 当前用户标识
     * @param projectId 剧本项目标识
     * @param expectedRevision 期望修订号
     * @param overview 故事概览草稿
     * @return 写入完成信号
     */
    private Mono<Void> applyOverviewDraft(Long userId, String projectId, long expectedRevision,
                                          ScriptDtos.ProjectOverview overview) {
        return repository.updateOverview(userId, projectId, expectedRevision, overview)
                .flatMap(this::requireRevisionAdvanced).then();
    }

    /**
     * 应用用户从候选方向中确认的故事方向。
     *
     * @param userId 当前用户标识
     * @param projectId 剧本项目标识
     * @param expectedRevision 期望修订号
     * @param draft 候选方向草稿
     * @param current 当前故事概览
     * @return 写入完成信号
     */
    private Mono<Void> applyStoryDirectionDraft(Long userId, String projectId, long expectedRevision,
                                                ScriptDtos.StoryDirectionDraft draft,
                                                ScriptDtos.ProjectOverview current) {
        if (draft.selectedIndex() >= draft.candidates().size()) throw invalid("请选择有效的候选故事方向");
        ScriptDtos.StoryDirection selected = validated(draft.candidates().get(draft.selectedIndex()));
        ScriptDtos.ProjectOverview overview = new ScriptDtos.ProjectOverview(current.title(), current.contentType(),
                current.genre(), selected.logline(), text(selected.synopsis()),
                current.targetDurationSeconds(), current.targetEpisodeCount(),
                current.narrativeStyle(), text(selected.theme()), current.mainPlot(), text(selected.mainConflict()),
                text(selected.endingDirection()));
        return applyOverviewDraft(userId, projectId, expectedRevision, validated(overview));
    }

    /**
     * 应用故事大纲草稿。
     *
     * @param userId 当前用户标识
     * @param projectId 剧本项目标识
     * @param expectedRevision 期望修订号
     * @param draft 大纲草稿
     * @param snapshot 当前项目快照
     * @return 写入完成信号
     */
    private Mono<Void> applyOutlineDraft(Long userId, String projectId, long expectedRevision,
                                         ScriptDtos.OutlineDraft draft, ScriptDtos.ProjectSnapshot snapshot) {
        if (draft == null || draft.sections() == null || draft.events() == null) throw invalid("AI大纲草稿结构不完整");
        draft.sections().forEach(this::validated);
        draft.events().forEach(this::validated);
        validateContinuousOrder(draft.sections().stream().map(ScriptDtos.OutlineSection::sortOrder).toList(), "大纲结构段");
        validateContinuousOrder(draft.events().stream().map(ScriptDtos.StoryEvent::sortOrder).toList(), "故事事件");
        Set<String> sectionIds = ids(draft.sections().stream().map(ScriptDtos.OutlineSection::id).toList(), "大纲结构段");
        ids(draft.events().stream().map(ScriptDtos.StoryEvent::id).toList(), "故事事件");
        draft.events().forEach(event -> requireOptionalReference(event.outlineSectionId(), sectionIds,
                "故事事件关联了不存在的大纲结构段"));
        Set<String> episodeIds = snapshot.project().episodes().stream().map(ScriptDtos.EpisodeSummary::id).collect(java.util.stream.Collectors.toSet());
        Set<String> sceneIds = snapshot.episodeDetails().stream().flatMap(episode -> episode.scenes().stream())
                .map(ScriptDtos.Scene::id).collect(java.util.stream.Collectors.toSet());
        Map<String, String> sceneParentIds = snapshot.episodeDetails().stream().flatMap(episode -> episode.scenes().stream()
                        .map(scene -> Map.entry(scene.id(), episode.episode().id())))
                .collect(java.util.stream.Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));
        draft.events().forEach(event -> {
            requireOptionalReference(event.episodeId(), episodeIds, "故事事件关联了不存在的分集");
            requireOptionalReference(event.sceneId(), sceneIds, "故事事件关联了不存在的场次");
            requireStoryEventSceneReference(event, sceneParentIds, "故事事件场次不属于对应分集");
        });
        return requireStableIdsAvailable(projectId, "outline", draft.sections().stream().map(ScriptDtos.OutlineSection::id).toList(), "大纲结构段标识已属于其他项目")
                .then(requireStableIdsAvailable(projectId, "event", draft.events().stream().map(ScriptDtos.StoryEvent::id).toList(), "故事事件标识已属于其他项目"))
                .then(advance(userId, projectId, expectedRevision)).then(repository.replaceOutline(projectId, draft.sections(), draft.events()));
    }

    /**
     * 保留当前项目已有大纲标识，为新增结构段和事件分配唯一标识并同步结构段引用。
     *
     * @param draftData JSONObject 用户确认的大纲草稿，就地更新正式标识
     * @param snapshot ProjectSnapshot 当前项目完整快照
     * @return void 无返回值
     * @throws BusinessException 草稿标识重复、字段非法或结构段引用不存在时抛出
     */
    private void assignOutlineIds(JSONObject draftData, ScriptDtos.ProjectSnapshot snapshot) {
        ScriptDtos.OutlineDraft draft;
        try {
            draft = ScriptStructuredDraftParser.parseOutlineDraft(draftData);
        } catch (ScriptStructuredDraftParser.DraftStructureException exception) {
            throw invalid("AI草稿结构不合法：" + exception.getMessage());
        }
        // 先检查草稿内的标识和关联，禁止通过换新标识掩盖重复条目或错误引用。
        draft.sections().forEach(this::validated);
        draft.events().forEach(this::validated);
        Set<String> draftSectionIds = ids(draft.sections().stream().map(ScriptDtos.OutlineSection::id).toList(), "大纲结构段");
        ids(draft.events().stream().map(ScriptDtos.StoryEvent::id).toList(), "故事事件");
        draft.events().forEach(event -> requireOptionalReference(event.outlineSectionId(), draftSectionIds,
                "故事事件关联了不存在的大纲结构段"));
        Set<String> existingSectionIds = snapshot.project().outlineSections().stream()
                .map(ScriptDtos.OutlineSection::id).collect(java.util.stream.Collectors.toSet());
        Set<String> existingEventIds = snapshot.project().storyEvents().stream()
                .map(ScriptDtos.StoryEvent::id).collect(java.util.stream.Collectors.toSet());
        Map<String, String> sectionIds = new java.util.HashMap<>();
        List<ScriptDtos.OutlineSection> sections = draft.sections().stream().map(section -> {
            String id = existingSectionIds.contains(section.id()) ? section.id() : UUID.randomUUID().toString();
            sectionIds.put(section.id(), id);
            return new ScriptDtos.OutlineSection(id, section.sectionType(), section.title(), section.content(), section.sortOrder());
        }).toList();
        List<ScriptDtos.StoryEvent> events = draft.events().stream().map(event -> new ScriptDtos.StoryEvent(
                existingEventIds.contains(event.id()) ? event.id() : UUID.randomUUID().toString(),
                StringUtils.hasText(event.outlineSectionId()) ? sectionIds.get(event.outlineSectionId()) : event.outlineSectionId(),
                event.episodeId(), event.sceneId(), event.eventType(), event.title(), event.description(), event.sortOrder())).toList();
        draftData.putAll(JSON.parseObject(JSON.toJSONString(new ScriptDtos.OutlineDraft(sections, events))));
    }

    /**
     * 应用人物与人物关系草稿。
     *
     * @param userId 当前用户标识
     * @param projectId 剧本项目标识
     * @param expectedRevision 期望修订号
     * @param draft 人物草稿
     * @return 写入完成信号
     */
    private Mono<Void> applyCharacterDraft(Long userId, String projectId, long expectedRevision,
                                           ScriptDtos.CharacterDraft draft) {
        if (draft == null || draft.characters() == null || draft.relations() == null) throw invalid("AI人物草稿结构不完整");
        draft.characters().forEach(this::validated);
        draft.relations().forEach(this::validated);
        validateContinuousOrder(draft.characters().stream().map(ScriptDtos.Character::sortOrder).toList(), "人物");
        validateContinuousOrder(draft.relations().stream().map(ScriptDtos.CharacterRelation::sortOrder).toList(), "人物关系");
        Set<String> characterIds = ids(draft.characters().stream().map(ScriptDtos.Character::id).toList(), "人物");
        ids(draft.relations().stream().map(ScriptDtos.CharacterRelation::id).toList(), "人物关系");
        draft.relations().forEach(relation -> {
            requireReference(relation.sourceCharacterId(), characterIds, "人物关系起点不存在");
            requireReference(relation.targetCharacterId(), characterIds, "人物关系终点不存在");
            if (relation.sourceCharacterId().equals(relation.targetCharacterId())) throw invalid("人物关系不能指向同一人物");
        });
        return repository.listCharacters(projectId).map(ScriptDtos.Character::id)
                .filter(id -> !characterIds.contains(id)).collectList()
                .flatMap(deletedIds -> repository.countCharacterReferences(projectId, deletedIds)
                        .flatMap(referenceCount -> referenceCount > 0
                                ? repository.listCharacterReferenceLocations(projectId, deletedIds).collectList()
                                .flatMap(locations -> Mono.<Void>error(invalid("AI草稿删除的人物仍被引用："
                                        + String.join("、", locations) + "。请先移除对应场次或对白引用")))
                                : requireStableIdsAvailable(projectId, "character", draft.characters().stream().map(ScriptDtos.Character::id).toList(), "人物标识已属于其他项目")
                        .then(requireStableIdsAvailable(projectId, "relation", draft.relations().stream().map(ScriptDtos.CharacterRelation::id).toList(), "人物关系标识已属于其他项目"))
                        .then(advance(userId, projectId, expectedRevision))
                        .then(repository.replaceCharacters(projectId, draft.characters(), draft.relations()))));
    }

    /**
     * 应用世界观与地点草稿。
     *
     * @param userId 当前用户标识
     * @param projectId 剧本项目标识
     * @param expectedRevision 期望修订号
     * @param draft 世界观草稿
     * @return 写入完成信号
     */
    private Mono<Void> applyWorldDraft(Long userId, String projectId, long expectedRevision,
                                       ScriptDtos.WorldDraft draft) {
        if (draft == null || draft.worldSetting() == null || draft.worldItems() == null || draft.locations() == null) {
            throw invalid("AI世界观草稿结构不完整");
        }
        validated(draft.worldSetting());
        draft.worldItems().forEach(this::validated);
        draft.locations().forEach(this::validated);
        validateContinuousOrder(draft.worldItems().stream().map(ScriptDtos.WorldItem::sortOrder).toList(), "世界观条目");
        validateContinuousOrder(draft.locations().stream().map(ScriptDtos.Location::sortOrder).toList(), "地点");
        ids(draft.worldItems().stream().map(ScriptDtos.WorldItem::id).toList(), "世界观条目");
        Set<String> locationIds = ids(draft.locations().stream().map(ScriptDtos.Location::id).toList(), "地点");
        return repository.listLocations(projectId).map(ScriptDtos.Location::id).filter(id -> !locationIds.contains(id)).collectList()
                .flatMap(deletedIds -> repository.countLocationReferences(projectId, deletedIds)
                        .flatMap(referenceCount -> referenceCount > 0
                                ? repository.listLocationReferenceLocations(projectId, deletedIds).collectList()
                                .flatMap(locations -> Mono.<Void>error(invalid("AI草稿删除的地点仍被引用："
                                        + String.join("、", locations) + "。请先修改对应场次")))
                                : requireStableIdsAvailable(projectId, "worldItem", draft.worldItems().stream().map(ScriptDtos.WorldItem::id).toList(), "世界观条目标识已属于其他项目")
                        .then(requireStableIdsAvailable(projectId, "location", draft.locations().stream().map(ScriptDtos.Location::id).toList(), "地点标识已属于其他项目"))
                        .then(advance(userId, projectId, expectedRevision))
                        .then(repository.replaceWorld(projectId, draft.worldSetting(), draft.worldItems(), draft.locations()))));
    }

    /**
     * 应用分集规划草稿。
     *
     * @param userId 当前用户标识
     * @param projectId 剧本项目标识
     * @param expectedRevision 期望修订号
     * @param draft 分集规划草稿
     * @return 写入完成信号
     */
    private Mono<Void> applyEpisodePlanDraft(Long userId, String projectId, long expectedRevision,
                                             ScriptDtos.EpisodePlanDraft draft) {
        if (draft == null || draft.episodes() == null || draft.episodes().isEmpty()) throw invalid("AI分集规划不能为空");
        draft.episodes().forEach(this::validated);
        validateContinuousOrder(draft.episodes().stream().map(ScriptDtos.EpisodeSummary::sortOrder).toList(), "分集");
        ids(draft.episodes().stream().map(ScriptDtos.EpisodeSummary::id).toList(), "分集");
        for (ScriptDtos.EpisodeSummary episode : draft.episodes()) {
            if (episode.episodeNumber() != episode.sortOrder() + 1) throw invalid("集号必须与当前顺序连续一致");
        }
        return requireStableIdsAvailable(projectId, "episode", draft.episodes().stream().map(ScriptDtos.EpisodeSummary::id).toList(), "分集标识已属于其他项目")
                .then(advance(userId, projectId, expectedRevision)).then(repository.replaceEpisodePlan(projectId, draft.episodes()));
    }

    /**
     * 应用整集场次和正文草稿。
     *
     * @param userId 当前用户标识
     * @param projectId 剧本项目标识
     * @param expectedRevision 期望修订号
     * @param detail 单集草稿
     * @param targetId 目标分集标识
     * @return 写入完成信号
     */
    private Mono<Void> applyEpisodeDraft(Long userId, String projectId, long expectedRevision,
                                         ScriptDtos.EpisodeDetail detail, String targetId) {
        if (detail == null || detail.episode() == null || !detail.episode().id().equals(targetId)) {
            throw invalid("AI单集草稿与目标分集不匹配");
        }
        validateEpisode(detail);
        return Mono.zip(repository.listCharacters(projectId).map(ScriptDtos.Character::id).collectList(),
                        repository.listLocations(projectId).map(ScriptDtos.Location::id).collectList(),
                        repository.listEpisodes(projectId).collectList())
                .flatMap(references -> {
                    validateEpisodeReferences(detail, Set.copyOf(references.getT1()), Set.copyOf(references.getT2()));
                    validateEpisodePosition(references.getT3(), detail.episode());
                    List<String> sceneIds = detail.scenes().stream().map(ScriptDtos.Scene::id).toList();
                    List<String> blockIds = detail.scenes().stream().flatMap(scene -> scene.blocks().stream())
                            .map(ScriptDtos.ScriptBlock::id).toList();
                    return requireStableIdsAvailable(projectId, "episode", List.of(detail.episode().id()), "分集标识已属于其他项目")
                            .then(requireStableIdsAvailable(projectId, "scene", sceneIds, "场次标识已属于其他项目"))
                            .then(requireStableIdsAvailable(projectId, "block", blockIds, "正文块标识已属于其他项目"))
                            .then(requireEpisodeParentIds(detail))
                            .then(advance(userId, projectId, expectedRevision)).then(repository.replaceEpisode(projectId, detail));
                });
    }

    /**
     * 应用单场草稿并保留同集其他场次。
     *
     * @param userId 当前用户标识
     * @param projectId 剧本项目标识
     * @param expectedRevision 期望修订号
     * @param scene 单场草稿
     * @param targetId 目标场次标识
     * @param snapshot 当前项目快照
     * @return 写入完成信号
     */
    private Mono<Void> applySceneDraft(Long userId, String projectId, long expectedRevision, ScriptDtos.Scene scene,
                                       String targetId, ScriptDtos.ProjectSnapshot snapshot) {
        if (scene == null || !scene.id().equals(targetId)) throw invalid("AI场次草稿与目标场次不匹配");
        ScriptDtos.EpisodeDetail parent = findEpisodeByScene(snapshot, targetId);
        List<ScriptDtos.Scene> scenes = parent.scenes().stream().map(item -> item.id().equals(targetId) ? scene : item).toList();
        return applyEpisodeDraft(userId, projectId, expectedRevision,
                new ScriptDtos.EpisodeDetail(parent.episode(), scenes), parent.episode().id());
    }

    /**
     * 应用单正文块草稿并保留同场其他内容。
     *
     * @param userId 当前用户标识
     * @param projectId 剧本项目标识
     * @param expectedRevision 期望修订号
     * @param block 正文块草稿
     * @param targetId 目标正文块标识
     * @param snapshot 当前项目快照
     * @return 写入完成信号
     */
    private Mono<Void> applyBlockDraft(Long userId, String projectId, long expectedRevision, ScriptDtos.ScriptBlock block,
                                       String targetId, ScriptDtos.ProjectSnapshot snapshot) {
        if (block == null || !block.id().equals(targetId)) throw invalid("AI正文块草稿与目标正文块不匹配");
        ScriptDtos.EpisodeDetail parentEpisode = findEpisodeByBlock(snapshot, targetId);
        List<ScriptDtos.Scene> scenes = parentEpisode.scenes().stream().map(scene -> {
            List<ScriptDtos.ScriptBlock> blocks = scene.blocks().stream()
                    .map(item -> item.id().equals(targetId) ? block : item).toList();
            return new ScriptDtos.Scene(scene.id(), scene.locationId(), scene.sceneNumber(), scene.title(),
                    scene.interiorExterior(), scene.timeDescription(), scene.sceneGoal(), scene.actionSummary(),
                    scene.transitionDescription(), scene.previousRelation(), scene.nextRelation(), scene.sortOrder(),
                    scene.characterIds(), blocks);
        }).toList();
        return applyEpisodeDraft(userId, projectId, expectedRevision,
                new ScriptDtos.EpisodeDetail(parentEpisode.episode(), scenes), parentEpisode.episode().id());
    }

    /**
     * 加载已完成所有权校验的项目基础详情。
     *
     * @param userId 当前用户标识
     * @param projectId 剧本项目标识
     * @return 项目基础详情
     */
    private Mono<ScriptDtos.ProjectDetail> getProjectDetail(Long userId, String projectId) {
        Mono<ScriptRepository.ProjectRecord> project = requireProject(userId, projectId);
        Mono<List<ScriptDtos.OutlineSection>> outlines = repository.listOutlineSections(projectId).collectList();
        Mono<List<ScriptDtos.StoryEvent>> events = repository.listStoryEvents(projectId).collectList();
        Mono<List<ScriptDtos.Character>> characters = repository.listCharacters(projectId).collectList();
        Mono<List<ScriptDtos.CharacterRelation>> relations = repository.listCharacterRelations(projectId).collectList();
        Mono<ScriptDtos.WorldSetting> world = repository.getWorldSetting(projectId);
        Mono<List<ScriptDtos.WorldItem>> worldItems = repository.listWorldItems(projectId).collectList();
        Mono<List<ScriptDtos.Location>> locations = repository.listLocations(projectId).collectList();
        Mono<List<ScriptDtos.EpisodeSummary>> episodes = repository.listEpisodes(projectId).collectList();
        // 空串表示该项目不是由导入原文创建的，前端据此直接显示空状态而不再请求原文接口。
        Mono<String> sourceType = scriptSourceRepository.findSourceTypeByProject(userId, projectId).defaultIfEmpty("");
        return Mono.zip(project, Mono.zip(outlines, events, characters, relations), Mono.zip(world, worldItems, locations, episodes), sourceType)
                .map(tuple -> {
                    ScriptRepository.ProjectRecord record = tuple.getT1();
                    var story = tuple.getT2();
                    var setting = tuple.getT3();
                    return new ScriptDtos.ProjectDetail(record.id(), tuple.getT4(), record.overview(), story.getT1(), story.getT2(),
                            story.getT3(), story.getT4(), setting.getT1(), setting.getT2(), setting.getT3(), setting.getT4(),
                            record.stage(), record.completionRate(), record.productionStartedAt() != null, record.revision(),
                            record.createdAt(), record.updatedAt());
                });
    }

    /**
     * 加载单集全部场次及正文。
     *
     * @param projectId 剧本项目标识
     * @param episodeId 分集稳定标识
     * @return 单集完整内容
     */
    private Mono<ScriptDtos.EpisodeDetail> loadEpisode(String projectId, String episodeId) {
        return repository.getEpisode(projectId, episodeId).switchIfEmpty(notFound("分集不存在"))
                .flatMap(episode -> repository.listScenes(episodeId).concatMap(scene -> Mono.zip(
                        repository.listSceneCharacterIds(scene.id()).collectList(), repository.listBlocks(scene.id()).collectList(),
                        (characterIds, blocks) -> new ScriptDtos.Scene(scene.id(), scene.locationId(), scene.sceneNumber(), scene.title(),
                                scene.interiorExterior(), scene.timeDescription(), scene.sceneGoal(), scene.actionSummary(),
                                scene.transitionDescription(), scene.previousRelation(), scene.nextRelation(), scene.sortOrder(),
                                characterIds, blocks))).collectList().map(scenes -> new ScriptDtos.EpisodeDetail(episode, scenes)));
    }

    /**
     * 创建包含全部分集正文的项目快照。
     *
     * @param userId 当前用户标识
     * @param projectId 剧本项目标识
     * @return 完整项目快照
     */
    private Mono<ScriptDtos.ProjectSnapshot> createSnapshot(Long userId, String projectId) {
        return getProjectDetail(userId, projectId).flatMap(project -> Flux.fromIterable(project.episodes())
                .concatMap(episode -> loadEpisode(projectId, episode.id())).collectList()
                .map(episodes -> new ScriptDtos.ProjectSnapshot(project, episodes)));
    }

    /**
     * 重新计算并保存项目阶段与完成度。
     *
     * @param userId 当前用户标识
     * @param projectId 剧本项目标识
     * @return 最新项目修订信息
     */
    private Mono<ScriptDtos.MutationResult> recalculateProgress(Long userId, String projectId) {
        return Mono.defer(() -> getProjectDetail(userId, projectId).flatMap(project -> {
            int completion = calculateCompletion(project);
            String stage = calculateStage(project, completion);
            return repository.updateProgress(projectId, stage, completion)
                    .then(repository.getProject(userId, projectId)).map(this::mutationResult);
        }));
    }

    /**
     * 按产品固定权重计算完成度。
     *
     * @param project 项目基础详情
     * @return 0至100的完成度
     */
    private int calculateCompletion(ScriptDtos.ProjectDetail project) {
        ScriptDtos.ProjectOverview overview = project.overview();
        int result = StringUtils.hasText(overview.logline()) && StringUtils.hasText(overview.synopsis())
                && StringUtils.hasText(overview.mainPlot()) && StringUtils.hasText(overview.mainConflict()) ? 20 : 0;
        boolean outlineReady = !project.outlineSections().isEmpty()
                && project.outlineSections().stream().allMatch(section -> StringUtils.hasText(section.content()));
        result += outlineReady ? 20 : 0;
        boolean settingsReady = !project.characters().isEmpty() && !project.locations().isEmpty()
                && (StringUtils.hasText(project.worldSetting().era()) || StringUtils.hasText(project.worldSetting().socialBackground())
                || !project.worldItems().isEmpty());
        result += settingsReady ? 20 : 0;
        long completedEpisodes = project.episodes().stream().filter(episode -> "complete".equals(episode.completionStatus())).count();
        result += (int) Math.round(40D * Math.min(completedEpisodes, overview.targetEpisodeCount()) / overview.targetEpisodeCount());
        return Math.min(100, result);
    }

    /**
     * 依据内容与生产状态推导项目阶段。
     *
     * @param project 项目基础详情
     * @param completion 当前完成度
     * @return 自动推导的阶段标识
     */
    private String calculateStage(ScriptDtos.ProjectDetail project, int completion) {
        if (project.productionStarted()) return "production";
        if (completion == 100) return "completed";
        if (!project.episodes().isEmpty()) return "writing";
        if (project.outlineSections().stream().anyMatch(section -> StringUtils.hasText(section.content()))) return "outline";
        return "idea";
    }

    /**
     * 校验并递增项目修订号。
     *
     * @param userId 当前用户标识
     * @param projectId 剧本项目标识
     * @param expectedRevision 期望修订号
     * @return 修订号递增完成信号
     */
    private Mono<Void> advance(Long userId, String projectId, long expectedRevision) {
        return repository.advanceRevision(userId, projectId, expectedRevision).flatMap(this::requireRevisionAdvanced).then();
    }

    /**
     * 校验待保存稳定标识没有归属于其他项目。
     *
     * @param projectId 当前项目标识
     * @param resourceType 资源类型
     * @param ids 待保存稳定标识
     * @param message 冲突提示
     * @return Mono&lt;Void&gt; 校验完成信号
     */
    private Mono<Void> requireStableIdsAvailable(String projectId, String resourceType, List<String> ids, String message) {
        return repository.countIdsOwnedByAnotherProject(projectId, resourceType, ids)
                .flatMap(count -> count == 0 ? Mono.empty() : Mono.error(invalid(message)));
    }

    /**
     * 校验场次和正文块的标识没有被当前项目内的其他分集或场次占用。
     *
     * @param detail 待保存的单集内容
     * @return Mono&lt;Void&gt; 校验完成信号
     */
    private Mono<Void> requireEpisodeParentIds(ScriptDtos.EpisodeDetail detail) {
        return repository.countIdsOwnedByAnotherParent(detail.episode().id(), "scene",
                        detail.scenes().stream().map(ScriptDtos.Scene::id).toList())
                .flatMap(count -> count == 0 ? Mono.<Void>empty() : Mono.error(invalid("场次标识已属于其他分集")))
                .thenMany(Flux.fromIterable(detail.scenes()).concatMap(scene -> repository
                        .countIdsOwnedByAnotherParent(scene.id(), "block",
                                scene.blocks().stream().map(ScriptDtos.ScriptBlock::id).toList())
                        .flatMap(count -> count == 0 ? Mono.<Void>empty() : Mono.error(invalid("正文块标识已属于其他场次")))))
                .then();
    }

    /**
     * 校验修订更新结果，未更新一行时返回数据冲突。
     *
     * @param updatedRows 数据库更新行数
     * @return 原更新行数
     */
    private Mono<Long> requireRevisionAdvanced(Long updatedRows) {
        return updatedRows == 1 ? Mono.just(updatedRows) : Mono.error(conflictException());
    }

    /**
     * 查询并校验项目当前修订号。
     *
     * @param userId 当前用户标识
     * @param projectId 剧本项目标识
     * @param expectedRevision 期望修订号
     * @return 项目记录
     */
    private Mono<ScriptRepository.ProjectRecord> requireProjectRevision(Long userId, String projectId, long expectedRevision) {
        return requireProject(userId, projectId).flatMap(project -> project.revision() == expectedRevision
                ? Mono.just(project) : Mono.error(conflictException()));
    }

    /**
     * 查询并校验项目所有权。
     *
     * @param userId 当前用户标识
     * @param projectId 剧本项目标识
     * @return 项目记录
     */
    private Mono<ScriptRepository.ProjectRecord> requireProject(Long userId, String projectId) {
        return repository.getProject(userId, projectId).switchIfEmpty(notFound("剧本项目不存在"));
    }

    /**
     * 校验单集内部排序和稳定标识。
     *
     * @param detail 单集完整内容
     * @return void 无返回值
     */
    private void validateEpisode(ScriptDtos.EpisodeDetail detail) {
        validateContinuousOrder(detail.scenes().stream().map(ScriptDtos.Scene::sortOrder).toList(), "场次");
        ids(detail.scenes().stream().map(ScriptDtos.Scene::id).toList(), "场次");
        ids(detail.scenes().stream().flatMap(scene -> scene.blocks().stream())
                .map(ScriptDtos.ScriptBlock::id).toList(), "正文块");
        for (ScriptDtos.Scene scene : detail.scenes()) {
            validateContinuousOrder(scene.blocks().stream().map(ScriptDtos.ScriptBlock::sortOrder).toList(), "正文块");
            ids(scene.characterIds(), "场次人物引用");
            if (scene.sceneNumber() != scene.sortOrder() + 1) throw invalid("场次编号必须与当前顺序连续一致");
        }
    }

    /**
     * 校验单集保存不会绕过专用排序接口改变集号或位置。
     *
     * @param episodes 当前项目分集摘要
     * @param candidate 待保存分集摘要
     * @return void 无返回值
     */
    private void validateEpisodePosition(List<ScriptDtos.EpisodeSummary> episodes, ScriptDtos.EpisodeSummary candidate) {
        ScriptDtos.EpisodeSummary current = episodes.stream().filter(episode -> episode.id().equals(candidate.id()))
                .findFirst().orElse(null);
        if (current != null && (current.sortOrder() != candidate.sortOrder()
                || current.episodeNumber() != candidate.episodeNumber())) {
            throw invalid("调整已有分集顺序和集号请使用分集排序功能");
        }
        if (current == null && (candidate.sortOrder() != episodes.size()
                || candidate.episodeNumber() != episodes.size() + 1)) {
            throw invalid("新分集必须追加到当前分集列表末尾");
        }
    }

    /**
     * 校验单集对当前人物和地点的引用。
     *
     * @param detail 单集完整内容
     * @param characterIds 当前项目人物标识集合
     * @param locationIds 当前项目地点标识集合
     * @return void 无返回值
     */
    private void validateEpisodeReferences(ScriptDtos.EpisodeDetail detail, Set<String> characterIds, Set<String> locationIds) {
        for (ScriptDtos.Scene scene : detail.scenes()) {
            requireOptionalReference(scene.locationId(), locationIds, "场次关联了不存在的地点");
            scene.characterIds().forEach(id -> requireReference(id, characterIds, "场次关联了不存在的人物"));
            scene.blocks().forEach(block -> {
                if ("dialogue".equals(block.blockType())) {
                    requireReference(block.characterId(), characterIds, "对白关联了不存在的人物");
                    requireReference(block.characterId(), Set.copyOf(scene.characterIds()), "对白人物必须出现在当前场次");
                } else if (StringUtils.hasText(block.characterId())) {
                    throw invalid("只有对白正文块可以关联人物");
                }
            });
        }
    }

    /**
     * 校验版本快照属于当前项目且结构完整。
     *
     * @param projectId 当前项目标识
     * @param snapshot 待恢复版本快照
     * @return void 无返回值
     */
    private void validateSnapshot(String projectId, ScriptDtos.ProjectSnapshot snapshot) {
        if (snapshot == null || snapshot.project() == null || !projectId.equals(snapshot.project().id())) {
            throw invalid("版本快照与当前项目不匹配");
        }
        validated(snapshot.project().overview());
        if (snapshot.project().outlineSections() == null || snapshot.project().storyEvents() == null
                || snapshot.project().characters() == null || snapshot.project().characterRelations() == null
                || snapshot.project().worldSetting() == null || snapshot.project().worldItems() == null
                || snapshot.project().locations() == null || snapshot.project().episodes() == null
                || snapshot.episodeDetails() == null) {
            throw invalid("版本快照结构不完整");
        }
        snapshot.project().outlineSections().forEach(this::validated);
        snapshot.project().storyEvents().forEach(this::validated);
        snapshot.project().characters().forEach(this::validated);
        snapshot.project().characterRelations().forEach(this::validated);
        validated(snapshot.project().worldSetting());
        snapshot.project().worldItems().forEach(this::validated);
        snapshot.project().locations().forEach(this::validated);
        snapshot.project().episodes().forEach(this::validated);
        snapshot.episodeDetails().forEach(this::validated);
        validateContinuousOrder(snapshot.project().outlineSections().stream().map(ScriptDtos.OutlineSection::sortOrder).toList(), "大纲结构段");
        validateContinuousOrder(snapshot.project().storyEvents().stream().map(ScriptDtos.StoryEvent::sortOrder).toList(), "故事事件");
        validateContinuousOrder(snapshot.project().characters().stream().map(ScriptDtos.Character::sortOrder).toList(), "人物");
        validateContinuousOrder(snapshot.project().characterRelations().stream().map(ScriptDtos.CharacterRelation::sortOrder).toList(), "人物关系");
        validateContinuousOrder(snapshot.project().worldItems().stream().map(ScriptDtos.WorldItem::sortOrder).toList(), "世界观条目");
        validateContinuousOrder(snapshot.project().locations().stream().map(ScriptDtos.Location::sortOrder).toList(), "地点");
        validateContinuousOrder(snapshot.project().episodes().stream().map(ScriptDtos.EpisodeSummary::sortOrder).toList(), "分集");
        Set<String> outlineIds = ids(snapshot.project().outlineSections().stream().map(ScriptDtos.OutlineSection::id).toList(), "大纲结构段");
        Set<String> characterIds = ids(snapshot.project().characters().stream().map(ScriptDtos.Character::id).toList(), "人物");
        Set<String> locationIds = ids(snapshot.project().locations().stream().map(ScriptDtos.Location::id).toList(), "地点");
        Set<String> episodeIds = ids(snapshot.project().episodes().stream().map(ScriptDtos.EpisodeSummary::id).toList(), "分集");
        snapshot.project().episodes().forEach(episode -> {
            if (episode.episodeNumber() != episode.sortOrder() + 1) throw invalid("版本快照的集号与顺序不一致");
        });
        Map<String, ScriptDtos.EpisodeSummary> episodeById = snapshot.project().episodes().stream()
                .collect(java.util.stream.Collectors.toMap(ScriptDtos.EpisodeSummary::id, episode -> episode));
        Set<String> detailEpisodeIds = ids(snapshot.episodeDetails().stream().map(detail -> detail.episode().id()).toList(), "分集正文");
        if (!episodeIds.equals(detailEpisodeIds)) throw invalid("版本快照的分集摘要与正文不一致");
        snapshot.episodeDetails().forEach(detail -> {
            if (!detail.episode().equals(episodeById.get(detail.episode().id()))) {
                throw invalid("版本快照的分集摘要与正文内容不一致");
            }
        });
        snapshot.project().characterRelations().forEach(relation -> {
            requireReference(relation.sourceCharacterId(), characterIds, "版本快照人物关系起点不存在");
            requireReference(relation.targetCharacterId(), characterIds, "版本快照人物关系终点不存在");
        });
        List<String> snapshotSceneIds = snapshot.episodeDetails().stream().flatMap(detail -> detail.scenes().stream())
                .map(ScriptDtos.Scene::id).toList();
        Set<String> sceneIds = ids(snapshotSceneIds, "场次");
        Map<String, String> sceneParentIds = snapshot.episodeDetails().stream().flatMap(detail -> detail.scenes().stream()
                        .map(scene -> Map.entry(scene.id(), detail.episode().id())))
                .collect(java.util.stream.Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));
        ids(snapshot.episodeDetails().stream().flatMap(detail -> detail.scenes().stream())
                .flatMap(scene -> scene.blocks().stream()).map(ScriptDtos.ScriptBlock::id).toList(), "正文块");
        snapshot.project().storyEvents().forEach(event -> {
            requireOptionalReference(event.outlineSectionId(), outlineIds, "版本快照故事事件的大纲引用不存在");
            requireOptionalReference(event.episodeId(), episodeIds, "版本快照故事事件的分集引用不存在");
            requireOptionalReference(event.sceneId(), sceneIds, "版本快照故事事件的场次引用不存在");
            requireStoryEventSceneReference(event, sceneParentIds, "版本快照故事事件的场次不属于对应分集");
        });
        snapshot.episodeDetails().forEach(detail -> {
            validateEpisode(detail);
            validateEpisodeReferences(detail, characterIds, locationIds);
        });
    }

    /**
     * 校验版本快照中的全部稳定标识未被其他项目占用。
     *
     * @param projectId 当前项目标识
     * @param snapshot 待恢复的完整版本快照
     * @return Mono&lt;Void&gt; 全部标识归属校验完成信号
     */
    private Mono<Void> requireSnapshotStableIdsAvailable(String projectId, ScriptDtos.ProjectSnapshot snapshot) {
        List<String> sceneIds = snapshot.episodeDetails().stream().flatMap(detail -> detail.scenes().stream())
                .map(ScriptDtos.Scene::id).toList();
        List<String> blockIds = snapshot.episodeDetails().stream().flatMap(detail -> detail.scenes().stream())
                .flatMap(scene -> scene.blocks().stream()).map(ScriptDtos.ScriptBlock::id).toList();
        return Mono.when(
                requireStableIdsAvailable(projectId, "outline", snapshot.project().outlineSections().stream()
                        .map(ScriptDtos.OutlineSection::id).toList(), "版本中的大纲结构段标识已属于其他项目"),
                requireStableIdsAvailable(projectId, "event", snapshot.project().storyEvents().stream()
                        .map(ScriptDtos.StoryEvent::id).toList(), "版本中的故事事件标识已属于其他项目"),
                requireStableIdsAvailable(projectId, "character", snapshot.project().characters().stream()
                        .map(ScriptDtos.Character::id).toList(), "版本中的人物标识已属于其他项目"),
                requireStableIdsAvailable(projectId, "relation", snapshot.project().characterRelations().stream()
                        .map(ScriptDtos.CharacterRelation::id).toList(), "版本中的人物关系标识已属于其他项目"),
                requireStableIdsAvailable(projectId, "worldItem", snapshot.project().worldItems().stream()
                        .map(ScriptDtos.WorldItem::id).toList(), "版本中的世界观条目标识已属于其他项目"),
                requireStableIdsAvailable(projectId, "location", snapshot.project().locations().stream()
                        .map(ScriptDtos.Location::id).toList(), "版本中的地点标识已属于其他项目"),
                requireStableIdsAvailable(projectId, "episode", snapshot.project().episodes().stream()
                        .map(ScriptDtos.EpisodeSummary::id).toList(), "版本中的分集标识已属于其他项目"),
                requireStableIdsAvailable(projectId, "scene", sceneIds, "版本中的场次标识已属于其他项目"),
                requireStableIdsAvailable(projectId, "block", blockIds, "版本中的正文块标识已属于其他项目")
        ).then();
    }

    /**
     * 从快照查找目标分集。
     *
     * @param snapshot 项目快照
     * @param episodeId 分集标识
     * @return 目标分集完整内容
     */
    private ScriptDtos.EpisodeDetail findEpisode(ScriptDtos.ProjectSnapshot snapshot, String episodeId) {
        return snapshot.episodeDetails().stream().filter(episode -> episode.episode().id().equals(episodeId)).findFirst()
                .orElseThrow(() -> notFoundException("AI目标分集不存在"));
    }

    /**
     * 从快照查找目标场次。
     *
     * @param snapshot 项目快照
     * @param sceneId 场次标识
     * @return 目标场次
     */
    private ScriptDtos.Scene findScene(ScriptDtos.ProjectSnapshot snapshot, String sceneId) {
        return findEpisodeByScene(snapshot, sceneId).scenes().stream().filter(scene -> scene.id().equals(sceneId)).findFirst()
                .orElseThrow(() -> notFoundException("AI目标场次不存在"));
    }

    /**
     * 从快照查找目标正文块。
     *
     * @param snapshot 项目快照
     * @param blockId 正文块标识
     * @return 目标正文块
     */
    private ScriptDtos.ScriptBlock findBlock(ScriptDtos.ProjectSnapshot snapshot, String blockId) {
        return findEpisodeByBlock(snapshot, blockId).scenes().stream().flatMap(scene -> scene.blocks().stream())
                .filter(block -> block.id().equals(blockId)).findFirst()
                .orElseThrow(() -> notFoundException("AI目标正文块不存在"));
    }

    /**
     * 查找目标场次所在分集。
     *
     * @param snapshot 项目快照
     * @param sceneId 场次标识
     * @return 场次所属分集
     */
    private ScriptDtos.EpisodeDetail findEpisodeByScene(ScriptDtos.ProjectSnapshot snapshot, String sceneId) {
        return snapshot.episodeDetails().stream()
                .filter(episode -> episode.scenes().stream().anyMatch(scene -> scene.id().equals(sceneId))).findFirst()
                .orElseThrow(() -> notFoundException("AI目标场次不存在"));
    }

    /**
     * 查找目标正文块所在分集。
     *
     * @param snapshot 项目快照
     * @param blockId 正文块标识
     * @return 正文块所属分集
     */
    private ScriptDtos.EpisodeDetail findEpisodeByBlock(ScriptDtos.ProjectSnapshot snapshot, String blockId) {
        return snapshot.episodeDetails().stream().filter(episode -> episode.scenes().stream()
                        .anyMatch(scene -> scene.blocks().stream().anyMatch(block -> block.id().equals(blockId))))
                .findFirst().orElseThrow(() -> notFoundException("AI目标正文块不存在"));
    }

    /**
     * 使用Bean Validation校验AI编辑后的结构化数据。
     *
     * @param value 待校验结构
     * @param <T> 结构类型
     * @return 已通过校验的原结构
     */
    private <T> T validated(T value) {
        if (value == null) throw invalid("AI草稿结构不能为空");
        Set<ConstraintViolation<T>> violations = validator.validate(value);
        if (!violations.isEmpty()) {
            ConstraintViolation<T> violation = violations.stream()
                    .sorted((left, right) -> left.getPropertyPath().toString()
                            .compareTo(right.getPropertyPath().toString()))
                    .findFirst()
                    .orElseThrow();
            String propertyPath = violation.getPropertyPath().toString();
            String propertyPrefix = StringUtils.hasText(propertyPath) ? propertyPath + "：" : "";
            throw invalid("AI草稿结构不合法：" + propertyPrefix + violation.getMessage());
        }
        return value;
    }

    /**
     * 校验顺序必须从零连续且不重复。
     *
     * @param orders 排序值列表
     * @param subject 业务对象名称
     * @return void 无返回值
     */
    private void validateContinuousOrder(List<Integer> orders, String subject) {
        List<Integer> sorted = orders.stream().sorted().toList();
        for (int index = 0; index < sorted.size(); index++) {
            if (sorted.get(index) != index) throw invalid(subject + "顺序必须从0开始且连续不重复");
        }
    }

    /**
     * 校验标识不为空且不重复。
     *
     * @param values 稳定标识列表
     * @param subject 业务对象名称
     * @return 去重后的稳定标识集合
     */
    private Set<String> ids(List<String> values, String subject) {
        Set<String> result = new HashSet<>();
        for (String value : values) {
            if (!StringUtils.hasText(value) || !result.add(value)) throw invalid(subject + "标识不能为空或重复");
        }
        return result;
    }

    /**
     * 校验必需引用存在。
     *
     * @param id 引用标识
     * @param ids 允许引用的标识集合
     * @param message 校验失败提示
     * @return void 无返回值
     */
    private void requireReference(String id, Set<String> ids, String message) {
        if (!StringUtils.hasText(id) || !ids.contains(id)) throw invalid(message);
    }

    /**
     * 校验非空的可选引用存在。
     *
     * @param id 可选引用标识
     * @param ids 允许引用的标识集合
     * @param message 校验失败提示
     * @return void 无返回值
     */
    private void requireOptionalReference(String id, Set<String> ids, String message) {
        if (StringUtils.hasText(id) && !ids.contains(id)) throw invalid(message);
    }

    /**
     * 校验故事事件的场次存在，且填写分集时场次必须属于该分集。
     *
     * @param event 故事事件
     * @param sceneParentIds 场次与所属分集映射
     * @param message 校验失败提示
     * @return void 无返回值
     */
    private void requireStoryEventSceneReference(ScriptDtos.StoryEvent event, Map<String, String> sceneParentIds,
                                                 String message) {
        if (!StringUtils.hasText(event.sceneId())) return;
        String parentEpisodeId = sceneParentIds.get(event.sceneId());
        if (parentEpisodeId == null || StringUtils.hasText(event.episodeId())
                && !parentEpisodeId.equals(event.episodeId())) {
            throw invalid(message);
        }
    }

    /**
     * 从项目记录生成修改结果。
     *
     * @param project 最新项目记录
     * @return 修改结果
     */
    private ScriptDtos.MutationResult mutationResult(ScriptRepository.ProjectRecord project) {
        return new ScriptDtos.MutationResult(project.revision(), project.stage(), project.completionRate(), project.updatedAt());
    }

    /**
     * 生成准备度检查项。
     *
     * @param key 检查项稳定键
     * @param status 检查状态
     * @param title 检查项标题
     * @param description 检查说明
     * @param targetSection 对应工作台区块
     * @return 准备度检查项
     */
    private ScriptDtos.ReadinessItem readiness(String key, String status, String title, String description, String targetSection) {
        return new ScriptDtos.ReadinessItem(key, status, title, description, targetSection);
    }

    /**
     * 生成不使用模板的默认模板数据。
     *
     * @param contentType 内容形式
     * @return 空白模板数据
     */
    private ScriptDtos.ScriptTemplate emptyTemplate(String contentType) {
        return new ScriptDtos.ScriptTemplate("", "", "", "", text(contentType), "", "", 1, List.of());
    }

    /**
     * 读取并裁剪必填文本。
     *
     * @param value 原文本
     * @param field 字段名称
     * @return 非空规范文本
     */
    private String required(String value, String field) {
        if (!StringUtils.hasText(value)) throw invalid(field + "不能为空");
        return value.trim();
    }

    /**
     * 规范化可选文本。
     *
     * @param value 原文本
     * @return 非空裁剪文本
     */
    private String text(String value) {
        return value == null ? "" : value.trim();
    }

    /**
     * 将空白文本转为空值。
     *
     * @param value 原文本
     * @return 规范文本或空值
     */
    private String blankToNull(String value) {
        String normalized = text(value);
        return normalized.isEmpty() ? null : normalized;
    }

    /**
     * 创建参数无效异常。
     *
     * @param message 异常提示
     * @return 参数无效业务异常
     */
    private BusinessException invalid(String message) {
        return new BusinessException(ErrorCode.PARAM_INVALID, message);
    }

    /**
     * 创建数据冲突异常。
     *
     * @return 数据冲突业务异常
     */
    private BusinessException conflictException() {
        return new BusinessException(ErrorCode.DATA_CONFLICT, "剧本已在其他页面更新，请重新加载后继续编辑");
    }

    /**
     * 创建资源不存在异常。
     *
     * @param message 异常提示
     * @return 资源不存在业务异常
     */
    private BusinessException notFoundException(String message) {
        return new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, message);
    }

    /**
     * 创建资源不存在错误信号。
     *
     * @param message 异常提示
     * @param <T> 响应类型
     * @return 资源不存在错误信号
     */
    private <T> Mono<T> notFound(String message) {
        return Mono.error(notFoundException(message));
    }
}

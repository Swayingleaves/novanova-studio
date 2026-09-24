package com.novanovastudio.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.ScriptDtos;
import com.novanovastudio.repository.ScriptRepository;
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
     * 查询当前用户项目的分析报告列表。
     *
     * @param projectId 剧本项目标识
     * @return 分析报告摘要列表
     */
    public Mono<List<ScriptDtos.AnalysisReport>> listAnalysisReports(String projectId) {
        return currentUserProvider.currentUserId().flatMap(userId -> requireProject(userId, projectId)
                .then(repository.listAnalysisReports(projectId).collectList()));
    }

    /**
     * 查询分析报告及问题明细。
     *
     * @param projectId 剧本项目标识
     * @param reportId 分析报告标识
     * @return 分析报告详情
     */
    public Mono<ScriptDtos.AnalysisReport> getAnalysisReport(String projectId, String reportId) {
        return currentUserProvider.currentUserId().flatMap(userId -> requireProject(userId, projectId)
                .then(repository.getAnalysisReport(projectId, reportId)).switchIfEmpty(notFound("分析报告不存在"))
                .flatMap(report -> repository.listAnalysisIssues(report.id()).collectList().map(issues -> new ScriptDtos.AnalysisReport(
                        report.id(), report.projectId(), report.scopeType(), report.scopeId(), report.summary(), report.model(),
                        report.chargedCredits(), report.sourceRevision(), report.createdAt(), issues))));
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
                            Mono<Void> operation = repository.createVersion(UUID.randomUUID().toString(), request.projectId(), userId,
                                            "AI修改前", "ai", "应用AI动作：" + draft.actionType(), request.expectedRevision(),
                                            JSON.parseObject(JSON.toJSONString(snapshot)))
                                    .then(applyDraftData(userId, draft, request.draftData(), snapshot, request.expectedRevision()))
                                    .then(repository.updateAiDraftStatus(request.projectId(), request.draftId(), "applied", request.draftData())
                                            .flatMap(count -> count == 1 ? Mono.empty() : Mono.error(conflictException())));
                            return operation.then(recalculateProgress(userId, request.projectId()))
                                    .flatMap(result -> markAppliedDraftImpact(draft, request.draftData(), snapshot).thenReturn(result));
                        }));
                }));
    }

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
                                                int chargedCredits, JSONObject sourceData, JSONObject draftData) {
        String draftId = UUID.randomUUID().toString();
        ScriptDtos.AiDraft draft = new ScriptDtos.AiDraft(draftId, projectId, actionType, targetType, targetId,
                revision, text(instruction), sourceData, draftData, model, chargedCredits, "pending", OffsetDateTime.now());
        return repository.createAiDraft(userId, draft).thenReturn(draft);
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
                                                              String scopeId, String model, int chargedCredits,
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
        return Mono.zip(project, Mono.zip(outlines, events, characters, relations), Mono.zip(world, worldItems, locations, episodes))
                .map(tuple -> {
                    ScriptRepository.ProjectRecord record = tuple.getT1();
                    var story = tuple.getT2();
                    var setting = tuple.getT3();
                    return new ScriptDtos.ProjectDetail(record.id(), record.overview(), story.getT1(), story.getT2(),
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

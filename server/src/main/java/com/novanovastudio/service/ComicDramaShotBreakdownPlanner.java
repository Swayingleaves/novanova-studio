package com.novanovastudio.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.ComicDramaDtos;
import com.novanovastudio.dto.ScriptDtos;
import com.novanovastudio.dto.StoryboardDtos;
import com.novanovastudio.repository.ComicDramaRepository;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.util.StringUtils;

/**
 * 漫剧镜头智能拆分规划与场次结果合并器。
 * <p>
 * 优先按上游分集目标时长换算镜头数，未配置时长时区分对白语速与动作描写折算表演时长；
 * 拆分整集时按场次生成独立拆分计划并在合并阶段统一镜号、去重资产、保留场次归属。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-18 09:42
 */
final class ComicDramaShotBreakdownPlanner {

    /** 单次自动估算镜头数上限，为分镜Agent单次100镜硬限制留出安全余量。 */
    static final int MAX_AUTO_SHOT_COUNT = 80;

    /** 中文对白与旁白每秒折算字数。 */
    private static final double SPOKEN_UNITS_PER_SECOND = 4.0;

    /** 动作与环境描写每秒折算字数：画面细节与动作同步呈现，不按朗读语速计入时长。 */
    private static final double ACTION_UNITS_PER_SECOND = 12.0;

    /** 禁止实例化工具类。 */
    private ComicDramaShotBreakdownPlanner() {
    }

    /** 单次送入分镜Agent的场次或组合片段计划。 */
    record SegmentPlan(String episodeId, String sceneId, String scriptExcerpt, int targetShotCount,
                       StoryboardDtos.GenerateStoryboardRequest agentRequest) {
    }

    /** 完整拆分计划，包含分片列表、草稿展示指令、来源分集与剧本修订号。 */
    record BreakdownPlan(List<SegmentPlan> segments, String summaryInstruction, String resolvedEpisodeId,
                         String resolvedSceneId, String fullScriptExcerpt, long scriptRevision) {
    }

    /** 单个待入库镜头的来源归属。 */
    record ShotSourceOrigin(String episodeId, String sceneId, String scriptExcerpt) {
    }

    /** 草稿确认生效时的范围覆盖替换计划。 */
    record ReplacementPlan(List<String> replacedShotIds, List<ComicDramaDtos.Shot> keptBefore,
                           List<ComicDramaDtos.Shot> keptAfter) {
    }

    /**
     * 根据查询到的结构化场次列表构建分镜拆分计划。
     *
     * @param loadedScenes 所选分集或项目的全部结构化场次
     * @param request 用户拆镜请求
     * @return 可直接交由分镜Agent并发执行的拆分计划
     */
    static BreakdownPlan buildPlan(List<ComicDramaRepository.SceneGenerationSource> loadedScenes,
                                   ComicDramaDtos.GenerateShotDraftRequest request) {
        String requestedEpisodeId = trimToEmpty(request.episodeId());
        String requestedSceneId = trimToEmpty(request.sceneId());
        List<ComicDramaRepository.SceneGenerationSource> nonEmptyScenes = loadedScenes.stream()
                .filter(scene -> StringUtils.hasText(scene.bodyContent()))
                .toList();
        List<ComicDramaRepository.SceneGenerationSource> targetScenes = requestedSceneId.isEmpty()
                ? nonEmptyScenes
                : nonEmptyScenes.stream().filter(scene -> requestedSceneId.equals(scene.sceneId())).toList();
        if (targetScenes.isEmpty()) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "所选范围没有可用剧本正文");
        }
        long scriptRevision = targetScenes.getFirst().scriptRevision();
        String visualStyle = targetScenes.getFirst().visualStyle();
        String resolvedEpisodeId = !requestedEpisodeId.isEmpty() ? requestedEpisodeId
                : targetScenes.stream().map(ComicDramaRepository.SceneGenerationSource::episodeId)
                        .distinct().count() == 1 ? targetScenes.getFirst().episodeId() : "";
        String fullExcerpt = targetScenes.stream()
                .map(ComicDramaShotBreakdownPlanner::formatSceneScript)
                .collect(Collectors.joining("\n\n"));

        // 单场拆分，或用户手动指定的总镜头数少于场次数时，合并为单次请求以严格尊重用户指定数量。
        if (targetScenes.size() == 1 || (request.shotCount() != null && request.shotCount() < targetScenes.size())) {
            int targetShots = request.shotCount() != null
                    ? Math.min(StoryboardDtos.MAX_SHOT_COUNT, Math.max(1, request.shotCount()))
                    : estimateSceneShotCount(targetScenes.getFirst(), nonEmptyScenes, request.shotDuration());
            String singleSceneId = targetScenes.size() == 1 ? targetScenes.getFirst().sceneId() : requestedSceneId;
            String instruction = buildSegmentInstruction(targetShots, request);
            SegmentPlan segment = new SegmentPlan(resolvedEpisodeId, singleSceneId, fullExcerpt, targetShots,
                    new StoryboardDtos.GenerateStoryboardRequest(fullExcerpt, instruction, visualStyle, request.model()));
            return new BreakdownPlan(List.of(segment), instruction, resolvedEpisodeId, singleSceneId, fullExcerpt, scriptRevision);
        }

        // 多场次拆分：按分集目标时长或加权表演时长计算总镜头数，再按场次比重分配到各场并发生成。
        int totalShots = request.shotCount() != null
                ? request.shotCount()
                : estimateMultiSceneTotalShots(targetScenes, request.shotDuration());
        List<Integer> allocated = allocateShotsAcrossScenes(targetScenes, totalShots);
        List<SegmentPlan> segments = new ArrayList<>(targetScenes.size());
        for (int index = 0; index < targetScenes.size(); index++) {
            ComicDramaRepository.SceneGenerationSource scene = targetScenes.get(index);
            int sceneShots = allocated.get(index);
            String sceneScript = formatSceneScript(scene);
            String sceneInstruction = buildSegmentInstruction(sceneShots, request);
            segments.add(new SegmentPlan(scene.episodeId(), scene.sceneId(), sceneScript, sceneShots,
                    new StoryboardDtos.GenerateStoryboardRequest(sceneScript, sceneInstruction, scene.visualStyle(), request.model())));
        }
        String summaryInstruction = "按 " + targetScenes.size() + " 个场次拆分共约 "
                + allocated.stream().mapToInt(Integer::intValue).sum() + " 个镜头"
                + buildCommonInstructionSuffix(request);
        return new BreakdownPlan(segments, summaryInstruction, resolvedEpisodeId, requestedSceneId, fullExcerpt, scriptRevision);
    }

    /**
     * 合并各场次的分镜生成结果，连续重排镜号、按类型与名称合并资产，并记录每镜头的来源场次与摘录。
     *
     * @param plan 拆分计划
     * @param result 多片段生成结果
     * @param shotDuration 单镜头时长档位
     * @return 可直接存入 comic_drama_shot_drafts.draft_data 的JSON结构
     */
    static JSONObject mergeSegmentResults(BreakdownPlan plan, StoryboardAgentService.StoryboardSegmentsResult result,
                                          String shotDuration) {
        Map<String, StoryboardDtos.StoryboardAsset> mergedAssetsByKey = new LinkedHashMap<>();
        List<StoryboardDtos.StoryboardShot> mergedShots = new ArrayList<>();
        JSONObject shotSources = new JSONObject();
        int nextShotNumber = 1;

        for (int index = 0; index < plan.segments().size(); index++) {
            SegmentPlan segment = plan.segments().get(index);
            StoryboardDtos.GenerateStoryboardResponse response = result.segments().get(index);
            Map<String, String> assetIdRemap = new LinkedHashMap<>();
            for (StoryboardDtos.StoryboardAsset asset : response.assets() == null
                    ? List.<StoryboardDtos.StoryboardAsset>of() : response.assets()) {
                String mergeKey = asset.kind().trim() + "\u0000" + asset.name().trim();
                StoryboardDtos.StoryboardAsset existing = mergedAssetsByKey.get(mergeKey);
                if (existing == null) {
                    mergedAssetsByKey.put(mergeKey, asset);
                    assetIdRemap.put(asset.id(), asset.id());
                } else {
                    assetIdRemap.put(asset.id(), existing.id());
                    // 同名资产在后续场次给出了更完整的描述时，保留信息量更丰富的描述。
                    if (trimToEmpty(asset.description()).length() > trimToEmpty(existing.description()).length()) {
                        mergedAssetsByKey.put(mergeKey, new StoryboardDtos.StoryboardAsset(
                                existing.id(), existing.kind(), existing.name(), asset.description()));
                    }
                }
            }
            for (StoryboardDtos.StoryboardShot shot : response.shots()) {
                List<String> remappedAssetIds = shot.assetIds().stream()
                        .map(id -> assetIdRemap.getOrDefault(id, id))
                        .distinct()
                        .toList();
                StoryboardDtos.StoryboardShot aligned = new StoryboardDtos.StoryboardShot(
                        shot.id(), nextShotNumber++,
                        ComicDramaService.alignShotDuration(shotDuration, shot.durationSeconds()),
                        shot.visualDescription(), shot.shotSize(), shot.lightingAtmosphere(),
                        shot.dialogueVoiceover(), shot.soundEffect(), shot.cameraMovement(),
                        shot.finalPrompt(), remappedAssetIds);
                mergedShots.add(aligned);
                JSONObject origin = new JSONObject();
                origin.put("episodeId", segment.episodeId());
                origin.put("sceneId", segment.sceneId());
                origin.put("scriptExcerpt", segment.scriptExcerpt());
                shotSources.put(aligned.id(), origin);
            }
        }

        StoryboardDtos.GenerateStoryboardResponse combined = new StoryboardDtos.GenerateStoryboardResponse(
                List.copyOf(mergedShots), List.copyOf(mergedAssetsByKey.values()), result.chargedCredits());
        JSONObject data = (JSONObject) JSON.toJSON(combined);
        data.put("sourceScriptExcerpt", plan.fullScriptExcerpt());
        data.put("sourceEpisodeId", plan.resolvedEpisodeId());
        data.put("sourceSceneId", plan.resolvedSceneId());
        data.put("shotSources", shotSources);
        return data;
    }

    /**
     * 解析镜头草稿中某个镜头的来源分集、场次与剧本摘录，兼容未携带 shotSources 的旧草稿。
     *
     * @param draftData 草稿JSON数据
     * @param shotId 镜头稳定标识
     * @return 该镜头的来源归属
     */
    static ShotSourceOrigin resolveShotOrigin(JSONObject draftData, String shotId) {
        String fallbackEpisodeId = trimToEmpty(draftData.getString("sourceEpisodeId"));
        String fallbackSceneId = trimToEmpty(draftData.getString("sourceSceneId"));
        String fallbackExcerpt = trimToEmpty(draftData.getString("sourceScriptExcerpt"));
        JSONObject shotSources = draftData.getJSONObject("shotSources");
        JSONObject origin = shotSources == null ? null : shotSources.getJSONObject(shotId);
        if (origin == null) {
            return new ShotSourceOrigin(fallbackEpisodeId, fallbackSceneId, fallbackExcerpt);
        }
        String episodeId = trimToEmpty(origin.getString("episodeId"));
        String sceneId = trimToEmpty(origin.getString("sceneId"));
        String excerpt = trimToEmpty(origin.getString("scriptExcerpt"));
        return new ShotSourceOrigin(
                episodeId.isEmpty() ? fallbackEpisodeId : episodeId,
                sceneId.isEmpty() ? fallbackSceneId : sceneId,
                excerpt.isEmpty() ? fallbackExcerpt : excerpt);
    }

    /**
     * 收集草稿全部镜头涉及的去重分集与场次引用对，供入库事务前统一校验归属。
     *
     * @param draftData 草稿JSON数据
     * @param shots 待确认镜头列表
     * @return 去重后的分集与场次标识对
     */
    static Set<Map.Entry<String, String>> distinctSourceReferences(JSONObject draftData,
                                                                  List<StoryboardDtos.StoryboardShot> shots) {
        Set<Map.Entry<String, String>> references = new LinkedHashSet<>();
        for (StoryboardDtos.StoryboardShot shot : shots) {
            ShotSourceOrigin origin = resolveShotOrigin(draftData, shot.id());
            references.add(Map.entry(origin.episodeId(), origin.sceneId()));
        }
        return references;
    }

    /**
     * 计算确认镜头草稿时应覆盖替换的旧镜头及插入位置。
     * <p>
     * 拆分整集时覆盖该集原有镜头（单集项目同时清理历史未绑定分集的孤儿镜头），拆分单场时只覆盖该场原有镜头，
     * 其他分集或场次的镜头原样保留并按分集顺序插入重排。
     *
     * @param draft 待确认的镜头草稿
     * @param existingShots 项目当前按 sortOrder 排列的全部正式镜头
     * @param episodes 剧本分集列表
     * @return 覆盖替换计划
     */
    static ReplacementPlan planReplacement(ComicDramaDtos.ShotDraft draft,
                                           List<ComicDramaDtos.Shot> existingShots,
                                           List<ScriptDtos.EpisodeSummary> episodes) {
        String scopeType = trimToEmpty(draft.scopeType());
        String scopeId = trimToEmpty(draft.scopeId());
        if (scopeId.isEmpty()) {
            scopeId = "scene".equals(scopeType)
                    ? trimToEmpty(draft.draftData().getString("sourceSceneId"))
                    : "episode".equals(scopeType) ? trimToEmpty(draft.draftData().getString("sourceEpisodeId")) : "";
        }
        boolean singleEpisodeProject = episodes != null && episodes.size() == 1
                && scopeId.equals(trimToEmpty(episodes.getFirst().id()));
        List<String> replacedIds = new ArrayList<>();
        List<ComicDramaDtos.Shot> keptShots = new ArrayList<>();
        int firstReplacedPositionInKept = -1;

        for (ComicDramaDtos.Shot existing : existingShots) {
            boolean shouldReplace;
            if ("scene".equals(scopeType) && !scopeId.isEmpty()) {
                shouldReplace = scopeId.equals(trimToEmpty(existing.sourceSceneId()));
            } else if ("episode".equals(scopeType) && !scopeId.isEmpty()) {
                String shotEpisodeId = trimToEmpty(existing.sourceEpisodeId());
                shouldReplace = scopeId.equals(shotEpisodeId)
                        || (singleEpisodeProject && shotEpisodeId.isEmpty());
            } else {
                shouldReplace = true;
            }
            if (shouldReplace) {
                if (firstReplacedPositionInKept < 0) {
                    firstReplacedPositionInKept = keptShots.size();
                }
                replacedIds.add(existing.id());
            } else {
                keptShots.add(existing);
            }
        }

        int insertionIndex = firstReplacedPositionInKept >= 0
                ? firstReplacedPositionInKept
                : resolveEpisodeInsertionIndex(draft, scopeType, scopeId, keptShots, episodes);
        return new ReplacementPlan(
                List.copyOf(replacedIds),
                List.copyOf(keptShots.subList(0, insertionIndex)),
                List.copyOf(keptShots.subList(insertionIndex, keptShots.size())));
    }

    /** 当目标分集尚无旧镜头时，按分集集号将新镜头插入后续分集镜头之前。 */
    private static int resolveEpisodeInsertionIndex(ComicDramaDtos.ShotDraft draft, String scopeType, String scopeId,
                                                    List<ComicDramaDtos.Shot> keptShots,
                                                    List<ScriptDtos.EpisodeSummary> episodes) {
        if (keptShots.isEmpty() || episodes == null || episodes.isEmpty()) {
            return keptShots.size();
        }
        String targetEpisodeId = "episode".equals(scopeType) && !scopeId.isEmpty()
                ? scopeId : trimToEmpty(draft.draftData().getString("sourceEpisodeId"));
        if (targetEpisodeId.isEmpty()) {
            return keptShots.size();
        }
        Map<String, Integer> orderByEpisodeId = new LinkedHashMap<>();
        for (ScriptDtos.EpisodeSummary episode : episodes) {
            orderByEpisodeId.put(episode.id(), episode.episodeNumber());
        }
        Integer targetOrder = orderByEpisodeId.get(targetEpisodeId);
        if (targetOrder == null) {
            return keptShots.size();
        }
        for (int index = 0; index < keptShots.size(); index++) {
            Integer existingOrder = orderByEpisodeId.get(trimToEmpty(keptShots.get(index).sourceEpisodeId()));
            if (existingOrder != null && existingOrder > targetOrder) {
                return index;
            }
        }
        return keptShots.size();
    }

    /**
     * 估算单个场次的镜头数量：优先按所属分集目标时长与本场体量占比换算，未设时长时按加权表演秒数换算。
     *
     * @param scene 目标场次
     * @param allScenes 同范围已加载的非空场次
     * @param shotDuration 时长档位
     * @return 单场预计镜头数
     */
    static int estimateSceneShotCount(ComicDramaRepository.SceneGenerationSource scene,
                                      List<ComicDramaRepository.SceneGenerationSource> allScenes,
                                      String shotDuration) {
        int preferredSeconds = ComicDramaService.preferredShotSecondsForLevel(shotDuration);
        int episodeTargetSeconds = effectiveEpisodeSeconds(scene);
        double sceneSeconds;
        if (episodeTargetSeconds > 0) {
            List<ComicDramaRepository.SceneGenerationSource> siblings = allScenes.stream()
                    .filter(item -> scene.episodeId().equals(item.episodeId()))
                    .toList();
            double totalWeight = siblings.stream()
                    .mapToDouble(ComicDramaShotBreakdownPlanner::weightedPerformanceSeconds)
                    .sum();
            double sceneWeight = weightedPerformanceSeconds(scene);
            sceneSeconds = totalWeight > 0 ? episodeTargetSeconds * (sceneWeight / totalWeight) : preferredSeconds;
        } else {
            sceneSeconds = weightedPerformanceSeconds(scene);
        }
        int estimated = (int) Math.round(sceneSeconds / preferredSeconds);
        return Math.min(MAX_AUTO_SHOT_COUNT, Math.max(1, estimated));
    }

    /**
     * 估算多场次范围的总镜头数量，按分集汇总。
     *
     * @param scenes 目标非空场次列表
     * @param shotDuration 时长档位
     * @return 范围预计总镜头数
     */
    static int estimateMultiSceneTotalShots(List<ComicDramaRepository.SceneGenerationSource> scenes, String shotDuration) {
        int preferredSeconds = ComicDramaService.preferredShotSecondsForLevel(shotDuration);
        Map<String, List<ComicDramaRepository.SceneGenerationSource>> byEpisode = new LinkedHashMap<>();
        for (ComicDramaRepository.SceneGenerationSource scene : scenes) {
            byEpisode.computeIfAbsent(scene.episodeId(), ignored -> new ArrayList<>()).add(scene);
        }
        int totalShots = 0;
        for (List<ComicDramaRepository.SceneGenerationSource> episodeScenes : byEpisode.values()) {
            int episodeTargetSeconds = effectiveEpisodeSeconds(episodeScenes.getFirst());
            double totalSeconds = episodeTargetSeconds > 0
                    ? episodeTargetSeconds
                    : episodeScenes.stream().mapToDouble(ComicDramaShotBreakdownPlanner::weightedPerformanceSeconds).sum();
            int estimated = Math.max(episodeScenes.size(), (int) Math.round(totalSeconds / preferredSeconds));
            totalShots += Math.min(episodeScenes.size() * MAX_AUTO_SHOT_COUNT, estimated);
        }
        return Math.max(scenes.size(), totalShots);
    }

    /**
     * 使用最大余额法将总镜头数按各场表演权重分配到每个场次，保证每场至少 1 镜且不超过单场上限。
     *
     * @param scenes 场次列表
     * @param totalShots 目标总镜头数
     * @return 与场次一一对应的镜头配额
     */
    static List<Integer> allocateShotsAcrossScenes(List<ComicDramaRepository.SceneGenerationSource> scenes, int totalShots) {
        int count = scenes.size();
        int remaining = Math.max(0, totalShots - count);
        int[] quotas = new int[count];
        java.util.Arrays.fill(quotas, 1);
        if (remaining == 0) {
            return toList(quotas);
        }
        double[] weights = scenes.stream().mapToDouble(ComicDramaShotBreakdownPlanner::weightedPerformanceSeconds).toArray();
        double weightSum = java.util.Arrays.stream(weights).sum();
        double[] remainders = new double[count];
        int distributed = 0;
        for (int index = 0; index < count; index++) {
            double exactExtra = weightSum > 0 ? remaining * (weights[index] / weightSum) : (double) remaining / count;
            int extra = Math.min(MAX_AUTO_SHOT_COUNT - 1, (int) Math.floor(exactExtra));
            quotas[index] += extra;
            distributed += extra;
            remainders[index] = exactExtra - extra;
        }
        int left = remaining - distributed;
        List<Integer> order = new ArrayList<>(count);
        for (int index = 0; index < count; index++) {
            order.add(index);
        }
        order.sort(Comparator.<Integer>comparingDouble(index -> remainders[index]).reversed());
        for (int index : order) {
            if (left <= 0) {
                break;
            }
            if (quotas[index] < MAX_AUTO_SHOT_COUNT) {
                quotas[index]++;
                left--;
            }
        }
        return toList(quotas);
    }

    /**
     * 计算单场的加权表演秒数：对白与旁白按语速计，动作与转场描写按画面节拍折算。
     *
     * @param scene 结构化场次
     * @return 至少为 4 秒的预估表演秒数
     */
    static double weightedPerformanceSeconds(ComicDramaRepository.SceneGenerationSource scene) {
        int spokenUnits = ComicDramaService.countScriptUnits(scene.spokenContent());
        int actionUnits = ComicDramaService.countScriptUnits(scene.actionContent());
        double seconds = spokenUnits / SPOKEN_UNITS_PER_SECOND + actionUnits / ACTION_UNITS_PER_SECOND;
        return Math.max(4.0, seconds);
    }

    /**
     * 读取场次所属分集的目标时长秒数：优先使用剧本分集自身时长，其次回退漫剧生产设置的单集时长。
     *
     * @param scene 结构化场次
     * @return 大于 0 表示已配置目标时长，0 表示未配置
     */
    private static int effectiveEpisodeSeconds(ComicDramaRepository.SceneGenerationSource scene) {
        return scene.episodeDurationSeconds() > 0
                ? scene.episodeDurationSeconds()
                : Math.max(0, scene.projectEpisodeDurationSeconds());
    }

    /**
     * 将结构化场次格式化为携带正式地点名与时空信息的剧本片段，帮助分镜Agent对齐地点资产名。
     *
     * @param scene 结构化场次
     * @return 带场头说明的场次剧本正文
     */
    static String formatSceneScript(ComicDramaRepository.SceneGenerationSource scene) {
        StringBuilder header = new StringBuilder("【第").append(scene.sceneNumber()).append("场");
        if (StringUtils.hasText(scene.sceneTitle())) {
            header.append(" ").append(scene.sceneTitle().trim());
        }
        List<String> meta = new ArrayList<>();
        if (StringUtils.hasText(scene.locationName())) {
            meta.add("场景地点：" + scene.locationName().trim());
        }
        String spaceLabel = switch (scene.interiorExterior()) {
            case "interior" -> "内景";
            case "exterior" -> "外景";
            case "mixed" -> "内外景";
            default -> "";
        };
        if (!spaceLabel.isEmpty()) {
            meta.add(spaceLabel);
        }
        if (StringUtils.hasText(scene.timeDescription())) {
            meta.add(scene.timeDescription().trim());
        }
        if (!meta.isEmpty()) {
            header.append("（").append(String.join(" · ", meta)).append("）");
        }
        header.append("】\n").append(scene.bodyContent().trim());
        return header.toString();
    }

    /**
     * 构建单个拆分片段的完整Agent指令，明确镜头数量与硬上限。
     *
     * @param targetShots 本片段目标镜头数
     * @param request 用户请求参数
     * @return 分镜Agent指令
     */
    private static String buildSegmentInstruction(int targetShots, ComicDramaDtos.GenerateShotDraftRequest request) {
        int hardCeiling = Math.min(StoryboardDtos.MAX_SHOT_COUNT, Math.max(targetShots + 2, (int) Math.ceil(targetShots * 1.3)));
        return "请将本段剧本拆分为约" + targetShots + "个镜头（最多不得超过" + hardCeiling + "个镜头），"
                + "把能在单镜头时长内演完的连续动作、对白和反应合并进同一镜头，只在叙事节拍切换或超出单镜头时长上限时才切下一镜"
                + buildCommonInstructionSuffix(request);
    }

    /** 构建节奏、单镜头时长与创作重点公共后缀。 */
    private static String buildCommonInstructionSuffix(ComicDramaDtos.GenerateShotDraftRequest request) {
        String rhythm = trimToEmpty(request.rhythm());
        return (rhythm.isEmpty() ? "" : "。节奏：" + rhythm)
                + "。单镜头时长：" + ComicDramaService.shotDurationInstruction(request.shotDuration())
                + (StringUtils.hasText(request.focus()) ? "。创作重点：" + request.focus().trim() : "");
    }

    /** 将整型数组转为不可变列表。 */
    private static List<Integer> toList(int[] values) {
        List<Integer> list = new ArrayList<>(values.length);
        for (int value : values) {
            list.add(value);
        }
        return List.copyOf(list);
    }

    /** 安全去除首尾空白。 */
    private static String trimToEmpty(String value) {
        return value == null ? "" : value.trim();
    }
}

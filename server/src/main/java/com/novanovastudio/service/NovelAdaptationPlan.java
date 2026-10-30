package com.novanovastudio.service;

import com.alibaba.fastjson2.JSON;
import com.novanovastudio.dto.ScriptDtos;
import com.novanovastudio.repository.NovelAdaptationRepository;
import com.novanovastudio.repository.StoryBibleRepository;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 小说改编生成单元规划，执行与失败续跑报价共用批次身份。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-10-01 12:00
 */
public final class NovelAdaptationPlan {
    /** 禁止实例化规划工具。 */
    private NovelAdaptationPlan() { }

    /** 一次模型调用，分集目标与排序后的事实标识共同确定批次身份。 */
    public record Unit(String stage, String episodeId, List<String> factIds) {
        /**
         * 生成不依赖列表顺序的批次身份。
         * @return String 阶段、目标集与事实范围组成的键
         */
        public String key() { return batchKey(stage, episodeId, factIds); }
    }

    /**
     * 按正式分集与知识库类型规划当前阶段的全部生成单元。
     * @param phase String 骨架、分集规划或正文阶段
     * @param items List&lt;ItemTypeRef&gt; 任务启动时选定且仍确认的事实
     * @param episodes List&lt;EpisodeSummary&gt; 正式分集
     * @return List&lt;Unit&gt; 按执行顺序排列的调用
     */
    public static List<Unit> units(String phase, List<StoryBibleRepository.ItemTypeRef> items,
                                   List<ScriptDtos.EpisodeSummary> episodes) {
        return units(phase, items, episodes, List.of());
    }

    /**
     * 保留历史成功批次的事实边界，对尚未生成的事实重新装批，避免数据库返回顺序变化导致重复。
     * @param phase String 当前阶段
     * @param items List&lt;ItemTypeRef&gt; 当前任务事实
     * @param episodes List&lt;EpisodeSummary&gt; 正式分集
     * @param checkpoints List&lt;DraftCheckpoint&gt; 历史成功草稿
     * @return List&lt;Unit&gt; 包含历史完成单元与剩余调用的规划
     */
    public static List<Unit> units(String phase, List<StoryBibleRepository.ItemTypeRef> items,
                                   List<ScriptDtos.EpisodeSummary> episodes,
                                   List<NovelAdaptationRepository.DraftCheckpoint> checkpoints) {
        Map<String, List<StoryBibleRepository.ItemTypeRef>> types = new HashMap<>();
        items.forEach(item -> types.computeIfAbsent(item.itemType(), ignored -> new ArrayList<>()).add(item));
        List<Unit> units = new ArrayList<>();
        List<String> stages = switch (phase) {
            case "skeleton" -> NovelAdaptationService.SKELETON_STAGES;
            case "episodes" -> List.of("episodes");
            case "drafts" -> List.of("episode");
            default -> throw new IllegalArgumentException("改编阶段不受支持");
        };
        for (String stage : stages) {
            List<StoryBibleRepository.ItemTypeRef> stageItems = NovelAdaptationService.stageItems(stage, types);
            if ("episode".equals(stage)) {
                episodes.forEach(episode -> addUnits(units, stage, episode.id(), stageItems, checkpoints));
            } else {
                addUnits(units, stage, null, stageItems, checkpoints);
            }
        }
        return units;
    }

    /**
     * 对一个阶段目标复用已完成批次边界，只为剩余事实生成调用。
     * @param units List&lt;Unit&gt; 输出调用列表
     * @param stage String 生成阶段
     * @param episodeId String 目标集标识，其他阶段为空
     * @param items List&lt;ItemTypeRef&gt; 当前阶段事实范围
     * @param checkpoints List&lt;DraftCheckpoint&gt; 历史完成记录
     */
    private static void addUnits(List<Unit> units, String stage, String episodeId,
                                 List<StoryBibleRepository.ItemTypeRef> items,
                                 List<NovelAdaptationRepository.DraftCheckpoint> checkpoints) {
        Set<String> available = items.stream().map(StoryBibleRepository.ItemTypeRef::id).collect(Collectors.toSet());
        Set<String> consumed = new java.util.HashSet<>();
        checkpoints.stream().filter(checkpoint -> stage.equals(checkpoint.stage())
                        && java.util.Objects.equals(episodeId, checkpoint.targetId())
                        && Set.of("pending", "applied").contains(checkpoint.status()))
                .forEach(checkpoint -> {
                    List<String> factIds = checkpoint.facts().stream().map(fact -> fact.id()).toList();
                    if (available.containsAll(factIds)) {
                        units.add(new Unit(stage, episodeId, factIds));
                        consumed.addAll(factIds);
                    }
                });
        NovelAdaptationService.stageBatches(stage, items.stream().filter(item -> !consumed.contains(item.id())).toList())
                .forEach(batch -> units.add(new Unit(stage, episodeId, batch)));
    }

    /**
     * 提取成功保存且未放弃的草稿批次身份，供续跑跳过已完成调用。
     * @param checkpoints List&lt;DraftCheckpoint&gt; 任务的已保存草稿
     * @return Set&lt;String&gt; 已完成批次键
     */
    public static Set<String> completedKeys(List<NovelAdaptationRepository.DraftCheckpoint> checkpoints) {
        return checkpoints.stream().filter(checkpoint -> Set.of("pending", "applied").contains(checkpoint.status()))
                .map(checkpoint -> batchKey(checkpoint.stage(), checkpoint.targetId(),
                        checkpoint.facts().stream().map(fact -> fact.id()).toList())).collect(Collectors.toSet());
    }

    /**
     * 为生成单元与草稿检查点建立相同的稳定身份。
     * @param stage String 生成阶段
     * @param episodeId String 正文目标集，其他阶段为空
     * @param factIds List&lt;String&gt; 事实标识
     * @return String 无歧义的批次键
     */
    private static String batchKey(String stage, String episodeId, List<String> factIds) {
        return JSON.toJSONString(List.of(stage, episodeId == null ? "" : episodeId, factIds.stream().sorted().toList()));
    }
}

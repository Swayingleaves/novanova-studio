package com.novanovastudio.service;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 逐集正文批量的目标选择与事实装批，报价与执行共用同一份规划。
 * <p>
 * 一集正文只引用与本集相关的事实：全书 1000 余条事实无法整体塞进单次调用，
 * 而事件取舍已经把每个事件分配到了具体分集，因此按分集回读取舍结果即可得到准确范围。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-10-09 10:30
 */
public final class EpisodeBodiesPlanner {
    /** 单集改编调用允许携带的最大事实数，与单次生成契约的容量保持一致。 */
    public static final int FACT_LIMIT = 30;
    /** 禁止实例化规划工具。 */
    private EpisodeBodiesPlanner() { }

    /**
     * 按分集汇总取舍结果里指向本集的事实标识。
     * <p>
     * omit 表示该事件在本集不出现，因此只有 retain 与 merge 计入范围；阶段级 retain 没有分集标识，
     * 按该格式约定应由逐集规划另行指定，这里不猜测归属，避免把其他集的事件带进来。
     *
     * @param outputs List&lt;JSONObject&gt; 已完成的取舍单元输出，事件标识已还原为真实值
     * @return Map&lt;String, List&lt;String&gt;&gt; 分集标识到事实标识，按取舍单元顺序去重
     */
    public static Map<String, List<String>> episodeFacts(List<JSONObject> outputs) {
        Map<String, LinkedHashSet<String>> collected = new LinkedHashMap<>();
        for (JSONObject output : outputs) {
            if (output == null || output.getJSONArray("events") == null) continue;
            for (int index = 0; index < output.getJSONArray("events").size(); index++) {
                JSONObject event = output.getJSONArray("events").getJSONObject(index);
                String episodeId = event.getString("episodeId");
                if (episodeId == null || episodeId.isBlank() || "omit".equals(event.getString("treatment"))) continue;
                String factId = event.getString("factId");
                if (factId == null || factId.isBlank()) continue;
                collected.computeIfAbsent(episodeId, key -> new LinkedHashSet<>()).add(factId);
            }
        }
        Map<String, List<String>> result = new LinkedHashMap<>();
        collected.forEach((episodeId, factIds) -> result.put(episodeId, List.copyOf(factIds)));
        return result;
    }

    /**
     * 把一集的事实范围裁剪到单次调用容量内，超出部分按原文顺序保留最早的事件。
     *
     * @param factIds List&lt;String&gt; 本集全部候选事实标识
     * @param known Set&lt;String&gt; 任务内已知的事实标识
     * @return List&lt;String&gt; 可提交的事实标识
     */
    public static List<String> limit(List<String> factIds, Set<String> known) {
        List<String> kept = new ArrayList<>();
        for (String factId : factIds) {
            if (kept.size() >= FACT_LIMIT) break;
            if (known.contains(factId)) kept.add(factId);
        }
        return kept;
    }

    /**
     * 校验目标分集存在且属于本项目，返回按项目顺序排列的目标。
     *
     * @param requested List&lt;String&gt; 用户选择的分集标识
     * @param projectOrder List&lt;String&gt; 项目内全部分集标识，顺序即集号
     * @return List&lt;String&gt; 按集号排列的目标分集
     */
    public static List<String> resolveTargets(List<String> requested, List<String> projectOrder) {
        Set<String> selected = new LinkedHashSet<>(requested);
        if (selected.size() != requested.size()) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "目标分集不能重复选择");
        }
        List<String> unknown = selected.stream().filter(id -> !projectOrder.contains(id)).toList();
        if (!unknown.isEmpty()) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "选择的分集不属于当前项目，请刷新后重试");
        }
        return projectOrder.stream().filter(selected::contains).toList();
    }
}

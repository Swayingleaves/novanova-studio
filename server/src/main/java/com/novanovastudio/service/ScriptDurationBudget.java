package com.novanovastudio.service;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.dto.ScriptDtos;

/**
 * 剧本单集目标时长解析与场次、篇幅预算换算工具。
 * <p>
 * 统一约束剧本分集规划与单集正文生成的场次数区间和文字密度上限，使产出的分集与场次体量
 * 能直接与下游漫剧镜头拆分对齐。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-18 09:35
 */
final class ScriptDurationBudget {

    /** 未设置时长时默认采用的单集秒数（3分钟）。 */
    static final int DEFAULT_EPISODE_SECONDS = 180;

    /** 单集最小时长秒数。 */
    static final int MIN_EPISODE_SECONDS = 30;

    /** 单集最大时长秒数（10分钟）。 */
    static final int MAX_EPISODE_SECONDS = 600;

    /** 单场最短秒数：单集时长除以该值得到场次数上限。 */
    static final int MIN_SCENE_SECONDS = 12;

    /** 单场最长秒数：单集时长除以该值得到场次数下限。 */
    static final int MAX_SCENE_SECONDS = 20;

    /** 禁止实例化工具类。 */
    private ScriptDurationBudget() {
    }

    /**
     * 解析本次AI生成采用的单集目标时长（秒）。
     *
     * @param requestedEpisodeSeconds 用户本次显式指定的单集秒数，可为空
     * @param episode 当前目标分集摘要，分集规划时为空
     * @param overview 项目故事概览，可为空
     * @return 落在合法区间内的单集目标秒数
     */
    static int resolveEpisodeSeconds(Integer requestedEpisodeSeconds, ScriptDtos.EpisodeSummary episode,
                                     ScriptDtos.ProjectOverview overview) {
        // 优先使用用户本次显式选择的单集时长，其次沿用单集自身已保存的时长。
        if (requestedEpisodeSeconds != null && requestedEpisodeSeconds > 0) {
            return clampEpisodeSeconds(requestedEpisodeSeconds);
        }
        if (episode != null && episode.targetDurationSeconds() > 0) {
            return clampEpisodeSeconds(episode.targetDurationSeconds());
        }
        // 概览里的 targetDurationSeconds 表示全剧总时长，多集项目按目标集数均摊得到单集时长。
        if (overview != null && overview.targetDurationSeconds() > 0) {
            int episodeCount = Math.max(1, overview.targetEpisodeCount());
            if (episodeCount > 1 && overview.targetDurationSeconds() >= episodeCount * MIN_EPISODE_SECONDS) {
                return clampEpisodeSeconds((int) Math.round((double) overview.targetDurationSeconds() / episodeCount));
            }
            return clampEpisodeSeconds(overview.targetDurationSeconds());
        }
        return DEFAULT_EPISODE_SECONDS;
    }

    /**
     * 将秒数收敛到单集允许区间。
     *
     * @param seconds 原始秒数
     * @return 收敛后的秒数
     */
    static int clampEpisodeSeconds(int seconds) {
        return Math.min(MAX_EPISODE_SECONDS, Math.max(MIN_EPISODE_SECONDS, seconds));
    }

    /**
     * 计算给定单集时长对应的最少场次数。
     *
     * @param episodeSeconds 单集目标秒数
     * @return 最少场次数
     */
    static int minimumScenes(int episodeSeconds) {
        return Math.max(2, episodeSeconds / MAX_SCENE_SECONDS);
    }

    /**
     * 计算给定单集时长对应的最多场次数。
     *
     * @param episodeSeconds 单集目标秒数
     * @return 最多场次数
     */
    static int maximumScenes(int episodeSeconds) {
        int minimum = minimumScenes(episodeSeconds);
        return Math.max(minimum + 1, episodeSeconds / MIN_SCENE_SECONDS);
    }

    /**
     * 计算给定单集时长建议的正文总字数上限（不含空白与标点）。
     * <p>
     * 中文对白每秒约 4 字，配合精炼的可拍摄动作描述，每秒总文字控制在约 5 字以内，
     * 避免模型堆砌大段无法拍成镜头的文学描写。
     *
     * @param episodeSeconds 单集目标秒数
     * @return 全集建议最大字数
     */
    static int maximumBodyCharacters(int episodeSeconds) {
        return Math.max(180, episodeSeconds * 5);
    }

    /**
     * 构建分集规划动作的单集时长预算说明。
     *
     * @param episodeSeconds 单集目标秒数
     * @return 追加到生成指令中的时长预算要求
     */
    static String episodePlanInstruction(int episodeSeconds) {
        int minimumSceneCount = minimumScenes(episodeSeconds);
        int maximumSceneCount = maximumScenes(episodeSeconds);
        return "单集目标时长为 " + episodeSeconds + " 秒（约 " + formatMinutes(episodeSeconds)
                + "），每集的 targetDurationSeconds 统一填写 " + episodeSeconds
                + "；每集事件容量按 " + minimumSceneCount + "-" + maximumSceneCount
                + " 个场次的叙事体量规划，聚焦核心冲突与结尾钩子，不要把超出单集时长的过多支线塞进同一集。";
    }

    /**
     * 构建单集场次与正文动作的场次数与篇幅双重预算说明。
     *
     * @param episodeSeconds 单集目标秒数
     * @return 追加到生成指令中的场次与字数预算要求
     */
    static String episodeBodyInstruction(int episodeSeconds) {
        int minimumSceneCount = minimumScenes(episodeSeconds);
        int maximumSceneCount = maximumScenes(episodeSeconds);
        int maximumCharacterCount = maximumBodyCharacters(episodeSeconds);
        return "本集目标时长为 " + episodeSeconds + " 秒（约 " + formatMinutes(episodeSeconds) + "）。"
                + "按每场 " + MIN_SCENE_SECONDS + "-" + MAX_SCENE_SECONDS + " 秒编排，本集应拆分为 "
                + minimumSceneCount + "-" + maximumSceneCount + " 场；每场是一个连续时空内的完整段落，必须有明确的场景目标与至少一次情节推进，不得用空洞描写充数。"
                + "全集动作与对白总字数控制在 " + maximumCharacterCount + " 字以内，只写可直接拍成画面的可见动作与精炼台词，禁止堆砌冗长心理活动或文学修辞，确保全部内容能在 "
                + episodeSeconds + " 秒内自然演完。";
    }

    /**
     * 将单集目标时长写回模型生成的草稿JSON，避免模型漏填或改写用户设定的时长。
     *
     * @param draftData 模型返回的结构化草稿
     * @param targetType 草稿目标类型
     * @param episodeSeconds 本次生效的单集目标秒数
     * @param forceOverwrite 用户是否显式指定了本次单集秒数
     */
    static void applyEpisodeDuration(JSONObject draftData, String targetType, int episodeSeconds, boolean forceOverwrite) {
        if (draftData == null || episodeSeconds <= 0) {
            return;
        }
        if ("episodes".equals(targetType)) {
            JSONArray episodes = draftData.getJSONArray("episodes");
            if (episodes == null) {
                return;
            }
            for (int index = 0; index < episodes.size(); index++) {
                JSONObject item = episodes.getJSONObject(index);
                if (item != null && (forceOverwrite || item.getIntValue("targetDurationSeconds") <= 0)) {
                    item.put("targetDurationSeconds", episodeSeconds);
                }
            }
        } else if ("episode".equals(targetType)) {
            JSONObject episode = draftData.getJSONObject("episode");
            if (episode != null && (forceOverwrite || episode.getIntValue("targetDurationSeconds") <= 0)) {
                episode.put("targetDurationSeconds", episodeSeconds);
            }
        }
    }

    /**
     * 将秒数格式化为可读分钟文本。
     *
     * @param seconds 秒数
     * @return 分钟描述
     */
    private static String formatMinutes(int seconds) {
        if (seconds % 60 == 0) {
            return (seconds / 60) + " 分钟";
        }
        return String.format(java.util.Locale.ROOT, "%.1f 分钟", seconds / 60.0);
    }
}

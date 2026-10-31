package com.novanovastudio.service;

import java.util.List;
import java.util.Set;
import java.util.stream.Stream;

/**
 * 剧本 AI 助手的动作目录。
 * <p>
 * 这份目录是定价与扣费的唯一权威：管理后台按它列出可定价动作，生成时按它校验动作是否合法。
 * 顺序即管理后台定价表的展示顺序，新增动作同时要在前端 {@code script-ai-actions.ts} 补中文名。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-29 10:30
 */
public final class ScriptAiActions {

    /** 产出整块内容的动作，目标类型固定。 */
    public static final List<String> GENERATIONS = List.of(
            "storyDirections", "outline", "characters", "world", "episodePlan", "episodeDraft");

    /** 针对已有正文做局部优化的动作。 */
    public static final List<String> TEXT_OPTIMIZATIONS = List.of(
            "polish", "expand", "condense", "rewrite", "colloquialize", "dialogue", "conflict",
            "suspense", "twist", "motivation", "emotion", "climax", "rhythm", "style");

    /** 全部动作，顺序即定价表展示顺序。 */
    public static final List<String> ALL = Stream.concat(GENERATIONS.stream(), TEXT_OPTIMIZATIONS.stream()).toList();

    /** 合法动作集合，用于保存定价与发起生成时的校验。 */
    public static final Set<String> ALL_SET = Set.copyOf(ALL);

    /** 禁止实例化常量容器。 */
    private ScriptAiActions() { }
}

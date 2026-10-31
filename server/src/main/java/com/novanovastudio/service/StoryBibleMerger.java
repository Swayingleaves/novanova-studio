package com.novanovastudio.service;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.dto.StoryBibleDtos;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 故事知识库候选条目的提取转换、确定性归并与名称规范化，全部为纯函数。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-09-27 00:00
 */
public final class StoryBibleMerger {
    /** 可按别名归并的实体类型。 */
    public static final Set<String> ENTITY_TYPES = Set.of("character", "location");
    /** 单个候选保留的证据上限。 */
    private static final int MAX_EVIDENCES = 200;
    /** 单个片段候选保留的证据上限。 */
    private static final int MAX_SEGMENT_EVIDENCES = 20;
    /** 名称最大长度。 */
    private static final int MAX_NAME_LENGTH = 255;

    /** 禁止实例化。 */
    private StoryBibleMerger() { }

    /**
     * 把片段提取结果转换为带绝对偏移证据的候选，无法定位证据的结论直接丢弃。
     *
     * @param keyPrefix String 候选键前缀
     * @param segment String 片段正文
     * @param segmentStart int 片段在原文中的起点
     * @param anchor int 片段所属顶层结构段起点，用于区分同名事件
     * @param result SegmentExtraction 模型结果
     * @return List&lt;Candidate&gt; 候选
     */
    public static List<StoryBibleDtos.Candidate> fromExtraction(String keyPrefix, String segment, int segmentStart, int anchor,
                                                                StoryBibleDtos.SegmentExtraction result) {
        List<StoryBibleDtos.Candidate> candidates = new ArrayList<>();
        if (result == null) {
            return candidates;
        }
        entities(candidates, "character", result.characters(), segment, segmentStart);
        entities(candidates, "location", result.locations(), segment, segmentStart);
        for (StoryBibleDtos.AiRelation relation : nullSafe(result.relationships())) {
            String source = clean(relation.source());
            String target = clean(relation.target());
            if (source == null || target == null) {
                continue;
            }
            List<StoryBibleDtos.CandidateEvidence> evidences = quotes(relation.quotes(), segment, segmentStart);
            if (evidences.isEmpty()) {
                continue;
            }
            String relationType = clean(relation.relationType()) == null ? "关系" : clean(relation.relationType());
            JSONObject attributes = new JSONObject().fluentPut("source", source).fluentPut("target", target)
                    .fluentPut("relationType", relationType);
            candidates.add(new StoryBibleDtos.Candidate("", "relationship", relationName(source, target, relationType),
                    text(relation.summary()), List.of(), evidences, attributes, false));
        }
        for (StoryBibleDtos.AiEvent event : nullSafe(result.events())) {
            String title = clean(event.title());
            if (title == null) {
                continue;
            }
            List<StoryBibleDtos.CandidateEvidence> evidences = quotes(event.quotes(), segment, segmentStart);
            if (evidences.isEmpty()) {
                continue;
            }
            List<String> participants = nullSafe(event.participants()).stream().map(StoryBibleMerger::clean)
                    .filter(value -> value != null).distinct().toList();
            String storyTime = clean(event.storyTime());
            JSONObject attributes = new JSONObject().fluentPut("participants", participants)
                    .fluentPut("location", clean(event.location())).fluentPut("anchor", anchor)
                    .fluentPut("storyTime", storyTime == null ? "" : storyTime)
                    .fluentPut("storyTimeCertain", storyTime != null && Boolean.TRUE.equals(event.storyTimeCertain()));
            candidates.add(new StoryBibleDtos.Candidate("", "event", title, text(event.summary()), List.of(), evidences,
                    attributes, false));
        }
        return rekey(candidates, keyPrefix);
    }

    /**
     * 同类型实体只要共享任一归一化别名即确定性合并。
     *
     * @param candidates List&lt;Candidate&gt; 候选
     * @return List&lt;Candidate&gt; 合并后的候选，非实体原样保留
     */
    public static List<StoryBibleDtos.Candidate> unionByAlias(List<StoryBibleDtos.Candidate> candidates) {
        List<StoryBibleDtos.Candidate> result = new ArrayList<>();
        for (String type : List.of("character", "location")) {
            List<StoryBibleDtos.Candidate> entities = candidates.stream().filter(candidate -> type.equals(candidate.itemType())).toList();
            int[] parent = new int[entities.size()];
            for (int index = 0; index < parent.length; index++) {
                parent[index] = index;
            }
            Map<String, Integer> owner = new HashMap<>();
            for (int index = 0; index < entities.size(); index++) {
                for (String key : aliasKeys(entities.get(index))) {
                    Integer previous = owner.putIfAbsent(key, index);
                    if (previous != null) {
                        parent[find(parent, index)] = find(parent, previous);
                    }
                }
            }
            Map<Integer, List<StoryBibleDtos.Candidate>> groups = new LinkedHashMap<>();
            for (int index = 0; index < entities.size(); index++) {
                groups.computeIfAbsent(find(parent, index), ignored -> new ArrayList<>()).add(entities.get(index));
            }
            for (List<StoryBibleDtos.Candidate> group : groups.values()) {
                result.add(combine(group));
            }
        }
        candidates.stream().filter(candidate -> !ENTITY_TYPES.contains(candidate.itemType())).forEach(result::add);
        return result;
    }

    /**
     * 计算用于重分析匹配与拒绝抑制的归一化键。
     *
     * @param candidate Candidate 候选
     * @return String 匹配键
     */
    public static String matchKey(StoryBibleDtos.Candidate candidate) {
        JSONObject attributes = candidate.attributes() == null ? new JSONObject() : candidate.attributes();
        String key = switch (candidate.itemType()) {
            case "relationship" -> StoryBibleSupport.normalize(attributes.getString("source")) + "|"
                    + StoryBibleSupport.normalize(attributes.getString("target")) + "|"
                    + StoryBibleSupport.normalize(attributes.getString("relationType"));
            case "event" -> StoryBibleSupport.normalize(candidate.name()) + "@" + attributes.getIntValue("anchor");
            default -> StoryBibleSupport.normalize(candidate.name());
        };
        return key.length() > MAX_NAME_LENGTH ? key.substring(0, MAX_NAME_LENGTH) : key;
    }

    /**
     * 读取实体全部归一化别名键。
     *
     * @param candidate Candidate 候选
     * @return Set&lt;String&gt; 别名键
     */
    public static Set<String> aliasKeys(StoryBibleDtos.Candidate candidate) {
        Set<String> keys = new LinkedHashSet<>();
        keys.add(StoryBibleSupport.normalize(candidate.name()));
        nullSafe(candidate.aliases()).forEach(alias -> keys.add(StoryBibleSupport.normalize(alias)));
        keys.remove("");
        return keys;
    }

    /**
     * 按首条证据位置重新编号候选键。
     *
     * @param candidates List&lt;Candidate&gt; 候选
     * @param keyPrefix String 键前缀
     * @return List&lt;Candidate&gt; 重新编号后的候选
     */
    private static List<StoryBibleDtos.Candidate> rekey(List<StoryBibleDtos.Candidate> candidates, String keyPrefix) {
        List<StoryBibleDtos.Candidate> result = new ArrayList<>(candidates.size());
        for (int index = 0; index < candidates.size(); index++) {
            StoryBibleDtos.Candidate candidate = candidates.get(index);
            result.add(new StoryBibleDtos.Candidate(keyPrefix + ":" + index, candidate.itemType(), candidate.name(),
                    candidate.summary(), candidate.aliases(), candidate.evidences(), candidate.attributes(), candidate.uncertain()));
        }
        return result;
    }

    /**
     * 合并一组实体。
     *
     * @param members List&lt;Candidate&gt; 成员
     * @return Candidate 合并后的实体
     */
    private static StoryBibleDtos.Candidate combine(List<StoryBibleDtos.Candidate> members) {
        StoryBibleDtos.Candidate first = members.getFirst();
        Map<String, String> aliases = new LinkedHashMap<>();
        String bestSummary = "";
        boolean anyUncertain = false;
        for (StoryBibleDtos.Candidate member : members) {
            aliases.putIfAbsent(StoryBibleSupport.normalize(member.name()), member.name());
            nullSafe(member.aliases()).forEach(alias -> aliases.putIfAbsent(StoryBibleSupport.normalize(alias), alias));
            bestSummary = longer(bestSummary, member.summary());
            anyUncertain |= member.uncertain();
        }
        aliases.remove("");
        return new StoryBibleDtos.Candidate(first.key(), first.itemType(), first.name(), bestSummary,
                new ArrayList<>(aliases.values()), evidences(members),
                first.attributes() == null ? new JSONObject() : first.attributes(), anyUncertain);
    }

    /**
     * 合并证据，按位置去重并排序。
     *
     * @param members List&lt;Candidate&gt; 候选
     * @return List&lt;CandidateEvidence&gt; 证据
     */
    private static List<StoryBibleDtos.CandidateEvidence> evidences(List<StoryBibleDtos.Candidate> members) {
        Map<String, StoryBibleDtos.CandidateEvidence> spans = new LinkedHashMap<>();
        for (StoryBibleDtos.Candidate member : members) {
            for (StoryBibleDtos.CandidateEvidence evidence : nullSafe(member.evidences())) {
                spans.putIfAbsent(evidence.start() + ":" + evidence.end(), evidence);
            }
        }
        return spans.values().stream()
                .sorted((left, right) -> Integer.compare(left.start(), right.start()))
                .limit(MAX_EVIDENCES).toList();
    }

    /**
     * 转换人物或地点提取结果。
     *
     * @param candidates List&lt;Candidate&gt; 输出列表
     * @param type String 实体类型
     * @param entities List&lt;AiEntity&gt; 模型实体
     * @param segment String 片段正文
     * @param segmentStart int 片段起点
     */
    private static void entities(List<StoryBibleDtos.Candidate> candidates, String type, List<StoryBibleDtos.AiEntity> entities,
                                 String segment, int segmentStart) {
        for (StoryBibleDtos.AiEntity entity : nullSafe(entities)) {
            String name = clean(entity.name());
            if (name == null || StoryBibleSupport.normalize(name).isEmpty()) {
                continue;
            }
            Map<String, String> aliases = new LinkedHashMap<>();
            aliases.put(StoryBibleSupport.normalize(name), name);
            Map<String, StoryBibleDtos.CandidateEvidence> evidences = new LinkedHashMap<>();
            for (StoryBibleDtos.AiMention mention : nullSafe(entity.mentions())) {
                String alias = clean(mention.alias()) == null ? name : clean(mention.alias());
                int[] span = StoryBibleSupport.locate(segment, segmentStart, mention.quote());
                if (span == null || evidences.size() >= MAX_SEGMENT_EVIDENCES) {
                    continue;
                }
                if (!StoryBibleSupport.normalize(alias).isEmpty()) {
                    aliases.putIfAbsent(StoryBibleSupport.normalize(alias), alias);
                }
                evidences.putIfAbsent(span[0] + ":" + span[1], new StoryBibleDtos.CandidateEvidence(span[0], span[1], alias,
                        segment.substring(span[0] - segmentStart, span[1] - segmentStart)));
            }
            if (!evidences.isEmpty()) {
                candidates.add(new StoryBibleDtos.Candidate("", type, name, text(entity.summary()),
                        new ArrayList<>(aliases.values()), new ArrayList<>(evidences.values()), new JSONObject(), false));
            }
        }
    }

    /**
     * 定位一组证据引用。
     *
     * @param quotes List&lt;String&gt; 引用
     * @param segment String 片段正文
     * @param segmentStart int 片段起点
     * @return List&lt;CandidateEvidence&gt; 已定位证据
     */
    private static List<StoryBibleDtos.CandidateEvidence> quotes(List<String> quotes, String segment, int segmentStart) {
        Map<String, StoryBibleDtos.CandidateEvidence> evidences = new LinkedHashMap<>();
        for (String quote : nullSafe(quotes)) {
            int[] span = StoryBibleSupport.locate(segment, segmentStart, quote);
            if (span != null && evidences.size() < MAX_SEGMENT_EVIDENCES) {
                evidences.putIfAbsent(span[0] + ":" + span[1], new StoryBibleDtos.CandidateEvidence(span[0], span[1], null,
                        segment.substring(span[0] - segmentStart, span[1] - segmentStart)));
            }
        }
        return new ArrayList<>(evidences.values());
    }

    /**
     * 生成关系名称。
     *
     * @param source String 来源人物
     * @param target String 目标人物
     * @param relationType String 关系类型
     * @return String 名称
     */
    public static String relationName(String source, String target, String relationType) {
        String name = source + " → " + target + "（" + relationType + "）";
        return name.length() > MAX_NAME_LENGTH ? name.substring(0, MAX_NAME_LENGTH) : name;
    }

    /**
     * 读取字符串数组属性。
     *
     * @param value Object 属性值
     * @return List&lt;String&gt; 字符串列表
     */
    public static List<String> stringList(Object value) {
        if (value instanceof List<?> list) {
            return list.stream().filter(item -> item != null).map(String::valueOf).toList();
        }
        return value instanceof JSONArray array ? array.toJavaList(String.class) : List.of();
    }

    /**
     * 选择更长的摘要。
     *
     * @param left String 摘要
     * @param right String 摘要
     * @return String 较长摘要
     */
    private static String longer(String left, String right) {
        String first = left == null ? "" : left;
        String second = right == null ? "" : right;
        return second.length() > first.length() ? second : first;
    }

    /**
     * 清理名称类文本。
     *
     * @param value String 原值
     * @return String 清理结果，空白时为空
     */
    private static String clean(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String trimmed = value.strip();
        return trimmed.length() > MAX_NAME_LENGTH ? trimmed.substring(0, MAX_NAME_LENGTH) : trimmed;
    }

    /**
     * 清理摘要文本。
     *
     * @param value String 原值
     * @return String 摘要
     */
    private static String text(String value) {
        if (value == null) {
            return "";
        }
        String trimmed = value.strip();
        return trimmed.length() > 2000 ? trimmed.substring(0, 2000) : trimmed;
    }

    /**
     * 空列表兜底。
     *
     * @param values List&lt;T&gt; 列表
     * @param <T> 元素类型
     * @return List&lt;T&gt; 非空列表
     */
    private static <T> List<T> nullSafe(List<T> values) {
        return values == null ? List.of() : values.stream().filter(value -> value != null).toList();
    }

    /**
     * 并查集查找根节点。
     *
     * @param parent int[] 父节点数组
     * @param index int 节点
     * @return int 根节点
     */
    private static int find(int[] parent, int index) {
        while (parent[index] != index) {
            parent[index] = parent[parent[index]];
            index = parent[index];
        }
        return index;
    }
}

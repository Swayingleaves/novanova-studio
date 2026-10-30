package com.novanovastudio.tools;

import com.alibaba.fastjson2.JSON;
import com.novanovastudio.dto.ScriptDtos;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 一次性数据修复工具：把全书改编待审草稿的 source_data 回填为生成时的真实目标内容快照。
 * <p>
 * 旧版本 WholeBookAdaptationRunner.saveDraft 存草稿时 sourceData 传空对象，
 * 而 applyAdaptationDrafts 会拿它与项目真实内容做全等比对，导致应用永远失败。
 * 本工具直接用 ScriptDtos 构造快照，保证序列化结果与 ScriptService.targetSnapshot 完全一致
 * （fastjson2 默认 camelCase，与数据库 snake_case 列名不同，不能直接用 to_jsonb）。
 * <p>
 * 用法：java -cp ... BackfillDraftSourceData &lt;projectId&gt; &lt;jobId&gt;，加 --apply 才真正写入。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-03
 */
public final class BackfillDraftSourceData {

    /** 数据库连接串，本地容器固定端口。 */
    private static final String URL = "jdbc:postgresql://localhost:15432/novanova_studio";

    /** 数据库用户。 */
    private static final String USER = "postgres";

    /** 数据库口令。 */
    private static final String PASSWORD = "123456";

    /** 禁止实例化修复工具。 */
    private BackfillDraftSourceData() { }

    /**
     * 回填指定任务全部待审草稿的来源快照。
     * @param args String[] 项目标识、任务标识，可选 --apply
     * @throws Exception 数据库访问失败
     */
    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            System.out.println("用法: BackfillDraftSourceData <projectId> <jobId> [--apply]");
            return;
        }
        String projectId = args[0];
        String jobId = args[1];
        boolean apply = args.length > 2 && "--apply".equals(args[2]);

        try (Connection connection = DriverManager.getConnection(URL, USER, PASSWORD)) {
            connection.setAutoCommit(false);
            try {
                Map<String, String> sources = buildSources(connection, projectId);
                int updated = backfill(connection, jobId, sources, apply);
                if (apply) {
                    connection.commit();
                    System.out.println("已提交，回填草稿数: " + updated);
                } else {
                    connection.rollback();
                    System.out.println("预演完成，未写入。目标类型快照: " + sources.keySet());
                    System.out.println("加 --apply 参数执行真实回填。");
                }
            } catch (Exception error) {
                connection.rollback();
                throw error;
            }
        }
    }

    /**
     * 读取项目当前内容并按目标类型构造与 targetSnapshot 一致的快照。
     */
    private static Map<String, String> buildSources(Connection connection, String projectId) throws Exception {
        return buildSourcesForVerify(connection, projectId);
    }

    /**
     * 读取项目当前内容并按目标类型构造快照，供回填与离线校验共用同一份逻辑。
     */
    static Map<String, String> buildSourcesForVerify(Connection connection, String projectId) throws Exception {
        Map<String, String> sources = new LinkedHashMap<>();
        sources.put("overview", JSON.toJSONString(readOverview(connection, projectId)));
        sources.put("outline", JSON.toJSONString(
                new ScriptDtos.OutlineDraft(readOutlineSections(connection, projectId),
                        readStoryEvents(connection, projectId))));
        sources.put("characters", JSON.toJSONString(
                new ScriptDtos.CharacterDraft(readCharacters(connection, projectId),
                        readCharacterRelations(connection, projectId))));
        sources.put("world", JSON.toJSONString(
                new ScriptDtos.WorldDraft(readWorldSetting(connection, projectId),
                        readWorldItems(connection, projectId), readLocations(connection, projectId))));
        sources.put("episodes", JSON.toJSONString(
                new ScriptDtos.EpisodePlanDraft(readEpisodes(connection, projectId))));
        return sources;
    }

    /**
     * 按目标类型回填草稿的 source_data。
     * @return int 受影响草稿数
     */
    private static int backfill(Connection connection, String jobId, Map<String, String> sources, boolean apply)
            throws Exception {
        String sql = """
                update script_ai_drafts set source_data = ?::jsonb
                where id = ? and target_type = ? and status = 'pending'
                """;
        int total = 0;
        try (PreparedStatement select = connection.prepareStatement("""
                select d.id, d.target_type from script_ai_drafts d
                join novel_adaptation_drafts n on n.draft_id = d.id
                where n.job_id = ? and d.status = 'pending' order by d.created_at
                """);
             PreparedStatement update = connection.prepareStatement(sql)) {
            List<String[]> rows = new ArrayList<>();
            select.setString(1, jobId);
            try (ResultSet result = select.executeQuery()) {
                while (result.next()) {
                    rows.add(new String[]{result.getString("id"), result.getString("target_type")});
                }
            }
            for (String[] row : rows) {
                String source = sources.get(row[1]);
                if (source == null) {
                    throw new IllegalStateException("未支持的目标类型: " + row[1]);
                }
                update.setString(1, source);
                update.setString(2, row[0]);
                update.setString(3, row[1]);
                // 预演也走同一条语句，靠回滚保证零副作用，因此两种模式的行数口径一致。
                total += update.executeUpdate();
            }
            if (!apply) {
                total = rows.size();
            }
        }
        return total;
    }

    /** 绑定项目标识后执行查询，避免在语句上直接传参。 */
    private static ResultSet openResult(PreparedStatement statement, String projectId) throws Exception {
        statement.setString(1, projectId);
        return statement.executeQuery();
    }

    /** 读取故事概览。 */
    private static ScriptDtos.ProjectOverview readOverview(Connection connection, String projectId) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement("""
                select title, content_type, genre, logline, synopsis, target_duration_seconds,
                       target_episode_count, narrative_style, theme, main_plot, main_conflict, ending_direction
                from script_projects where id = ?
                """)) {
            statement.setString(1, projectId);
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next()) throw new IllegalStateException("项目不存在: " + projectId);
                return new ScriptDtos.ProjectOverview(result.getString("title"), result.getString("content_type"),
                        result.getString("genre"), result.getString("logline"), result.getString("synopsis"),
                        result.getInt("target_duration_seconds"), result.getInt("target_episode_count"),
                        result.getString("narrative_style"), result.getString("theme"), result.getString("main_plot"),
                        result.getString("main_conflict"), result.getString("ending_direction"));
            }
        }
    }

    /** 读取大纲结构段。 */
    private static List<ScriptDtos.OutlineSection> readOutlineSections(Connection connection, String projectId)
            throws Exception {
        List<ScriptDtos.OutlineSection> list = new ArrayList<>();
        try (PreparedStatement statement = connection.prepareStatement(
                "select id, section_type, title, content, sort_order from script_outline_sections "
                        + "where project_id = ? order by sort_order, id");
             ResultSet result = openResult(statement, projectId)) {
            while (result.next()) {
                list.add(new ScriptDtos.OutlineSection(result.getString("id"), result.getString("section_type"),
                        result.getString("title"), result.getString("content"), result.getInt("sort_order")));
            }
        }
        return list;
    }

    /** 读取故事关键事件。 */
    private static List<ScriptDtos.StoryEvent> readStoryEvents(Connection connection, String projectId)
            throws Exception {
        List<ScriptDtos.StoryEvent> list = new ArrayList<>();
        try (PreparedStatement statement = connection.prepareStatement(
                "select id, outline_section_id, episode_id, scene_id, event_type, title, description, sort_order "
                        + "from script_story_events where project_id = ? order by sort_order, id");
             ResultSet result = openResult(statement, projectId)) {
            while (result.next()) {
                list.add(new ScriptDtos.StoryEvent(result.getString("id"),
                        result.getString("outline_section_id"), result.getString("episode_id"),
                        result.getString("scene_id"), result.getString("event_type"), result.getString("title"),
                        result.getString("description"), result.getInt("sort_order")));
            }
        }
        return list;
    }

    /** 读取人物。 */
    private static List<ScriptDtos.Character> readCharacters(Connection connection, String projectId) throws Exception {
        List<ScriptDtos.Character> list = new ArrayList<>();
        try (PreparedStatement statement = connection.prepareStatement(
                "select id, name, identity, age, occupation, role_type, personality, values_description, goal, "
                        + "desire, fear, motivation, appearance_description, habits, speech_style, background_story, "
                        + "character_arc, sort_order from script_characters "
                        + "where project_id = ? order by sort_order, id");
             ResultSet result = openResult(statement, projectId)) {
            while (result.next()) {
                list.add(new ScriptDtos.Character(result.getString("id"), result.getString("name"),
                        result.getString("identity"), result.getString("age"), result.getString("occupation"),
                        result.getString("role_type"), result.getString("personality"),
                        result.getString("values_description"), result.getString("goal"), result.getString("desire"),
                        result.getString("fear"), result.getString("motivation"),
                        result.getString("appearance_description"), result.getString("habits"),
                        result.getString("speech_style"), result.getString("background_story"),
                        result.getString("character_arc"), result.getInt("sort_order")));
            }
        }
        return list;
    }

    /** 读取人物关系。 */
    private static List<ScriptDtos.CharacterRelation> readCharacterRelations(Connection connection, String projectId)
            throws Exception {
        List<ScriptDtos.CharacterRelation> list = new ArrayList<>();
        try (PreparedStatement statement = connection.prepareStatement(
                "select id, source_character_id, target_character_id, relationship_type, relationship_direction, "
                        + "story_stage, conflict_description, description, sort_order from script_character_relations "
                        + "where project_id = ? order by sort_order, id");
             ResultSet result = openResult(statement, projectId)) {
            while (result.next()) {
                list.add(new ScriptDtos.CharacterRelation(result.getString("id"),
                        result.getString("source_character_id"), result.getString("target_character_id"),
                        result.getString("relationship_type"), result.getString("relationship_direction"),
                        result.getString("story_stage"), result.getString("conflict_description"),
                        result.getString("description"), result.getInt("sort_order")));
            }
        }
        return list;
    }

    /** 读取世界观基础设定，项目内至多一条。 */
    private static ScriptDtos.WorldSetting readWorldSetting(Connection connection, String projectId) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement(
                "select era, region, social_background, overall_tone from script_world_settings where project_id = ?");
             ResultSet result = openResult(statement, projectId)) {
            if (!result.next()) return new ScriptDtos.WorldSetting("", "", "", "");
            return new ScriptDtos.WorldSetting(result.getString("era"), result.getString("region"),
                    result.getString("social_background"), result.getString("overall_tone"));
        }
    }

    /** 读取世界观分类条目。 */
    private static List<ScriptDtos.WorldItem> readWorldItems(Connection connection, String projectId) throws Exception {
        List<ScriptDtos.WorldItem> list = new ArrayList<>();
        try (PreparedStatement statement = connection.prepareStatement(
                "select id, item_type, name, description, sort_order from script_world_items "
                        + "where project_id = ? order by sort_order, id");
             ResultSet result = openResult(statement, projectId)) {
            while (result.next()) {
                list.add(new ScriptDtos.WorldItem(result.getString("id"), result.getString("item_type"),
                        result.getString("name"), result.getString("description"), result.getInt("sort_order")));
            }
        }
        return list;
    }

    /** 读取地点。 */
    private static List<ScriptDtos.Location> readLocations(Connection connection, String projectId) throws Exception {
        List<ScriptDtos.Location> list = new ArrayList<>();
        try (PreparedStatement statement = connection.prepareStatement(
                "select id, name, space_purpose, narrative_role, default_time, weather, atmosphere, key_objects, "
                        + "main_events, sort_order from script_locations where project_id = ? order by sort_order, id");
             ResultSet result = openResult(statement, projectId)) {
            while (result.next()) {
                list.add(new ScriptDtos.Location(result.getString("id"), result.getString("name"),
                        result.getString("space_purpose"), result.getString("narrative_role"),
                        result.getString("default_time"), result.getString("weather"), result.getString("atmosphere"),
                        result.getString("key_objects"), result.getString("main_events"), result.getInt("sort_order")));
            }
        }
        return list;
    }

    /** 读取分集规划。 */
    private static List<ScriptDtos.EpisodeSummary> readEpisodes(Connection connection, String projectId)
            throws Exception {
        List<ScriptDtos.EpisodeSummary> list = new ArrayList<>();
        try (PreparedStatement statement = connection.prepareStatement(
                "select id, episode_number, title, summary, key_events, main_conflict, climax, ending_hook, "
                        + "target_duration_seconds, completion_status, sort_order from script_episodes "
                        + "where project_id = ? order by sort_order, id");
             ResultSet result = openResult(statement, projectId)) {
            while (result.next()) {
                list.add(new ScriptDtos.EpisodeSummary(result.getString("id"), result.getInt("episode_number"),
                        result.getString("title"), result.getString("summary"), result.getString("key_events"),
                        result.getString("main_conflict"), result.getString("climax"),
                        result.getString("ending_hook"), result.getInt("target_duration_seconds"),
                        result.getString("completion_status"), result.getInt("sort_order")));
            }
        }
        return list;
    }
}

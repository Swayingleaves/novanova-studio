package com.novanovastudio.tools;

import com.alibaba.fastjson2.JSON;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 校验工具：确认草稿 source_data 与项目当前内容重新构造出的 targetSnapshot 完全一致。
 * <p>
 * applyAdaptationDrafts 应用前会做 Objects.equals 比对，这里离线复现同一构造过程，
 * 逐个目标类型输出是否相等，避免真正点「应用并替换」时才发现不匹配。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-03
 */
public final class VerifyDraftSourceData {

    /** 数据库连接串。 */
    private static final String URL = "jdbc:postgresql://localhost:15432/novanova_studio";

    /** 数据库用户。 */
    private static final String USER = "postgres";

    /** 数据库口令。 */
    private static final String PASSWORD = "123456";

    /** 禁止实例化校验工具。 */
    private VerifyDraftSourceData() { }

    /**
     * 逐类型比对草稿来源快照与当前内容快照。
     * @param args String[] 项目标识、任务标识
     * @throws Exception 数据库访问失败
     */
    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            System.out.println("用法: VerifyDraftSourceData <projectId> <jobId>");
            return;
        }
        String projectId = args[0];
        String jobId = args[1];

        try (Connection connection = DriverManager.getConnection(URL, USER, PASSWORD)) {
            Map<String, String> expected = BackfillDraftSourceData.buildSourcesForVerify(connection, projectId);
            Map<String, List<String>> stored = new LinkedHashMap<>();
            try (PreparedStatement statement = connection.prepareStatement("""
                    select d.target_type, d.source_data::text from script_ai_drafts d
                    join novel_adaptation_drafts n on n.draft_id = d.id
                    where n.job_id = ? and d.status = 'pending'
                    """)) {
                statement.setString(1, jobId);
                try (ResultSet result = statement.executeQuery()) {
                    while (result.next()) {
                        stored.computeIfAbsent(result.getString(1), key -> new ArrayList<>())
                                .add(result.getString(2));
                    }
                }
            }
            boolean allMatch = true;
            for (String type : List.of("overview", "outline", "characters", "world", "episodes")) {
                String want = expected.get(type);
                List<String> values = stored.getOrDefault(type, List.of());
                if (values.isEmpty()) {
                    System.out.printf("%-12s 无待审草稿%n", type);
                    continue;
                }
                // JSON 文本比较忽略键序，与 fastjson2 解析后 Objects.equals 的语义一致。
                boolean match = values.stream().allMatch(value ->
                        JSON.parseObject(value).equals(JSON.parseObject(want)));
                allMatch &= match;
                System.out.printf("%-12s 草稿 %d 份, 快照一致: %s%n", type, values.size(), match ? "是" : "否");
            }
            System.out.println(allMatch ? "全部类型比对通过，可以应用替换。" : "存在不一致，应用会被拒绝。");
        }
    }
}

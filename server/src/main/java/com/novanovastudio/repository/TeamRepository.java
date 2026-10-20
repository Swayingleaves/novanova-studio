package com.novanovastudio.repository;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.dto.TeamDtos;
import io.r2dbc.spi.Row;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 团队、成员、邀请与资源授权的数据访问。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-18 10:00
 */
@Repository
@RequiredArgsConstructor
public class TeamRepository {
    /** 数据库访问入口。 */
    private final DatabaseClient databaseClient;
    /** 团队管理列表不暴露密码与全局余额。 */
    private static final String TEAM_SELECT = """
            SELECT teams.*, users.email administrator_email, users.username administrator_username, users.nickname administrator_nickname,
                (SELECT COUNT(*) FROM team_members WHERE team_id = teams.id AND user_id IS DISTINCT FROM teams.administrator_user_id AND member_status <> 'removed') member_count,
                COALESCE((SELECT -SUM(change_amount) FROM user_credit_transactions transactions WHERE transactions.team_id = teams.id
                    AND transaction_type IN ('task_charge', 'task_refund', 'storage_charge', 'storage_purchase')), 0)::TEXT consumed_credits
            FROM teams LEFT JOIN users ON users.id = teams.administrator_user_id
            """;

    /** @return 全部团队，不包含平台占位记录 */
    public Flux<JSONObject> listTeams() {
        return query(TEAM_SELECT + " WHERE teams.id > 0 ORDER BY teams.created_at DESC", Map.of());
    }

    /**
     * 获取团队。
     * @param teamId 团队标识
     * @return 团队记录
     */
    public Mono<JSONObject> findTeam(long teamId) {
        return query(TEAM_SELECT + " WHERE teams.id = :teamId AND teams.id > 0", Map.of("teamId", teamId)).singleOrEmpty();
    }

    /**
     * 按访问路径获取公开品牌信息。
     * @param slug 唯一团队路径
     * @return 不含成员和账户信息的品牌记录
     */
    public Mono<JSONObject> findPublicTeam(String slug) {
        return query("SELECT id, team_slug, name, introduction, logo_url, enabled FROM teams WHERE team_slug = :slug AND id > 0", Map.of("slug", slug)).singleOrEmpty();
    }

    /**
     * 查询用户加入的团队。
     * @param userId 用户标识
     * @return 团队品牌、主管理员账号及本人成员身份
     */
    public Flux<JSONObject> listUserTeams(long userId) {
        return query("""
                SELECT teams.id, teams.team_slug, teams.name, teams.introduction, teams.logo_url, teams.enabled,
                    members.member_role, members.member_status, administrators.username administrator_username
                FROM team_members members
                JOIN teams ON teams.id = members.team_id
                LEFT JOIN users administrators ON administrators.id = teams.administrator_user_id
                WHERE members.user_id = :userId AND members.member_status <> 'removed'
                ORDER BY teams.name, teams.id
                """, Map.of("userId", userId));
    }

    /**
     * 查询当前成员身份，即使团队禁用也返回用于显式拒绝。
     * @param teamId 团队标识
     * @param userId 用户标识
     * @return 团队和成员状态
     */
    public Mono<JSONObject> findMembership(long teamId, long userId) {
        return query("SELECT teams.enabled, members.* FROM team_members members JOIN teams ON teams.id = members.team_id WHERE members.team_id = :teamId AND members.user_id = :userId", Map.of("teamId", teamId, "userId", userId)).singleOrEmpty();
    }

    /**
     * 锁定团队，创建成员和接受邀请共用此锁保证人数限制。
     * @param teamId 团队标识
     * @return 被锁定的团队
     */
    public Mono<JSONObject> lockTeam(long teamId) {
        return query("SELECT * FROM teams WHERE id = :teamId AND id > 0 FOR UPDATE", Map.of("teamId", teamId)).singleOrEmpty();
    }

    /**
     * 创建团队。
     * @param request 创建参数
     * @return 新团队标识
     */
    public Mono<Long> createTeam(TeamDtos.CreateTeamRequest request) {
        return databaseClient.sql("INSERT INTO teams(team_slug, name, member_limit) VALUES (:slug, :name, :limit) RETURNING id")
                .bind("slug", request.teamSlug()).bind("name", request.name()).bind("limit", request.memberLimit())
                .map((row, metadata) -> row.get("id", Long.class)).one();
    }

    /**
     * 更新团队资料。
     * @param teamId 团队标识
     * @param request 团队资料
     * @return 完成信号
     */
    public Mono<Void> updateTeam(long teamId, TeamDtos.UpdateTeamRequest request) {
        return execute("UPDATE teams SET name = :name, introduction = :introduction, logo_url = :logo, updated_at = CURRENT_TIMESTAMP WHERE id = :teamId", Map.of("teamId", teamId, "name", request.name(), "introduction", request.introduction(), "logo", request.logoUrl()));
    }

    /**
     * 更新团队设置并记录禁用计费区间，调用者必须持有团队行锁。
     * @param request 团队设置
     * @param previousEnabled 原启用状态
     * @return 完成信号
     */
    public Mono<Void> updateSettings(TeamDtos.UpdateTeamSettingsRequest request, boolean previousEnabled) {
        Mono<Void> period = Mono.empty();
        if (request.enabled() != previousEnabled) {
            period = request.enabled()
                    ? execute("UPDATE team_disabled_periods SET restored_at = CURRENT_TIMESTAMP WHERE team_id = :teamId AND restored_at IS NULL", Map.of("teamId", request.teamId()))
                    : execute("INSERT INTO team_disabled_periods(team_id) VALUES (:teamId)", Map.of("teamId", request.teamId()));
        }
        return period.then(execute("UPDATE teams SET enabled = :enabled, member_limit = :limit, updated_at = CURRENT_TIMESTAMP WHERE id = :teamId",
                Map.of("teamId", request.teamId(), "enabled", request.enabled(), "limit", request.memberLimit())));
    }

    /**
     * 查询成员管理列表，不读取平台钱包。
     * @param teamId 团队标识
     * @return 成员、团队余额和本团队消费汇总
     */
    public Flux<JSONObject> listMembers(long teamId) {
        return query("""
                SELECT members.user_id, users.email, users.username, users.nickname, members.member_role, members.member_status, members.joined_at,
                    (members.user_id = teams.administrator_user_id) IS TRUE is_primary_administrator,
                    (teams.enabled AND users.email IS NULL AND users.role = 'user' AND users.created_by_team_id = members.team_id
                        AND members.member_role = 'member' AND members.member_status <> 'removed') IS TRUE can_reset_password,
                    COALESCE(accounts.credit_balance, 0)::TEXT team_credit_balance,
                    COALESCE((SELECT -SUM(change_amount) FROM user_credit_transactions transactions
                        WHERE transactions.team_id = members.team_id AND transactions.user_id = members.user_id
                          AND transaction_type IN ('task_charge', 'task_refund', 'storage_charge', 'storage_purchase')), 0)::TEXT consumed_credits
                FROM team_members members JOIN users ON users.id = members.user_id JOIN teams ON teams.id = members.team_id
                LEFT JOIN user_credit_accounts accounts ON accounts.user_id = members.user_id AND accounts.team_id = members.team_id
                WHERE members.team_id = :teamId AND members.member_status <> 'removed' ORDER BY members.joined_at
                """, Map.of("teamId", teamId));
    }

    /**
     * 计算占用名额。
     * @param teamId 团队标识
     * @return 包含禁用成员的子账号数
     */
    public Mono<Long> countMembers(long teamId) {
        return databaseClient.sql("""
                SELECT COUNT(*) count FROM team_members members JOIN teams ON teams.id = members.team_id
                WHERE members.team_id = :teamId AND members.user_id IS DISTINCT FROM teams.administrator_user_id
                    AND members.member_status <> 'removed'
                """)
                .bind("teamId", teamId).map((row, metadata) -> row.get("count", Long.class)).one();
    }

    /**
     * 建立或恢复成员关系及团队钱包。
     * @param teamId 团队标识
     * @param userId 用户标识
     * @param role 团队角色
     * @return 完成信号
     */
    public Mono<Void> addMember(long teamId, long userId, String role) {
        Map<String, Object> keys = Map.of("teamId", teamId, "userId", userId);
        // 主管理员建立成员关系前先明确归属，名额触发器才能正确排除其本人。
        Mono<Void> primaryAdministrator = "administrator".equals(role)
                ? execute("UPDATE teams SET administrator_user_id = :userId WHERE id = :teamId", keys) : Mono.empty();
        return primaryAdministrator.then(execute("INSERT INTO team_members(team_id, user_id, member_role) VALUES (:teamId, :userId, :role) ON CONFLICT(team_id, user_id) DO UPDATE SET member_role = EXCLUDED.member_role, member_status = 'active', joined_at = CURRENT_TIMESTAMP, removed_at = NULL", Map.of("teamId", teamId, "userId", userId, "role", role)))
                .then(execute("INSERT INTO user_credit_accounts(team_id, user_id, credit_balance) VALUES (:teamId, :userId, 0) ON CONFLICT(user_id, team_id) DO UPDATE SET frozen = FALSE", keys));
    }

    /**
     * 更新现有成员的团队身份，保留状态、钱包与主管理员归属。
     * @param teamId 当前团队标识
     * @param userId 目标成员标识
     * @param memberRole 团队管理员或普通成员
     * @return 更新完成信号
     */
    public Mono<Void> updateMemberRole(long teamId, long userId, String memberRole) {
        return databaseClient.sql("""
                UPDATE team_members SET member_role = :memberRole
                WHERE team_id = :teamId AND user_id = :userId AND member_status <> 'removed'
                    AND user_id IS DISTINCT FROM (SELECT administrator_user_id FROM teams WHERE id = :teamId)
                """).bind("teamId", teamId).bind("userId", userId).bind("memberRole", memberRole).fetch().rowsUpdated().then();
    }

    /**
     * 更新当前团队成员状态。
     * @param teamId 团队标识
     * @param userId 成员标识
     * @param status 目标状态
     * @return 完成信号
     */
    public Mono<Void> updateMemberStatus(long teamId, long userId, String status) {
        return execute("UPDATE team_members SET member_status = :status, removed_at = CASE WHEN :status = 'removed' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE team_id = :teamId AND user_id = :userId AND member_role = 'member'", Map.of("teamId", teamId, "userId", userId, "status", status));
    }

    /**
     * 冻结余额并持久化成员数据清理请求。
     * @param teamId 团队标识
     * @param userId 用户标识
     * @return 完成信号
     */
    public Mono<Void> requestCleanup(long teamId, long userId) {
        Map<String, Object> keys = Map.of("teamId", teamId, "userId", userId);
        return execute("UPDATE user_credit_accounts SET frozen = TRUE WHERE team_id = :teamId AND user_id = :userId", keys)
                .then(execute("INSERT INTO team_member_cleanup_jobs(team_id, user_id) VALUES (:teamId, :userId) ON CONFLICT(team_id, user_id) DO UPDATE SET requested_at = CURRENT_TIMESTAMP, completed_at = NULL, last_error = NULL", keys));
    }

    /**
     * 检查移除清理是否尚未完成。
     * @param teamId 团队标识
     * @param userId 用户标识
     * @return 是否仍在清理
     */
    public Mono<Boolean> cleanupPending(long teamId, long userId) {
        return databaseClient.sql("SELECT EXISTS(SELECT 1 FROM team_member_cleanup_jobs WHERE team_id = :teamId AND user_id = :userId AND completed_at IS NULL) pending")
                .bind("teamId", teamId).bind("userId", userId).map((row, metadata) -> row.get("pending", Boolean.class)).one();
    }

    /**
     * 创建绑定用户或未注册邮箱的邀请，调用者需先锁定团队行。
     * @param teamId 团队标识
     * @param account 账号展示快照
     * @param email 受邀邮箱，允许为空
     * @param invitedUserId 已注册的目标用户，允许为空
     * @param role 受邀角色
     * @param operator 操作人
     * @return 新邀请标识
     */
    public Mono<UUID> createInvitation(long teamId, String account, String email, Long invitedUserId, String role, long operator) {
        UUID id = UUID.randomUUID();
        var revoke = databaseClient.sql("UPDATE team_invitations SET invitation_status = 'revoked' WHERE team_id = :teamId AND invitation_status = 'pending' AND (invited_user_id = :userId OR email = :email)")
                .bind("teamId", teamId);
        revoke = R2dbcBindings.bindNullable(revoke, "userId", invitedUserId, Long.class);
        revoke = R2dbcBindings.bindNullable(revoke, "email", email, String.class);
        var insert = databaseClient.sql("""
                INSERT INTO team_invitations(id, team_id, email, invited_user_id, invited_account, member_role, invited_by, expires_at)
                VALUES (:id, :teamId, :email, :userId, :account, :role, :operator, :expires)
                """).bind("id", id).bind("teamId", teamId).bind("account", account).bind("role", role)
                .bind("operator", operator).bind("expires", OffsetDateTime.now().plusDays(7));
        insert = R2dbcBindings.bindNullable(insert, "userId", invitedUserId, Long.class);
        insert = R2dbcBindings.bindNullable(insert, "email", email, String.class);
        return revoke.fetch().rowsUpdated().then(insert.fetch().rowsUpdated()).thenReturn(id);
    }

    /**
     * 查询邀请，可在接受时加锁。
     * @param id 邀请标识
     * @param lock 是否持有行锁
     * @return 邀请详情
     */
    public Mono<JSONObject> findInvitation(UUID id, boolean lock) {
        return query("SELECT * FROM team_invitations WHERE id = :id" + (lock ? " FOR UPDATE" : ""), Map.of("id", id)).singleOrEmpty();
    }

    /**
     * 查询本人收到的待接受邀请，已有账号只按用户标识匹配。
     * @param userId 当前用户标识
     * @param email 当前邮箱，允许为空
     * @return 未过期邀请
     */
    public Flux<JSONObject> listMyInvitations(long userId, String email) {
        var statement = databaseClient.sql("""
                SELECT invitations.id, invitations.team_id, invitations.member_role, invitations.invited_account,
                    invitations.expires_at, teams.name, teams.team_slug
                FROM team_invitations invitations JOIN teams ON teams.id = invitations.team_id
                WHERE (invitations.invited_user_id = :userId OR (invitations.invited_user_id IS NULL AND invitations.email = :email))
                    AND invitations.invitation_status = 'pending' AND invitations.expires_at > CURRENT_TIMESTAMP
                ORDER BY invitations.created_at DESC
                """).bind("userId", userId);
        return R2dbcBindings.bindNullable(statement, "email", email, String.class).map((row, metadata) -> mapRow(row)).all();
    }

    /**
     * 查询本团队邀请。
     * @param teamId 团队标识
     * @return 邀请列表
     */
    public Flux<JSONObject> listTeamInvitations(long teamId) {
        return query("SELECT * FROM team_invitations WHERE team_id = :teamId ORDER BY created_at DESC LIMIT 100", Map.of("teamId", teamId));
    }

    /**
     * 更新邀请状态。
     * @param id 邀请标识
     * @param status 目标状态
     * @return 完成信号
     */
    public Mono<Void> updateInvitation(UUID id, String status) {
        return execute("UPDATE team_invitations SET invitation_status = :status, accepted_at = CASE WHEN :status = 'accepted' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id = :id", Map.of("id", id, "status", status));
    }

    /**
     * 读取团队配置开关。
     * @param teamId 团队标识
     * @return 五类模块的继承方式
     */
    public Flux<JSONObject> listConfigurationModes(long teamId) {
        return query("SELECT modules.module_name, COALESCE(modes.inherit_global, TRUE) inherit_global FROM unnest(ARRAY['prompts','notifications','styles','skills','homepage']) modules(module_name) LEFT JOIN team_configuration_modes modes ON modes.team_id = :teamId AND modes.module_name = modules.module_name", Map.of("teamId", teamId));
    }

    /**
     * 保存单个模块继承方式。
     * @param teamId 团队标识
     * @param request 配置开关
     * @return 完成信号
     */
    public Mono<Void> updateConfigurationMode(long teamId, TeamDtos.ConfigurationModeRequest request) {
        return execute("INSERT INTO team_configuration_modes(team_id, module_name, inherit_global) VALUES (:teamId, :module, :inherit) ON CONFLICT(team_id, module_name) DO UPDATE SET inherit_global = EXCLUDED.inherit_global", Map.of("teamId", teamId, "module", request.moduleName(), "inherit", request.inheritGlobal()));
    }

    /**
     * 查询授权记录。
     * @param teamId 团队标识
     * @return 授权记录
     */
    public Flux<JSONObject> listGrants(long teamId) {
        return query("SELECT resource_type, resource_id FROM team_resource_grants WHERE team_id = :teamId", Map.of("teamId", teamId));
    }

    /**
     * 显式替换一类授权，授权目标必须是平台资源。
     * @param teamId 团队标识
     * @param type 资源类型
     * @param ids 平台资源标识
     * @return 完成信号，目标缺失时由调用方校验数量
     */
    public Mono<Long> replaceGrants(long teamId, String type, java.util.List<String> ids) {
        String table = "model".equals(type) ? "platform_ai_model_configs" : "channel".equals(type) ? "platform_ai_channels" : "platform_object_storage_configs";
        String column = "model".equals(type) ? "model_config_id" : "channel".equals(type) ? "channel_id" : "storage_id";
        return execute("DELETE FROM team_resource_grants WHERE team_id = :teamId AND resource_type = :type", Map.of("teamId", teamId, "type", type))
                .thenMany(Flux.fromIterable(ids.stream().distinct().toList()))
                .concatMap(id -> databaseClient.sql("INSERT INTO team_resource_grants(team_id, resource_type, resource_id) SELECT :teamId, :type, " + column + " FROM " + table + " WHERE " + column + " = :id AND team_id = 0")
                        .bind("teamId", teamId).bind("type", type).bind("id", id).fetch().rowsUpdated())
                .reduce(0L, Long::sum);
    }

    /**
     * 查询资源归属，表名和字段来自固定白名单。
     * @param type 资源类型
     * @param id 资源标识
     * @return 所属团队与资源类型
     */
    public Mono<JSONObject> findResource(String type, String id) {
        String table = "model".equals(type) ? "platform_ai_model_configs" : "channel".equals(type) ? "platform_ai_channels" : "platform_object_storage_configs";
        String column = "model".equals(type) ? "model_config_id" : "channel".equals(type) ? "channel_id" : "storage_id";
        return query("SELECT team_id" + ("model".equals(type) ? ", model_type" : "") + " FROM " + table + " WHERE " + column + " = :id", Map.of("id", id)).singleOrEmpty();
    }

    /**
     * 保存团队资源偏好，默认模型按模型类型互斥。
     * @param teamId 团队标识
     * @param request 资源偏好
     * @param modelType 模型类型，对象存储传空串
     * @return 完成信号
     */
    public Mono<Void> savePreference(long teamId, TeamDtos.ResourcePreferenceRequest request, String modelType) {
        Mono<Void> reset = request.defaultResource() ? execute("UPDATE team_resource_preferences SET is_default = FALSE WHERE team_id = :teamId AND resource_type = :type" +
                ("model".equals(request.resourceType()) ? " AND resource_id IN (SELECT model_config_id FROM platform_ai_model_configs WHERE model_type = :modelType)" : ""),
                "model".equals(request.resourceType()) ? Map.of("teamId", teamId, "type", request.resourceType(), "modelType", modelType) : Map.of("teamId", teamId, "type", request.resourceType())) : Mono.empty();
        return reset.then(execute("INSERT INTO team_resource_preferences(team_id, resource_type, resource_id, enabled, is_default, model_type) VALUES (:teamId, :type, :id, :enabled, :default, :modelType) ON CONFLICT(team_id, resource_type, resource_id) DO UPDATE SET enabled = EXCLUDED.enabled, is_default = EXCLUDED.is_default, model_type = EXCLUDED.model_type",
                Map.of("teamId", teamId, "type", request.resourceType(), "id", request.resourceId(), "enabled", request.enabled(), "default", request.defaultResource(), "modelType", modelType)));
    }

    /**
     * 读取资源偏好。
     * @param teamId 团队标识
     * @return 偏好列表
     */
    public Flux<JSONObject> listPreferences(long teamId) {
        return query("SELECT resource_type, resource_id, enabled, is_default FROM team_resource_preferences WHERE team_id = :teamId", Map.of("teamId", teamId));
    }

    /**
     * 读取当前空间可见的资源目录，不返回任何密钥。
     * @return 平台自有或团队自有及显式授权的资源
     */
    public Flux<JSONObject> listAvailableResources() {
        return query("""
                SELECT models.model_config_id resource_id, 'model' resource_type, models.model_name name,
                    models.team_id owner_team_id, models.model_type, channels.name channel_name
                FROM platform_ai_model_configs models JOIN platform_ai_channels channels ON channels.channel_id = models.channel_id
                UNION ALL
                SELECT storage_id, 'objectStorage', name, team_id, NULL, NULL FROM platform_object_storage_configs WHERE status = 1
                """, Map.of());
    }

    /**
     * 当前团队消费和收入归属明细，平台钱包余额不向团队管理员暴露。
     * @param teamId 当前团队
     * @return 最近消费与发放流水
     */
    public Flux<JSONObject> listTeamTransactions(long teamId) {
        return query("""
                SELECT transactions.id, transactions.user_id, users.email, users.username, transactions.transaction_type,
                    transactions.change_amount::TEXT change_amount, transactions.wallet_team_id, transactions.beneficiary_team_id,
                    CASE WHEN wallet_team_id = :teamId THEN balance_after::TEXT ELSE NULL END balance_after,
                    transactions.reason, transactions.created_at
                FROM user_credit_transactions transactions JOIN users ON users.id = transactions.user_id
                WHERE transactions.team_id = :teamId ORDER BY transactions.created_at DESC, transactions.id DESC LIMIT 200
                """, Map.of("teamId", teamId));
    }

    /**
     * 执行受控查询并将数据库字段转换为接口驼峰名称。
     * @param sql 固定参数化查询
     * @param parameters 绑定参数
     * @return 查询记录
     */
    public Flux<JSONObject> query(String sql, Map<String, ?> parameters) {
        DatabaseClient.GenericExecuteSpec statement = databaseClient.sql(sql);
        for (var entry : parameters.entrySet()) statement = statement.bind(entry.getKey(), entry.getValue());
        return statement.map((row, metadata) -> mapRow(row)).all();
    }

    /**
     * 执行固定参数化写入。
     * @param sql 写入语句
     * @param parameters 绑定参数
     * @return 完成信号
     */
    private Mono<Void> execute(String sql, Map<String, ?> parameters) {
        DatabaseClient.GenericExecuteSpec statement = databaseClient.sql(sql);
        for (var entry : parameters.entrySet()) statement = statement.bind(entry.getKey(), entry.getValue());
        return statement.fetch().rowsUpdated().then();
    }

    /**
     * 映射管理列表行，不用于需要快照全等比对的业务内容。
     * @param row 数据库行
     * @return 驼峰字段记录
     */
    private static JSONObject mapRow(Row row) {
        JSONObject result = new JSONObject();
        for (var column : row.getMetadata().getColumnMetadatas()) {
            String name = column.getName();
            StringBuilder key = new StringBuilder();
            boolean uppercase = false;
            for (char character : name.toCharArray()) {
                if (character == '_') uppercase = true;
                else { key.append(uppercase ? Character.toUpperCase(character) : character); uppercase = false; }
            }
            Object value = row.get(name);
            result.put(key.toString(), value instanceof java.time.temporal.TemporalAccessor || value instanceof UUID ? value.toString() : value);
        }
        return result;
    }
}

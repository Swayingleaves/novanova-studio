import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

/** 使用实际迁移和仓储SQL验证可空邮箱、邀请身份和重置能力，不连接业务数据库。 */
test("用户名账号迁移、邀请目标及重置能力", async (context) => {
    const database = new PGlite();
    const migrationDirectory = new URL("../../../../server/src/main/resources/db/migration/", import.meta.url);
    const files = (await readdir(migrationDirectory)).filter((name) => /^V\d+__.*\.sql$/.test(name)).sort((left, right) => Number(left.match(/^V(\d+)/)[1]) - Number(right.match(/^V(\d+)/)[1]));
    const repository = await readFile(new URL("../../../../server/src/main/java/com/novanovastudio/repository/TeamRepository.java", import.meta.url), "utf8");
    const userRepository = await readFile(new URL("../../../../server/src/main/java/com/novanovastudio/repository/UserRepository.java", import.meta.url), "utf8");
    /** 从实际仓储提取固定SQL并绑定命名参数。 */
    const execute = async (source, method, parameters, index = 0) => {
        const start = source.indexOf(` ${method}(`);
        assert.notEqual(start, -1);
        const statements = [...source.slice(start, source.indexOf("\n    /**", start)).matchAll(/(?:databaseClient\.sql|query|execute)\((?:"""([\s\S]*?)"""|"([^"\n]+)")/g)];
        const statement = statements[index]?.[1] || statements[index]?.[2];
        assert.ok(statement, method);
        const names = [];
        const query = statement.replace(/(?<!:):([a-zA-Z][a-zA-Z0-9]*)/g, (_, name) => {
            if (!names.includes(name)) names.push(name);
            return `$${names.indexOf(name) + 1}`;
        });
        return database.query(query, names.map((name) => parameters[name]));
    };
    try {
        for (const file of files) {
            if (file.endsWith("__Add_Username_Accounts_And_Invitation_Targets.sql")) await database.exec(`
                INSERT INTO users(id,username,email,invitation_code) VALUES(2011,'historical@example.com','historical@example.com','HISTORICAL2011');
                INSERT INTO user_credit_accounts(team_id,user_id,credit_balance) VALUES(0,2011,0);
                INSERT INTO teams(id,team_slug,name,member_limit) VALUES(501,'account-test-a','账号团队甲',5),(502,'account-test-b','账号团队乙',5);
                INSERT INTO team_invitations(id,team_id,email,member_role,invited_by,expires_at) VALUES
                    ('00000000-0000-0000-0000-000000000001',501,'historical@example.com','member',2011,CURRENT_TIMESTAMP + INTERVAL '7 days'),
                    ('00000000-0000-0000-0000-000000000002',501,'future@example.com','member',2011,CURRENT_TIMESTAMP + INTERVAL '7 days');
            `);
            await database.exec(await readFile(new URL(file, migrationDirectory), "utf8"));
        }
        await context.test("历史邀请绑定已有用户且不猜测账号创建归属", async () => {
            const invitations = (await database.query("SELECT invited_user_id,invited_account FROM team_invitations ORDER BY id")).rows;
            assert.equal(invitations[0].invited_user_id, 2011);
            assert.equal(invitations[1].invited_user_id, null);
            assert.equal(invitations[1].invited_account, "future@example.com");
            assert.equal((await database.query("SELECT created_by_team_id FROM users WHERE id=2011")).rows[0].created_by_team_id, null);
        });
        await context.test("真实账号写入允许空邮箱并保留区分大小写的唯一用户名", async () => {
            const input = { username: "Creator", password: "hash", email: null, nickname: "创作者", avatar: null, role: "user", status: 1, invitationCode: "ACCOUNTTEST01", invitedByUserId: null, registeredAt: new Date(), createdByTeamId: 501, createdByUserId: 2011 };
            const created = await execute(userRepository, "createUser", input);
            const userId = created.rows[0].id;
            const user = (await database.query("SELECT * FROM users WHERE id=$1", [userId])).rows[0];
            assert.equal(user.email, null);
            assert.equal(user.created_by_team_id, 501);
            await assert.rejects(execute(userRepository, "createUser", { ...input, invitationCode: "ACCOUNTTEST02" }), /unique/);
            await execute(userRepository, "createUser", { ...input, username: "creator", invitationCode: "ACCOUNTTEST03" });
            await database.query("INSERT INTO user_credit_accounts(team_id,user_id,credit_balance) VALUES(0,$1,0)", [userId]);
            await database.query("INSERT INTO team_members(team_id,user_id,member_role) VALUES(501,$1,'member'),(502,$1,'member')", [userId]);
        });
        const creator = (await database.query("SELECT id FROM users WHERE username='Creator'")).rows[0].id;
        await context.test("身份授权不变更主管理员、其他空间身份及名额，零名额团队仍可创建主管理员", async () => {
            await database.exec("BEGIN");
            try {
                await database.exec(`
                    INSERT INTO users(id,username,email,invitation_code) VALUES(2030,'ExtraMember',NULL,'EXTRAMEMBER2030');
                    UPDATE teams SET administrator_user_id=2011,member_limit=1 WHERE id IN (501,502);
                    INSERT INTO team_members(team_id,user_id,member_role) VALUES(501,2011,'administrator'),(502,2011,'administrator');
                    INSERT INTO teams(id,team_slug,name,member_limit) VALUES(503,'zero-quota-team','零名额团队',0);
                `);
                for (let index = 0; index < 3; index++) await execute(repository, "addMember", { teamId: 503, userId: 2011, role: "administrator" }, index);
                assert.equal((await execute(repository, "countMembers", { teamId: 503 })).rows[0].count, 0);
                assert.equal((await database.query("SELECT administrator_user_id FROM teams WHERE id=503")).rows[0].administrator_user_id, 2011);
                assert.equal((await execute(repository, "countMembers", { teamId: 501 })).rows[0].count, 1);
                await execute(repository, "updateMemberRole", { teamId: 501, userId: creator, memberRole: "administrator" });
                assert.equal((await execute(repository, "countMembers", { teamId: 501 })).rows[0].count, 1);
                assert.equal((await database.query("SELECT role FROM users WHERE id=$1", [creator])).rows[0].role, "user");
                assert.equal((await database.query("SELECT member_role FROM team_members WHERE team_id=502 AND user_id=$1", [creator])).rows[0].member_role, "member");
                const members = (await execute(repository, "listMembers", { teamId: 501 })).rows;
                assert.equal(members.find((member) => member.user_id === 2011).is_primary_administrator, true);
                assert.equal(members.find((member) => member.user_id === creator).is_primary_administrator, false);
                assert.equal(members.find((member) => member.user_id === creator).can_reset_password, false);
                await database.exec("SAVEPOINT full_team");
                await assert.rejects(database.query("INSERT INTO team_members(team_id,user_id,member_role) VALUES(501,2030,'administrator')"), /达到上限/);
                await database.exec("ROLLBACK TO SAVEPOINT full_team");
                await execute(repository, "updateMemberRole", { teamId: 501, userId: 2011, memberRole: "member" });
                assert.equal((await database.query("SELECT member_role FROM team_members WHERE team_id=501 AND user_id=2011")).rows[0].member_role, "administrator");
                await execute(repository, "updateMemberRole", { teamId: 501, userId: creator, memberRole: "member" });
                assert.equal((await execute(repository, "countMembers", { teamId: 501 })).rows[0].count, 1);
                await database.query("UPDATE team_members SET member_status='removed' WHERE team_id=501 AND user_id=$1", [creator]);
                assert.equal((await execute(repository, "countMembers", { teamId: 501 })).rows[0].count, 0);
                await execute(repository, "updateMemberRole", { teamId: 501, userId: creator, memberRole: "administrator" });
                assert.equal((await database.query("SELECT member_role FROM team_members WHERE team_id=501 AND user_id=$1", [creator])).rows[0].member_role, "member");
            } finally { await database.exec("ROLLBACK"); }
        });
        await context.test("本人团队卡片返回管理员账号和品牌，排除未加入与已移除的团队", async () => {
            await database.exec("BEGIN");
            try {
                await database.exec(`
                    INSERT INTO users(id,username,email,invitation_code) VALUES(2020,'TeamOwner',NULL,'TEAMOWNER2020');
                    UPDATE teams SET administrator_user_id=2011,logo_url='https://example.com/team-logo.svg',introduction='团队介绍' WHERE id=501;
                    UPDATE teams SET administrator_user_id=2020 WHERE id=502;
                    INSERT INTO team_members(team_id,user_id,member_role) VALUES(501,2011,'administrator'),(502,2020,'administrator');
                    INSERT INTO teams(id,team_slug,name,member_limit,administrator_user_id) VALUES(503,'account-test-private','其他团队',5,2020);
                `);
                const teams = (await execute(repository, "listUserTeams", { userId: creator })).rows;
                assert.deepEqual(teams.map((team) => team.id).sort(), [501, 502]);
                assert.equal(teams.find((team) => team.id === 501).administrator_username, "historical@example.com");
                assert.equal(teams.find((team) => team.id === 501).logo_url, "https://example.com/team-logo.svg");
                assert.equal(teams.find((team) => team.id === 501).introduction, "团队介绍");
                assert.equal(teams.find((team) => team.id === 502).administrator_username, "TeamOwner");
                assert.equal(teams.find((team) => team.id === 502).logo_url, "");
                const managedTeams = (await execute(repository, "listUserTeams", { userId: 2020 })).rows;
                assert.equal(managedTeams.length, 1);
                assert.equal(managedTeams[0].member_role, "administrator");
                await database.query("INSERT INTO team_members(team_id,user_id,member_role,member_status) VALUES(503,$1,'member','removed')", [creator]);
                assert.equal((await execute(repository, "listUserTeams", { userId: creator })).rows.length, 2);
            } finally { await database.exec("ROLLBACK"); }
        });
        await context.test("用户名改名后邀请仍属于原用户，旧名称的新主人无法领取", async () => {
            await database.query("INSERT INTO team_invitations(id,team_id,invited_user_id,invited_account,member_role,invited_by,expires_at) VALUES('00000000-0000-0000-0000-000000000003',502,$1,'Creator','member',2011,CURRENT_TIMESTAMP + INTERVAL '7 days')", [creator]);
            await database.query("UPDATE users SET username='RenamedCreator' WHERE id=$1", [creator]);
            await database.exec("INSERT INTO users(id,username,email,invitation_code) VALUES(2012,'Creator',NULL,'HISTORICAL2012')");
            assert.equal((await execute(repository, "listMyInvitations", { userId: creator, email: null })).rows.length, 1);
            assert.equal((await execute(repository, "listMyInvitations", { userId: 2012, email: null })).rows.length, 0);
            await assert.rejects(database.query("INSERT INTO team_invitations(id,team_id,invited_user_id,invited_account,member_role,invited_by,expires_at) VALUES('00000000-0000-0000-0000-000000000004',502,$1,'RenamedCreator','member',2011,CURRENT_TIMESTAMP + INTERVAL '7 days')", [creator]), /unique/);
        });
        await context.test("创建团队显示重置能力，其他团队、移除及主管理员均不允许", async () => {
            const capability = async (teamId) => (await execute(repository, "listMembers", { teamId })).rows.find((row) => row.user_id === creator)?.can_reset_password;
            assert.equal(await capability(501), true);
            assert.equal(await capability(502), false);
            await database.query("UPDATE team_members SET member_status='disabled' WHERE team_id=501 AND user_id=$1", [creator]);
            assert.equal(await capability(501), true);
            await database.query("UPDATE team_members SET member_status='removed' WHERE team_id=501 AND user_id=$1", [creator]);
            assert.equal(await capability(501), undefined);
            await database.query("UPDATE team_members SET member_status='active',member_role='administrator' WHERE team_id=501 AND user_id=$1", [creator]);
            assert.equal(await capability(501), false);
        });
        await context.test("重置密码递增令牌版本且不改角色或状态", async () => {
            await execute(userRepository, "updatePasswordAfterReset", { userId: creator, password: "new-hash" });
            const user = (await database.query("SELECT password,token_version,role,status FROM users WHERE id=$1", [creator])).rows[0];
            assert.deepEqual(user, { password: "new-hash", token_version: 1, role: "user", status: 1 });
        });
    } finally { await database.close(); }
});

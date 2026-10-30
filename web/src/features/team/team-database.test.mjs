import assert from "node:assert/strict";
import { test } from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

/** 用真实PostgreSQL引擎验证完整迁移、行级隔离与自然月计费，无需浏览器或运行中数据库。 */
test("团队迁移、资源授权、钱包隔离与月度账单", async (context) => {
    const database = new PGlite();
    const migrationDirectory = new URL("../../../../server/src/main/resources/db/migration/", import.meta.url);
    const files = (await readdir(migrationDirectory)).filter((name) => /^V\d+__.*\.sql$/.test(name)).sort((left, right) => Number(left.match(/^V(\d+)/)[1]) - Number(right.match(/^V(\d+)/)[1]));
    try {
        for (const file of files) {
            if (file.startsWith("V57__")) await database.exec(`
                INSERT INTO users(id,username,email,invitation_code) VALUES(1000,'historical-user','historical@example.com','HISTORY001');
                INSERT INTO platform_object_storage_configs(storage_id,name,provider,bucket,region) VALUES
                    ('historical-storage','历史明确存储','tencentCos','historical-bucket','region-a'),
                    ('ambiguous-storage-a','历史歧义甲','tencentCos','ambiguous-bucket','region-a'),
                    ('ambiguous-storage-b','历史歧义乙','tencentCos','ambiguous-bucket','region-a');
                INSERT INTO media_files(storage_key,user_id,kind,object_storage_provider,object_storage_key,bucket,region,mime_type,bytes) VALUES
                    ('historical-file',1000,'image','tencentCos','historical-key','historical-bucket','region-a','image/png',12345),
                    ('ambiguous-file',1000,'image','tencentCos','ambiguous-key','ambiguous-bucket','region-a','image/png',54321);
            `);
            await database.exec(await readFile(new URL(file, migrationDirectory), "utf8"));
        }
        await database.exec(`
            INSERT INTO users(id, username, email, invitation_code) VALUES (1001, 'team-test-user', 'team-test@example.com', 'TEAMTEST01');
            INSERT INTO teams(id, team_slug, name, member_limit) VALUES (101, 'team-a', '团队甲', 2), (102, 'team-b', '团队乙', 2);
            INSERT INTO team_members(team_id, user_id, member_role) VALUES (101, 1001, 'administrator'), (102, 1001, 'member');
            INSERT INTO user_credit_accounts(team_id, user_id, credit_balance) VALUES (0, 1001, 12.123456), (101, 1001, 34.000001), (102, 1001, 56.000002);
            INSERT INTO platform_ai_channels(channel_id, name, base_url, api_key_encrypted, api_format, team_id) VALUES ('test-platform-channel', '平台渠道', 'https://example.com', 'encrypted', 'openai', 0);
            INSERT INTO platform_ai_model_configs(model_config_id, channel_id, model_name, model_type, team_id, credit_cost) VALUES ('test-platform-model', 'test-platform-channel', 'platform-model', 'image', 0, 0.123456);
            INSERT INTO platform_object_storage_configs(storage_id, name, team_id) VALUES ('test-storage', '平台对象存储', 0);
            SET ROLE novanova_pro_runtime;
            SET novanova.team_id = '101';
            SET novanova.wallet_team_id = '0';
            SET novanova.system_access = 'false';
        `);
        await context.test("历史对象按明确身份登记，歧义配置必须由管理员确认", async () => {
            await database.exec("RESET ROLE; SET novanova.team_id='0'; SET novanova.system_access='true'");
            assert.equal((await database.query("SELECT file_bytes FROM storage_objects WHERE storage_id='historical-storage'")).rows[0].file_bytes, 12345);
            assert.equal((await database.query("SELECT object_storage_config_id FROM media_files WHERE storage_key='ambiguous-file'")).rows[0].object_storage_config_id, null);
            const source = await readFile(new URL("../../../../server/src/main/java/com/novanovastudio/repository/StorageBillingRepository.java", import.meta.url), "utf8");
            const method = source.slice(source.indexOf('public Mono<Void> registerExistingMedia'));
            const update = method.match(/databaseClient\.sql\("([^"\n]+)"\)/)[1];
            const insert = method.match(/databaseClient\.sql\("""([\s\S]*?)"""/)[1];
            await database.query(update.replaceAll(':storage','$1'),['ambiguous-storage-b']);
            await database.query(insert.replaceAll(':storage','$1'),['ambiguous-storage-b']);
            assert.equal((await database.query("SELECT storage_id,file_bytes FROM storage_objects WHERE object_key='ambiguous-key'")).rows[0].storage_id, 'ambiguous-storage-b');
            assert.equal((await database.query("SELECT COUNT(*)::INT amount FROM storage_objects WHERE object_key='ambiguous-key'")).rows[0].amount, 1);
            await database.exec("SET ROLE novanova_pro_runtime; SET novanova.team_id='101'; SET novanova.system_access='false'");
        });
        await context.test("同一用户在两个团队的创作数据与配置分别隔离", async () => {
            await database.exec("INSERT INTO canvas_projects(id,user_id,title,project_data) VALUES ('team-a-project',1001,'团队甲画布','{}'); INSERT INTO user_configs(user_id,config_data) VALUES(1001,'团队甲配置');");
            await database.exec("SET novanova.team_id = '102'; INSERT INTO user_configs(user_id,config_data) VALUES(1001,'团队乙配置');");
            assert.equal((await database.query("SELECT * FROM canvas_projects WHERE id='team-a-project'")).rows.length, 0);
            assert.equal((await database.query("UPDATE canvas_projects SET title='越权修改' WHERE id='team-a-project' RETURNING id")).rows.length, 0);
            await assert.rejects(database.exec("INSERT INTO assets(id,user_id,kind,title,asset_data,team_id) VALUES ('cross-team-asset',1001,'image','越权资产','{}',101)"), /row-level security/);
            assert.equal((await database.query("SELECT config_data FROM user_configs")).rows[0].config_data, "团队乙配置");
        });
        await context.test("平台资源必须显式授权且无法由团队修改", async () => {
            await database.exec("SET novanova.team_id = '101'");
            assert.equal((await database.query("SELECT * FROM platform_ai_model_configs WHERE model_config_id='test-platform-model'")).rows.length, 0);
            await database.exec("INSERT INTO team_resource_grants(team_id,resource_type,resource_id) VALUES(101,'model','test-platform-model')");
            assert.equal((await database.query("SELECT * FROM platform_ai_model_configs WHERE model_config_id='test-platform-model'")).rows.length, 1);
            assert.equal((await database.query("SELECT * FROM platform_ai_channels WHERE channel_id='test-platform-channel'")).rows.length, 1);
            assert.equal((await database.query("UPDATE platform_ai_model_configs SET credit_cost=1 WHERE model_config_id='test-platform-model' RETURNING id")).rows.length, 0);
            await database.exec("SET novanova.team_id = '102'");
            assert.equal((await database.query("SELECT * FROM platform_ai_model_configs WHERE model_config_id='test-platform-model'")).rows.length, 0);
        });
        await context.test("授权模型的专项价格只读开放且禁止团队覆盖", async () => {
            await database.exec(`RESET ROLE; SET novanova.team_id='0';
                INSERT INTO episode_bodies_pricing(model_config_id,credits) VALUES('test-platform-model',0.000001);
                SET ROLE novanova_pro_runtime; SET novanova.team_id='101';`);
            assert.equal((await database.query("SELECT credits::TEXT amount FROM episode_bodies_pricing WHERE model_config_id='test-platform-model'")).rows[0].amount, "0.000001");
            assert.equal((await database.query("UPDATE episode_bodies_pricing SET credits=10 WHERE model_config_id='test-platform-model' RETURNING model_config_id")).rows.length, 0);
            await assert.rejects(database.exec("INSERT INTO story_bible_pricing(model_config_id,tiers) VALUES('test-platform-model','[]')"), /自有模型/);
            await database.exec("SET novanova.team_id='102'");
            assert.equal((await database.query("SELECT * FROM episode_bodies_pricing WHERE model_config_id='test-platform-model'")).rows.length, 0);
        });
        await context.test("成员名额包含禁用成员，移除释放名额且禁止重新写入内容", async () => {
            await database.exec(`RESET ROLE; SET novanova.team_id='102';
                INSERT INTO users(id,username,email,invitation_code) VALUES (1002,'team-test-2','team2@example.com','TEAMTEST02'),(1003,'team-test-3','team3@example.com','TEAMTEST03');
                UPDATE teams SET member_limit=1 WHERE id=102;`);
            await assert.rejects(database.exec("INSERT INTO team_members(team_id,user_id,member_role) VALUES(102,1002,'member')"), /达到上限/);
            await database.exec("UPDATE team_members SET member_status='disabled' WHERE team_id=102 AND user_id=1001");
            await assert.rejects(database.exec("INSERT INTO team_members(team_id,user_id,member_role) VALUES(102,1002,'member')"), /达到上限/);
            await database.exec("UPDATE team_members SET member_status='removed' WHERE team_id=102 AND user_id=1001; INSERT INTO team_members(team_id,user_id,member_role) VALUES(102,1002,'member'); SET ROLE novanova_pro_runtime;");
            await assert.rejects(database.exec("INSERT INTO canvas_projects(id,user_id,title,project_data) VALUES('removed-project',1001,'不能新增','{}')"), /成员已停用/);
            await database.exec("RESET ROLE; UPDATE team_members SET member_status='removed' WHERE team_id=102 AND user_id=1002; UPDATE team_members SET member_status='active' WHERE team_id=102 AND user_id=1001; SET ROLE novanova_pro_runtime");
        });
        await context.test("后台任务固定创建时的存储及模型提供方", async () => {
            await database.exec(`SET novanova.team_id='101'; INSERT INTO team_resource_grants(team_id,resource_type,resource_id) VALUES(101,'objectStorage','test-storage');
                INSERT INTO team_resource_preferences(team_id,resource_type,resource_id,enabled,is_default) VALUES(101,'objectStorage','test-storage',true,true);
                INSERT INTO ai_generation_tasks(id,user_id,task_type,model,provider,model_config_id,status,request_data,result_data) VALUES('team-snapshot-task',1001,'image','platform-model','测试渠道','test-platform-model','pending','{}','{}');
                UPDATE team_resource_preferences SET is_default=false WHERE team_id=101 AND resource_type='objectStorage';`);
            assert.deepEqual((await database.query("SELECT storage_id_snapshot,resource_owner_team_id FROM ai_generation_tasks WHERE id='team-snapshot-task'")).rows, [{storage_id_snapshot:'test-storage',resource_owner_team_id:0}]);
        });
        await context.test("撤销资源授权后排队任务被识别并保留原账本关联", async () => {
            const source = await readFile(new URL("../../../../server/src/main/java/com/novanovastudio/task/TeamMemberCleanupScheduler.java", import.meta.url), "utf8");
            const query = source.match(/private Mono<Void> cancelRevokedResourceTasks\(\) \{\s*return repository\.query\("""([\s\S]*?)"""/)[1];
            await database.exec("RESET ROLE; SET novanova.system_access='true'");
            await database.query(query);
            await database.exec("DELETE FROM team_resource_grants WHERE team_id=101 AND resource_type='model' AND resource_id='test-platform-model'");
            assert.ok((await database.query(query)).rows.some((task) => task.id === 'team-snapshot-task'));
            await database.exec("INSERT INTO team_resource_grants(team_id,resource_type,resource_id) VALUES(101,'model','test-platform-model'); SET ROLE novanova_pro_runtime; SET novanova.system_access='false'");
        });
        await context.test("平台钱包跨团队通用，其他团队钱包不可见", async () => {
            await database.exec("SET novanova.team_id = '101'");
            const wallets = (await database.query("SELECT team_id,credit_balance::TEXT amount FROM user_credit_accounts WHERE user_id=1001 ORDER BY team_id")).rows;
            assert.deepEqual(wallets, [{ team_id: 0, amount: "12.123456" }, { team_id: 101, amount: "34.000001" }]);
            await database.exec("SET novanova.team_id = '102'");
            assert.equal((await database.query("SELECT credit_balance::TEXT amount FROM user_credit_accounts WHERE user_id=1001 AND team_id=0")).rows[0].amount, "12.123456");
        });
        await context.test("独立空配置不混入全局内容，切回继承保留团队内容", async () => {
            await database.exec("SET novanova.team_id = '101'");
            const inherited = (await database.query("SELECT COUNT(*)::INT amount FROM prompt_library")).rows[0].amount;
            assert.ok(inherited > 0);
            await database.exec("INSERT INTO team_configuration_modes(team_id,module_name,inherit_global) VALUES(101,'prompts',false)");
            assert.equal((await database.query("SELECT COUNT(*)::INT amount FROM prompt_library")).rows[0].amount, 0);
            await database.exec("UPDATE team_configuration_modes SET inherit_global=true WHERE team_id=101 AND module_name='prompts'");
            assert.equal((await database.query("SELECT COUNT(*)::INT amount FROM prompt_library")).rows[0].amount, inherited);
        });
        await context.test("按实际时长计费、禁用半月免收、重复补结不重复出账", async () => {
            await database.exec(`RESET ROLE; SET novanova.system_access='true';
                WITH period AS (SELECT (DATE_TRUNC('month',CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')-INTERVAL '1 month') AT TIME ZONE 'Asia/Shanghai' starts, DATE_TRUNC('month',CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai' ends)
                INSERT INTO storage_billing_rates(storage_id,effective_at,credits_per_gigabyte_month) SELECT 'test-storage',starts,30 FROM period;
                INSERT INTO storage_objects(team_id,user_id,storage_id,owner_team_id,object_key,file_bytes,stored_at) SELECT 101,1001,'test-storage',0,'test-full-month',1000000000,effective_at FROM storage_billing_rates WHERE storage_id='test-storage';
                WITH period AS (SELECT effective_at starts,DATE_TRUNC('month',CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai' ends FROM storage_billing_rates WHERE storage_id='test-storage')
                INSERT INTO team_disabled_periods(team_id,disabled_at,restored_at) SELECT 101,starts+(ends-starts)/2,ends FROM period;
            `);
            const source = await readFile(new URL("../../../../server/src/main/java/com/novanovastudio/repository/StorageBillingRepository.java", import.meta.url), "utf8");
            const statement = source.match(/public Mono<Long> createMonthlyBills\(\) \{\s*return databaseClient\.sql\("""([\s\S]*?)"""\)/)[1];
            await database.exec(statement);
            const bills = (await database.query("SELECT credits::TEXT credits,bill_status FROM storage_bills WHERE user_id=1001")).rows;
            assert.deepEqual(bills, [{ credits: "15.000000", bill_status: "unpaid" }]);
            await database.exec(statement);
            assert.equal((await database.query("SELECT COUNT(*)::INT amount FROM storage_bills WHERE user_id=1001")).rows[0].amount, 1);
        });
        await context.test("欠费严格按旧账单优先，冻结钱包仅允许退款及历史结算", async () => {
            const storageSource = await readFile(new URL("../../../../server/src/main/java/com/novanovastudio/repository/StorageBillingRepository.java", import.meta.url), "utf8");
            const creditSource = await readFile(new URL("../../../../server/src/main/java/com/novanovastudio/repository/CreditRepository.java", import.meta.url), "utf8");
            const payableStatement = storageSource.match(/public Mono<Boolean> canPay\(JSONObject bill\) \{\s*return databaseClient\.sql\("""([\s\S]*?)"""\)/)[1];
            const changeStatement = creditSource.match(/public Mono<BigDecimal> changeBalance[\s\S]*?databaseClient\.sql\("""([\s\S]*?)"""\)/)[1];
            const execute = (statement, values) => {
                const keys = [];
                const query = statement.replace(/(?<!:):([a-zA-Z][a-zA-Z0-9]*)/g, (_, key) => {
                    if (!keys.includes(key)) keys.push(key);
                    return `$${keys.indexOf(key) + 1}`;
                });
                return database.query(query, keys.map((key) => values[key]));
            };
            await database.exec("INSERT INTO storage_bills(team_id,user_id,owner_team_id,billing_month,credits,usage_details) VALUES(101,1001,0,DATE_TRUNC('month',CURRENT_TIMESTAMP)::DATE,2,'[]')");
            const bills = (await database.query("SELECT id,billing_month FROM storage_bills WHERE user_id=1001 ORDER BY billing_month,id")).rows;
            const canPay = async (bill, credits) => (await execute(payableStatement, { user:1001,owner:0,id:bill.id,month:bill.billing_month,credits })).rows[0].payable;
            assert.equal(await canPay(bills[0],15),false);
            assert.equal(await canPay(bills[1],2),false);
            await execute(changeStatement,{userId:1001,walletTeamId:0,changeAmount:'20.000001',historical:false});
            assert.equal(await canPay(bills[0],15),true);
            await execute(changeStatement,{userId:1001,walletTeamId:0,changeAmount:'-15',historical:true});
            await database.query("UPDATE storage_bills SET bill_status='paid' WHERE id=$1",[bills[0].id]);
            assert.equal(await canPay(bills[1],2),true);
            await database.exec("UPDATE user_credit_accounts SET frozen=true WHERE team_id=101 AND user_id=1001");
            assert.equal((await execute(changeStatement,{userId:1001,walletTeamId:101,changeAmount:'-0.000001',historical:false})).rows.length,0);
            assert.equal((await execute(changeStatement,{userId:1001,walletTeamId:101,changeAmount:'-0.000001',historical:true})).rows.length,1);
            assert.equal((await execute(changeStatement,{userId:1001,walletTeamId:101,changeAmount:'0.000001',historical:false})).rows.length,1);
            assert.equal((await database.query("SELECT credit_balance::TEXT amount FROM user_credit_accounts WHERE team_id=101 AND user_id=1001")).rows[0].amount,"34.000001");
        });
    } finally { await database.close(); }
});

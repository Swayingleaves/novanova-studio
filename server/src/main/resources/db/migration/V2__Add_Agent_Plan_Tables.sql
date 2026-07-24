-- ============================================================
-- Agent创作计划与依赖任务
-- ============================================================
CREATE TABLE agent_plan (
    id VARCHAR(64) PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    session_id VARCHAR(64) NOT NULL REFERENCES agent_session(id) ON DELETE CASCADE,
    intent VARCHAR(200) NOT NULL DEFAULT '',
    entry_source VARCHAR(20) NOT NULL,
    summary VARCHAR(1000) NOT NULL DEFAULT '',
    creation_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(30) NOT NULL,
    error_message VARCHAR(1000) NOT NULL DEFAULT '',
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_agent_plan_entry_source CHECK (entry_source IN ('imagePage', 'videoPage', 'canvas')),
    CONSTRAINT ck_agent_plan_status CHECK (status IN ('pending', 'running', 'success', 'partial_failed', 'failed', 'canceled'))
);

COMMENT ON TABLE agent_plan IS '主Agent创作计划表';
COMMENT ON COLUMN agent_plan.id IS '计划ID';
COMMENT ON COLUMN agent_plan.user_id IS '所属用户ID';
COMMENT ON COLUMN agent_plan.session_id IS '所属Agent会话ID';
COMMENT ON COLUMN agent_plan.intent IS '主Agent识别的用户意图';
COMMENT ON COLUMN agent_plan.entry_source IS '入口来源：imagePage、videoPage、canvas';
COMMENT ON COLUMN agent_plan.summary IS '向用户展示的计划摘要';
COMMENT ON COLUMN agent_plan.creation_settings IS '页面提交的生成硬约束JSON';
COMMENT ON COLUMN agent_plan.status IS '计划状态';
COMMENT ON COLUMN agent_plan.error_message IS '计划失败或部分失败说明';
COMMENT ON COLUMN agent_plan.completed_at IS '计划完成时间';
COMMENT ON COLUMN agent_plan.created_at IS '创建时间';
COMMENT ON COLUMN agent_plan.updated_at IS '更新时间';

CREATE INDEX idx_agent_plan_user_created ON agent_plan(user_id, created_at DESC);
CREATE INDEX idx_agent_plan_session ON agent_plan(session_id, created_at DESC);

CREATE TABLE agent_plan_task (
    plan_id VARCHAR(64) NOT NULL REFERENCES agent_plan(id) ON DELETE CASCADE,
    task_id VARCHAR(64) NOT NULL,
    task_type VARCHAR(20) NOT NULL,
    action VARCHAR(20) NOT NULL,
    original_prompt TEXT NOT NULL,
    dependencies JSONB NOT NULL DEFAULT '[]'::jsonb,
    tool_name VARCHAR(100) NOT NULL DEFAULT '',
    tool_arguments JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(30) NOT NULL,
    prompt_strategy VARCHAR(20) NOT NULL DEFAULT '',
    final_prompt TEXT NOT NULL DEFAULT '',
    result_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message VARCHAR(1000) NOT NULL DEFAULT '',
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (plan_id, task_id),
    CONSTRAINT ck_agent_plan_task_type CHECK (task_type IN ('image', 'video', 'canvas')),
    CONSTRAINT ck_agent_plan_task_action CHECK (action IN ('generate', 'edit', 'tool')),
    CONSTRAINT ck_agent_plan_task_status CHECK (status IN ('pending', 'running', 'success', 'failed', 'skipped', 'canceled')),
    CONSTRAINT ck_agent_plan_task_prompt_strategy CHECK (prompt_strategy IN ('', 'KEEP', 'OPTIMIZE'))
);

COMMENT ON TABLE agent_plan_task IS '主Agent计划任务及依赖执行结果表';
COMMENT ON COLUMN agent_plan_task.plan_id IS '所属计划ID';
COMMENT ON COLUMN agent_plan_task.task_id IS '计划内任务ID';
COMMENT ON COLUMN agent_plan_task.task_type IS '任务类型：image、video或canvas';
COMMENT ON COLUMN agent_plan_task.action IS '任务动作：generate、edit或tool';
COMMENT ON COLUMN agent_plan_task.original_prompt IS '用户原始提示词';
COMMENT ON COLUMN agent_plan_task.dependencies IS '依赖任务ID数组';
COMMENT ON COLUMN agent_plan_task.tool_name IS '画布入口使用的Java注册工具名';
COMMENT ON COLUMN agent_plan_task.tool_arguments IS '通过Java注册Schema校验的画布工具参数';
COMMENT ON COLUMN agent_plan_task.status IS '计划任务状态';
COMMENT ON COLUMN agent_plan_task.prompt_strategy IS '提示词策略：KEEP或OPTIMIZE';
COMMENT ON COLUMN agent_plan_task.final_prompt IS '通过最终合规检查的提示词';
COMMENT ON COLUMN agent_plan_task.result_data IS '结构化执行结果JSON';
COMMENT ON COLUMN agent_plan_task.error_message IS '失败或跳过原因';
COMMENT ON COLUMN agent_plan_task.started_at IS '开始执行时间';
COMMENT ON COLUMN agent_plan_task.completed_at IS '完成时间';
COMMENT ON COLUMN agent_plan_task.created_at IS '创建时间';
COMMENT ON COLUMN agent_plan_task.updated_at IS '更新时间';

CREATE INDEX idx_agent_plan_task_status ON agent_plan_task(plan_id, status, created_at);

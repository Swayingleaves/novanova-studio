-- 视频技能工作流上下文与任务角色
ALTER TABLE agent_plan ADD COLUMN workflow_type VARCHAR(100) NOT NULL DEFAULT '';
COMMENT ON COLUMN agent_plan.workflow_type IS '服务端注册的视频工作流类型，空值表示普通计划';

ALTER TABLE agent_plan_task ADD COLUMN task_role VARCHAR(100) NOT NULL DEFAULT '';
COMMENT ON COLUMN agent_plan_task.task_role IS '工作流任务业务角色，由工作流定义解释';

CREATE TABLE video_workflow_context (
    id VARCHAR(64) PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    session_id VARCHAR(64) NOT NULL REFERENCES agent_session(id) ON DELETE CASCADE,
    workflow_type VARCHAR(100) NOT NULL,
    skill_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    original_request TEXT NOT NULL,
    clarification_question TEXT NOT NULL DEFAULT '',
    answers JSONB NOT NULL DEFAULT '[]'::jsonb,
    creation_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(30) NOT NULL,
    context_version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_video_workflow_context_status CHECK (status IN ('clarifying', 'planned', 'completed', 'failed', 'canceled'))
);

COMMENT ON TABLE video_workflow_context IS '视频技能工作流澄清与恢复上下文表';
COMMENT ON COLUMN video_workflow_context.id IS '工作流上下文ID';
COMMENT ON COLUMN video_workflow_context.user_id IS '所属用户ID';
COMMENT ON COLUMN video_workflow_context.session_id IS '所属Agent会话ID';
COMMENT ON COLUMN video_workflow_context.workflow_type IS '服务端注册的工作流类型';
COMMENT ON COLUMN video_workflow_context.skill_snapshot IS '触发工作流的技能快照';
COMMENT ON COLUMN video_workflow_context.original_request IS '首轮用户原始需求';
COMMENT ON COLUMN video_workflow_context.clarification_question IS '当前澄清问题';
COMMENT ON COLUMN video_workflow_context.answers IS '已收集的用户回答';
COMMENT ON COLUMN video_workflow_context.creation_settings IS '页面生成设置快照';
COMMENT ON COLUMN video_workflow_context.status IS '工作流上下文状态';
COMMENT ON COLUMN video_workflow_context.context_version IS '上下文版本号';
COMMENT ON COLUMN video_workflow_context.created_at IS '创建时间';
COMMENT ON COLUMN video_workflow_context.updated_at IS '更新时间';

CREATE INDEX idx_video_workflow_context_session_status ON video_workflow_context(session_id, status, updated_at DESC);

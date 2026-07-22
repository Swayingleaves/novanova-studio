-- V6__agent_session.sql
-- Agent 画布对话会话表
CREATE TABLE agent_session (
    id          VARCHAR(64) PRIMARY KEY,                          -- 会话ID
    user_id     BIGINT NOT NULL,                                  -- 用户ID
    title       VARCHAR(200) DEFAULT '',                          -- 会话标题
    messages    JSONB DEFAULT '[]',                               -- 消息列表 [{ id, role, text, meta }]
    created_at  TIMESTAMPTZ DEFAULT NOW(),                        -- 创建时间
    updated_at  TIMESTAMPTZ DEFAULT NOW()                         -- 更新时间
);

COMMENT ON TABLE agent_session IS 'Agent 画布对话会话';
COMMENT ON COLUMN agent_session.id IS '会话ID';
COMMENT ON COLUMN agent_session.user_id IS '用户ID';
COMMENT ON COLUMN agent_session.title IS '会话标题';
COMMENT ON COLUMN agent_session.messages IS '消息列表';
COMMENT ON COLUMN agent_session.created_at IS '创建时间';
COMMENT ON COLUMN agent_session.updated_at IS '更新时间';

CREATE INDEX idx_agent_session_user ON agent_session(user_id, updated_at DESC);

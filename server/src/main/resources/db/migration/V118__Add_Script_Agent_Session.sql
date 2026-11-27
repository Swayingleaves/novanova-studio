-- 为剧本项目增加AI剧本助手对话会话标识，复用 agent_session 持久化多轮编剧对话

ALTER TABLE script_projects
    ADD COLUMN IF NOT EXISTS agent_session_id VARCHAR(64);

COMMENT ON COLUMN script_projects.agent_session_id IS '剧本工作台绑定的AI剧本助手会话ID';

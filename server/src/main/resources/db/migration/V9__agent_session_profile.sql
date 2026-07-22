-- 新增 profile 字段区分会话类型（canvas / generation），默认 canvas 兼容已有数据
ALTER TABLE agent_session ADD COLUMN IF NOT EXISTS profile VARCHAR(32) NOT NULL DEFAULT 'canvas';

COMMENT ON TABLE agent_session IS 'Agent 会话，profile=canvas|generation 区分会话类型';

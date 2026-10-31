-- 剧本 AI 助手动作定价：一次动作一次模型调用，按「文本模型 × 动作」配置每次积分。
-- 此前单价直接取模型自身的 creditCost，管理员无法把「润色一段」和「生成整集」分成两个价。
CREATE TABLE script_ai_action_pricing (
    model_config_id VARCHAR(64) NOT NULL REFERENCES platform_ai_model_configs(model_config_id) ON DELETE CASCADE,
    action_type     VARCHAR(48) NOT NULL,
    credits         NUMERIC(24,6) NOT NULL CHECK (credits >= 0),
    revision        BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
    team_id         BIGINT NOT NULL DEFAULT current_team_id() REFERENCES teams(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (model_config_id, action_type)
);
COMMENT ON TABLE script_ai_action_pricing IS '剧本AI助手动作定价：按文本模型配置每个动作每次调用的积分，未配置的动作不允许发起';
COMMENT ON COLUMN script_ai_action_pricing.model_config_id IS '文本模型配置标识';
COMMENT ON COLUMN script_ai_action_pricing.action_type IS '助手动作标识，取值由服务端动作目录约束';
COMMENT ON COLUMN script_ai_action_pricing.credits IS '该动作每次调用的积分，零表示明确免费，最多六位小数';
COMMENT ON COLUMN script_ai_action_pricing.revision IS '整模型价格修订号，同一模型所有动作共享同一值';
COMMENT ON COLUMN script_ai_action_pricing.team_id IS '价格所属空间，必须与模型所属空间一致，零表示平台';
COMMENT ON COLUMN script_ai_action_pricing.created_at IS '创建时间';
COMMENT ON COLUMN script_ai_action_pricing.updated_at IS '最后更新时间';
CREATE INDEX idx_script_ai_action_pricing_team_id ON script_ai_action_pricing(team_id);
ALTER TABLE script_ai_action_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE script_ai_action_pricing FORCE ROW LEVEL SECURITY;
CREATE POLICY team_isolation ON script_ai_action_pricing
    USING (team_system_access() OR team_id = current_team_id())
    WITH CHECK (team_system_access() OR team_id = current_team_id());
CREATE POLICY granted_script_ai_action_pricing ON script_ai_action_pricing FOR SELECT USING (
    team_id = 0 AND EXISTS (SELECT 1 FROM platform_ai_model_configs models
        WHERE models.model_config_id = script_ai_action_pricing.model_config_id));
CREATE TRIGGER check_pricing_owner BEFORE INSERT OR UPDATE ON script_ai_action_pricing
    FOR EACH ROW EXECUTE FUNCTION check_pricing_owner();

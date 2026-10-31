CREATE TABLE comic_drama_final_prompt_pricing (
    model_config_id VARCHAR(64) PRIMARY KEY REFERENCES platform_ai_model_configs(model_config_id) ON DELETE CASCADE,
    credits NUMERIC(24,6) NOT NULL CHECK (credits >= 0),
    revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
    team_id BIGINT NOT NULL DEFAULT current_team_id() REFERENCES teams(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE comic_drama_final_prompt_pricing IS '漫剧生成最终提示词按文本模型配置的每镜头积分，未配置不允许生成';
COMMENT ON COLUMN comic_drama_final_prompt_pricing.model_config_id IS '文本模型配置标识';
COMMENT ON COLUMN comic_drama_final_prompt_pricing.credits IS '每镜头积分，零表示明确免费，最多六位小数';
COMMENT ON COLUMN comic_drama_final_prompt_pricing.revision IS '价格修订号，用于并发保存与生成前价格确认';
COMMENT ON COLUMN comic_drama_final_prompt_pricing.team_id IS '价格所属空间，必须与模型所属空间一致，零表示平台';
COMMENT ON COLUMN comic_drama_final_prompt_pricing.created_at IS '创建时间';
COMMENT ON COLUMN comic_drama_final_prompt_pricing.updated_at IS '最后更新时间';
CREATE INDEX idx_comic_drama_final_prompt_pricing_team_id ON comic_drama_final_prompt_pricing(team_id);
ALTER TABLE comic_drama_final_prompt_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE comic_drama_final_prompt_pricing FORCE ROW LEVEL SECURITY;
CREATE POLICY team_isolation ON comic_drama_final_prompt_pricing
    USING (team_system_access() OR team_id = current_team_id())
    WITH CHECK (team_system_access() OR team_id = current_team_id());
CREATE POLICY granted_comic_drama_final_prompt_pricing ON comic_drama_final_prompt_pricing FOR SELECT USING (
    team_id = 0 AND EXISTS (SELECT 1 FROM platform_ai_model_configs models
        WHERE models.model_config_id = comic_drama_final_prompt_pricing.model_config_id));
CREATE TRIGGER check_pricing_owner BEFORE INSERT OR UPDATE ON comic_drama_final_prompt_pricing
    FOR EACH ROW EXECUTE FUNCTION check_pricing_owner();

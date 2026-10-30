-- 分集正文生成的定价：一集一次模型调用，所以按文本模型配置「每集积分」。
-- 此前单价直接取模型自身的 creditCost，管理员无法针对这一步单独定价。
CREATE TABLE episode_bodies_pricing (
    model_config_id VARCHAR(64) NOT NULL,
    credits         INTEGER     NOT NULL,
    revision        BIGINT      NOT NULL DEFAULT 0,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE episode_bodies_pricing ADD CONSTRAINT episode_bodies_pricing_pkey PRIMARY KEY (model_config_id);

ALTER TABLE episode_bodies_pricing ADD CONSTRAINT ck_episode_bodies_pricing_credits CHECK (credits >= 0);

ALTER TABLE episode_bodies_pricing ADD CONSTRAINT episode_bodies_pricing_model_config_id_fkey
    FOREIGN KEY (model_config_id) REFERENCES platform_ai_model_configs(model_config_id) ON DELETE CASCADE;

COMMENT ON TABLE episode_bodies_pricing IS '分集正文生成定价：按文本模型配置每生成一集的积分';
COMMENT ON COLUMN episode_bodies_pricing.model_config_id IS '文本模型配置标识';
COMMENT ON COLUMN episode_bodies_pricing.credits IS '生成一集正文的积分';
COMMENT ON COLUMN episode_bodies_pricing.revision IS '乐观锁修订号，每次保存递增';
COMMENT ON COLUMN episode_bodies_pricing.created_at IS '创建时间';
COMMENT ON COLUMN episode_bodies_pricing.updated_at IS '更新时间';

ALTER TABLE skills
    ADD COLUMN category VARCHAR(32),
    ADD COLUMN subtitle VARCHAR(200) NOT NULL DEFAULT '',
    ADD COLUMN audience TEXT NOT NULL DEFAULT '',
    ADD COLUMN usage_steps TEXT NOT NULL DEFAULT '[]',
    ADD COLUMN owner_user_id BIGINT,
    ADD COLUMN review_status VARCHAR(20) NOT NULL DEFAULT 'published',
    ADD COLUMN reject_reason TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN skills.category IS '市场分类：image图片，video视频，ecommerce电商，portrait人像，viralReplica爆款复刻；画布设定图为空';
COMMENT ON COLUMN skills.subtitle IS '一句话介绍';
COMMENT ON COLUMN skills.audience IS '适合人群';
COMMENT ON COLUMN skills.usage_steps IS '使用步骤JSON，最多三步，每步包含title和detail';
COMMENT ON COLUMN skills.owner_user_id IS '作者用户ID，空表示官方技能';
COMMENT ON COLUMN skills.review_status IS '审核状态：private未发布，pending审核中，published已发布，rejected已驳回';
COMMENT ON COLUMN skills.reject_reason IS '审核驳回原因';

ALTER TABLE skills
    ADD CONSTRAINT ck_skills_category CHECK (category IS NULL OR category IN ('image', 'video', 'ecommerce', 'portrait', 'viralReplica')),
    ADD CONSTRAINT ck_skills_review_status CHECK (review_status IN ('private', 'pending', 'published', 'rejected')),
    ADD CONSTRAINT fk_skills_owner_user FOREIGN KEY (owner_user_id) REFERENCES users(id);

UPDATE skills
SET category = 'ecommerce'
WHERE name = '电商商品图片制作' AND target_type = 'image' AND deleted_at IS NULL AND category IS NULL;

CREATE INDEX idx_skills_market
    ON skills(category, sort_order, id)
    WHERE deleted_at IS NULL AND status = 1 AND review_status = 'published' AND category IS NOT NULL;
CREATE INDEX idx_skills_owner
    ON skills(owner_user_id, updated_at DESC, id)
    WHERE deleted_at IS NULL AND owner_user_id IS NOT NULL;

CREATE TABLE skill_favorites (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    skill_id BIGINT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, skill_id)
);

COMMENT ON TABLE skill_favorites IS '技能收藏';
COMMENT ON COLUMN skill_favorites.user_id IS '收藏用户ID';
COMMENT ON COLUMN skill_favorites.skill_id IS '技能ID';
COMMENT ON COLUMN skill_favorites.created_at IS '收藏时间';

CREATE INDEX idx_skill_favorites_skill
    ON skill_favorites(skill_id);

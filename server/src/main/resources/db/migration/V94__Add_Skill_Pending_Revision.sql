ALTER TABLE skills
    ADD COLUMN pending_revision TEXT,
    ADD COLUMN revision_status VARCHAR(32) NOT NULL DEFAULT '',
    ADD COLUMN revision_reject_reason VARCHAR(500) NOT NULL DEFAULT '';

COMMENT ON COLUMN skills.pending_revision IS '已发布技能的待审核更新，JSON。审核通过前不覆盖线上内容';
COMMENT ON COLUMN skills.revision_status IS '更新审核状态：空表示没有待更新，pending 审核中，rejected 已驳回';
COMMENT ON COLUMN skills.revision_reject_reason IS '更新被驳回的原因。不影响已发布版本';

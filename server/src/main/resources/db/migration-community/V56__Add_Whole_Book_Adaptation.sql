-- 全书改编保留旧任务记录，新工作流使用独立策略及生成单元。
ALTER TABLE novel_adaptation_jobs DROP CONSTRAINT ck_novel_adaptation_job_phase;
ALTER TABLE novel_adaptation_jobs ADD CONSTRAINT ck_novel_adaptation_job_phase
    CHECK (phase IN ('skeleton','episodes','drafts','materials','planning'));
ALTER TABLE novel_adaptation_jobs DROP CONSTRAINT ck_novel_adaptation_job_stage;
ALTER TABLE novel_adaptation_jobs ADD CONSTRAINT ck_novel_adaptation_job_stage
    CHECK (stage IN ('overview','characters','world','outline','episodes','episode','done',
                    'material','summary','strategy','locations','relations','assignment','episodePlan'));

CREATE TABLE novel_adaptation_workflows (
    job_id VARCHAR(64) PRIMARY KEY REFERENCES novel_adaptation_jobs(id) ON DELETE CASCADE,
    base_revision BIGINT NOT NULL,
    fact_snapshot JSONB NOT NULL,
    link_snapshot JSONB NOT NULL,
    entity_mapping JSONB NOT NULL,
    strategy JSONB,
    episode_slots JSONB NOT NULL DEFAULT '[]'::jsonb,
    unit_price INTEGER NOT NULL CHECK (unit_price >= 0)
);
COMMENT ON TABLE novel_adaptation_workflows IS '全书改编的输入事实快照、统一策略与固定分集';
COMMENT ON COLUMN novel_adaptation_workflows.job_id IS '复用的一键改编任务标识';
COMMENT ON COLUMN novel_adaptation_workflows.base_revision IS '当前生成阶段的正式剧本基线修订';
COMMENT ON COLUMN novel_adaptation_workflows.fact_snapshot IS '全部选定且已确认事实的不可变快照';
COMMENT ON COLUMN novel_adaptation_workflows.link_snapshot IS '启动时事实间的关联快照';
COMMENT ON COLUMN novel_adaptation_workflows.entity_mapping IS '人物及地点事实标识到正式条目标识的固定映射';
COMMENT ON COLUMN novel_adaptation_workflows.strategy IS '全书统一策略，包含主线、结局及各阶段建议集数';
COMMENT ON COLUMN novel_adaptation_workflows.episode_slots IS '人工确认集数后固定的分集标识、集号与故事阶段';
COMMENT ON COLUMN novel_adaptation_workflows.unit_price IS '任务启动时确认的单次文本模型积分单价';

CREATE TABLE novel_adaptation_units (
    job_id VARCHAR(64) NOT NULL REFERENCES novel_adaptation_workflows(job_id) ON DELETE CASCADE,
    unit_key VARCHAR(100) NOT NULL,
    phase VARCHAR(16) NOT NULL,
    stage VARCHAR(16) NOT NULL,
    sequence INTEGER NOT NULL,
    input_snapshot JSONB NOT NULL,
    output_snapshot JSONB,
    draft_id VARCHAR(64) REFERENCES script_ai_drafts(id),
    charge_id VARCHAR(150) NOT NULL,
    completed_at TIMESTAMPTZ,
    PRIMARY KEY (job_id, unit_key)
);
COMMENT ON TABLE novel_adaptation_units IS '全书改编的持久化生成单元，成功输出为恢复及结算依据';
COMMENT ON COLUMN novel_adaptation_units.job_id IS '所属全书改编任务';
COMMENT ON COLUMN novel_adaptation_units.unit_key IS '阶段及固定目标组成的稳定生成身份';
COMMENT ON COLUMN novel_adaptation_units.phase IS '素材与策略、统一规划或正文阶段';
COMMENT ON COLUMN novel_adaptation_units.stage IS '单次调用类型';
COMMENT ON COLUMN novel_adaptation_units.sequence IS '持久化执行顺序';
COMMENT ON COLUMN novel_adaptation_units.input_snapshot IS '事实范围、汇总子节点或固定分集等输入边界';
COMMENT ON COLUMN novel_adaptation_units.output_snapshot IS '已校验输出，空值表示尚未成功';
COMMENT ON COLUMN novel_adaptation_units.draft_id IS '对应的正式剧本待审草稿，素材单元为空';
COMMENT ON COLUMN novel_adaptation_units.charge_id IS '本次预扣操作身份，续跑仅重新分配未完成单元';
COMMENT ON COLUMN novel_adaptation_units.completed_at IS '成功持久化时间';
CREATE INDEX idx_novel_adaptation_units_progress ON novel_adaptation_units(job_id,phase,sequence);
CREATE INDEX idx_novel_adaptation_units_charge ON novel_adaptation_units(job_id,charge_id);

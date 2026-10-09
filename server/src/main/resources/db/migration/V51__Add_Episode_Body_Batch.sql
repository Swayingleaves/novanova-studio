-- 逐集正文批量生成：复用全书改编任务与生成单元，新增 drafts 与 bodies 两个阶段取值。
ALTER TABLE novel_adaptation_jobs DROP CONSTRAINT ck_novel_adaptation_job_phase;
ALTER TABLE novel_adaptation_jobs ADD CONSTRAINT ck_novel_adaptation_job_phase
    CHECK (phase IN ('skeleton','episodes','drafts','bodies','materials','planning'));
ALTER TABLE novel_adaptation_jobs DROP CONSTRAINT ck_novel_adaptation_job_stage;
ALTER TABLE novel_adaptation_jobs ADD CONSTRAINT ck_novel_adaptation_job_stage
    CHECK (stage IN ('overview','characters','world','outline','episodes','episode','done',
                    'material','summary','strategy','locations','relations','assignment','episodePlan',
                    'draft','body'));

ALTER TABLE novel_adaptation_workflows
    ADD COLUMN episode_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN novel_adaptation_workflows.episode_ids IS '逐集正文批量的目标分集标识，顺序即生成顺序；空表示该任务不属于正文批量';

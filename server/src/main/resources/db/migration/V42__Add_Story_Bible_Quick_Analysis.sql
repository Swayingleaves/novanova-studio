ALTER TABLE story_bible_pricing ADD COLUMN quick_configuration JSONB;
COMMENT ON COLUMN story_bible_pricing.quick_configuration IS '管理员验证的快速分析容量、输出上限、每批章节片段上限与最多补分析调用次数；空值禁用快速模式';

ALTER TABLE story_bible_analysis_jobs ADD COLUMN analysis_mode VARCHAR(16) NOT NULL DEFAULT 'detailed';
ALTER TABLE story_bible_analysis_jobs ADD COLUMN quick_configuration JSONB;
ALTER TABLE story_bible_analysis_jobs ADD COLUMN supplement_calls INTEGER NOT NULL DEFAULT 0;
COMMENT ON COLUMN story_bible_analysis_jobs.analysis_mode IS '分析模式：quick快速批量分析、detailed精细分析';
COMMENT ON COLUMN story_bible_analysis_jobs.quick_configuration IS '启动时快速分析配置快照，续跑不受管理员后续修改影响';
COMMENT ON COLUMN story_bible_analysis_jobs.supplement_calls IS '已预留的补分析调用次数，拆批、重试与覆盖缺口补分析共用上限';
ALTER TABLE story_bible_analysis_jobs ADD CONSTRAINT ck_story_bible_job_mode CHECK (analysis_mode IN ('quick','detailed'));
ALTER TABLE story_bible_analysis_jobs ADD CONSTRAINT ck_story_bible_job_supplements CHECK (supplement_calls >= 0);
ALTER TABLE story_bible_analysis_jobs DROP CONSTRAINT ck_story_bible_job_status;
ALTER TABLE story_bible_analysis_jobs ADD CONSTRAINT ck_story_bible_job_status CHECK (status IN ('queued','running','retryable','completed','partial','failed','canceled'));
COMMENT ON COLUMN story_bible_analysis_jobs.status IS '任务状态：排队、运行、可重试、完成、部分完成、最终失败、取消；部分完成保留缺口且不退款';

ALTER TABLE story_bible_analysis_units DROP CONSTRAINT ck_story_bible_unit_type;
ALTER TABLE story_bible_analysis_units ADD CONSTRAINT ck_story_bible_unit_type CHECK (unit_type IN ('segment','chapter','book','batch'));
COMMENT ON COLUMN story_bible_analysis_units.unit_type IS '单元类型：片段提取、章节归并、全书归并、快速分析批次';
COMMENT ON COLUMN story_bible_analysis_units.result IS '结果与覆盖缺口；批次检查点和知识库结果在同一事务中提交';

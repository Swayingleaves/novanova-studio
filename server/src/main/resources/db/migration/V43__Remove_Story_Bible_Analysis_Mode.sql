ALTER TABLE story_bible_analysis_jobs DROP CONSTRAINT ck_story_bible_job_mode;
ALTER TABLE story_bible_analysis_jobs DROP COLUMN analysis_mode;
COMMENT ON COLUMN story_bible_analysis_jobs.quick_configuration IS '启动时分批分析配置快照，续跑不受管理员后续修改影响';

ALTER TABLE story_bible_analysis_units DROP CONSTRAINT ck_story_bible_unit_type;
-- 旧精细分析检查点仅保留历史记录；约束后续写入，不扫描已有片段和章节记录。
ALTER TABLE story_bible_analysis_units ADD CONSTRAINT ck_story_bible_unit_type CHECK (unit_type IN ('batch', 'book')) NOT VALID;
COMMENT ON COLUMN story_bible_analysis_units.unit_type IS '单元类型：分析批次、故事线归纳';

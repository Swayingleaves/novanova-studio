ALTER TABLE story_bible_analysis_jobs ADD COLUMN initial_batch_count INTEGER NOT NULL DEFAULT 0;
COMMENT ON COLUMN story_bible_analysis_jobs.initial_batch_count IS '报价时规划的初始批次数，取消时按成功初始批次比例结算积分';
UPDATE story_bible_analysis_jobs jobs
SET initial_batch_count = (
    SELECT COUNT(*) FROM story_bible_analysis_units units
    WHERE units.job_id = jobs.id AND units.unit_type = 'batch' AND units.unit_key ~ '^batch:[0-9]+$'
)
WHERE jobs.initial_batch_count = 0;
ALTER TABLE story_bible_analysis_jobs ADD CONSTRAINT ck_story_bible_job_initial_batch_count CHECK (initial_batch_count >= 0);

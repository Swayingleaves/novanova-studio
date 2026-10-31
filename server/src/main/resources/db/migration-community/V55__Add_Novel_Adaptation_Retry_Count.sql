-- 每次失败续跑使用独立扣费与退款标识，防止重复请求和重复退款。
ALTER TABLE novel_adaptation_jobs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
COMMENT ON COLUMN novel_adaptation_jobs.retry_count IS '失败续跑次数，零表示首次执行，用于隔离各次预扣与退款流水';
ALTER TABLE novel_adaptation_jobs ADD CONSTRAINT ck_novel_adaptation_job_retry_count CHECK (retry_count >= 0);

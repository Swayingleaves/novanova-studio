ALTER TABLE generation_logs
    ADD COLUMN generation_status VARCHAR(20) NOT NULL DEFAULT 'idle',
    ADD COLUMN generation_completed_at TIMESTAMPTZ,
    ADD COLUMN generation_viewed_at TIMESTAMPTZ;

ALTER TABLE generation_logs
    ADD CONSTRAINT chk_generation_logs_generation_status
        CHECK (generation_status IN ('idle', 'running', 'success', 'failed'));

COMMENT ON COLUMN generation_logs.generation_status IS '生成任务状态：idle空闲、running运行中、success成功、failed失败';
COMMENT ON COLUMN generation_logs.generation_completed_at IS '最近一次生成任务完成时间';
COMMENT ON COLUMN generation_logs.generation_viewed_at IS '用户最近查看记录时间';

ALTER TABLE ai_generation_tasks
    ADD COLUMN provider_request_sent BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN ai_generation_tasks.provider_request_sent IS '图片或视频生成请求是否已经发往供应商。发出后用户取消不退积分';

-- 升级时已经在执行的图片和视频任务视为请求已发出，避免继续按可退款方式取消。
UPDATE ai_generation_tasks
SET provider_request_sent = TRUE
WHERE task_type IN ('image', 'video') AND status = 'running';

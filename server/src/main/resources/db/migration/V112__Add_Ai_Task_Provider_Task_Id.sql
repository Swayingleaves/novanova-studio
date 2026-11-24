-- AI 生成任务新增供应商异步任务ID字段，用于服务重启后恢复轮询上游结果，避免重复提交或永久卡在运行中
ALTER TABLE ai_generation_tasks
    ADD COLUMN IF NOT EXISTS provider_task_id VARCHAR(255) NOT NULL DEFAULT '';

COMMENT ON COLUMN ai_generation_tasks.provider_task_id IS '供应商返回的异步任务ID，用于服务重启后恢复轮询上游结果';

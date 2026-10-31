-- 视频工作流多轮对话与提示词确认
ALTER TABLE video_workflow_context ADD COLUMN drafted_prompts JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN video_workflow_context.drafted_prompts IS '工作流对话助手起草的待确认阶段提示词';

ALTER TABLE video_workflow_context DROP CONSTRAINT ck_video_workflow_context_status;
ALTER TABLE video_workflow_context ADD CONSTRAINT ck_video_workflow_context_status
    CHECK (status IN ('clarifying', 'pending_confirm', 'planned', 'completed', 'failed', 'canceled'));

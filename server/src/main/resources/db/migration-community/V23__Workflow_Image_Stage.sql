-- 视频工作流图片阶段结果与二次确认
-- 新增图片生成结果存储，支持"确认草案→生成图片→确认图片→生成视频"的两阶段流程
ALTER TABLE video_workflow_context ADD COLUMN generated_images JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN video_workflow_context.generated_images IS '图片阶段已生成的首帧/尾帧图片结果（key: first_frame/last_frame，value 含 url/storageKey/mimeType）';

ALTER TABLE video_workflow_context DROP CONSTRAINT ck_video_workflow_context_status;
ALTER TABLE video_workflow_context ADD CONSTRAINT ck_video_workflow_context_status
    CHECK (status IN ('clarifying', 'pending_confirm', 'image_pending_confirm', 'planned', 'completed', 'failed', 'canceled'));

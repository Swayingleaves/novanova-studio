ALTER TABLE video_composition_tasks
    ADD COLUMN task_type VARCHAR(32) NOT NULL DEFAULT 'canvasComposition',
    ADD COLUMN project_id VARCHAR(64),
    ADD COLUMN input_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN video_composition_tasks.task_type IS '任务类型：画布拼接或分镜导出';
COMMENT ON COLUMN video_composition_tasks.project_id IS '分镜导出所属漫剧项目ID';
COMMENT ON COLUMN video_composition_tasks.input_snapshot IS '创建任务时冻结的分镜时间轴与媒体输入';
COMMENT ON TABLE video_composition_tasks IS '画布视频合成及分镜视频导出异步任务表';

CREATE INDEX idx_video_composition_tasks_project_created
    ON video_composition_tasks(user_id, project_id, created_at DESC, id DESC)
    WHERE task_type = 'storyboardExport';

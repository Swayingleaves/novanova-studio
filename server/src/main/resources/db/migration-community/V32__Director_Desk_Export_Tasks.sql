ALTER TABLE video_composition_tasks
    ADD COLUMN task_type VARCHAR(40) NOT NULL DEFAULT 'videoComposition';

COMMENT ON COLUMN video_composition_tasks.task_type IS '视频任务类型：videoComposition普通拼接，directorDeskExport导演台帧序列导出';
COMMENT ON COLUMN video_composition_tasks.status IS '任务状态：preparing准备，pending等待，running执行中，succeeded成功，failed失败，canceled已取消';

CREATE INDEX idx_video_composition_tasks_type_status
    ON video_composition_tasks(task_type, status, created_at, id);

CREATE INDEX idx_video_composition_tasks_director_preparing_user
    ON video_composition_tasks(user_id, updated_at, id)
    WHERE task_type = 'directorDeskExport' AND status = 'preparing';

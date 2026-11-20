UPDATE drama_project SET current_stage = 'preview', updated_at = CURRENT_TIMESTAMP WHERE current_stage = 'audio';
COMMENT ON COLUMN drama_project.current_stage IS '当前等待确认的阶段：plan、script、cast、storyboard、shot、preview';

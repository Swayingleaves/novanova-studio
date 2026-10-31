ALTER TABLE comic_drama_projects
    ADD COLUMN text_track_count INTEGER NOT NULL DEFAULT 1,
    ADD CONSTRAINT ck_comic_drama_projects_text_track_count CHECK (text_track_count BETWEEN 1 AND 3);
COMMENT ON COLUMN comic_drama_projects.text_track_count IS '分镜时间轴文字轨道数量，默认一条且最多三条';

ALTER TABLE comic_drama_timeline_texts
    ADD COLUMN track_number INTEGER NOT NULL DEFAULT 0,
    ADD CONSTRAINT ck_comic_drama_timeline_texts_track_number CHECK (track_number BETWEEN 0 AND 2);
COMMENT ON COLUMN comic_drama_timeline_texts.track_number IS '文字轨道编号，从零开始，零号为不可删除的默认轨道';
CREATE INDEX idx_comic_drama_timeline_texts_project_track_time
    ON comic_drama_timeline_texts(script_project_id, track_number, start_ms, end_ms);

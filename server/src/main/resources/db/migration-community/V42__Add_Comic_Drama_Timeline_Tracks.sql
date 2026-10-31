CREATE TABLE comic_drama_timeline_texts (
    id VARCHAR(64) PRIMARY KEY,
    script_project_id VARCHAR(64) NOT NULL REFERENCES comic_drama_projects(script_project_id) ON DELETE CASCADE,
    content VARCHAR(2000) NOT NULL,
    start_ms BIGINT NOT NULL,
    end_ms BIGINT NOT NULL,
    position_x NUMERIC(6,5) NOT NULL,
    position_y NUMERIC(6,5) NOT NULL,
    font_size INTEGER NOT NULL,
    color VARCHAR(9) NOT NULL,
    alignment VARCHAR(12) NOT NULL,
    background_color VARCHAR(9),
    revision BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_comic_drama_timeline_texts_time CHECK (start_ms >= 0 AND end_ms > start_ms),
    CONSTRAINT ck_comic_drama_timeline_texts_position CHECK (position_x BETWEEN 0 AND 1 AND position_y BETWEEN 0 AND 1),
    CONSTRAINT ck_comic_drama_timeline_texts_font_size CHECK (font_size BETWEEN 12 AND 120),
    CONSTRAINT ck_comic_drama_timeline_texts_alignment CHECK (alignment IN ('left', 'center', 'right'))
);
COMMENT ON TABLE comic_drama_timeline_texts IS '漫剧分镜时间轴文字片段';
COMMENT ON COLUMN comic_drama_timeline_texts.id IS '文字片段稳定标识';
COMMENT ON COLUMN comic_drama_timeline_texts.script_project_id IS '所属漫剧项目标识';
COMMENT ON COLUMN comic_drama_timeline_texts.content IS '预览叠加文字';
COMMENT ON COLUMN comic_drama_timeline_texts.start_ms IS '项目绝对时间轴起点毫秒';
COMMENT ON COLUMN comic_drama_timeline_texts.end_ms IS '项目绝对时间轴终点毫秒';
COMMENT ON COLUMN comic_drama_timeline_texts.position_x IS '画面内水平归一化位置';
COMMENT ON COLUMN comic_drama_timeline_texts.position_y IS '画面内垂直归一化位置';
COMMENT ON COLUMN comic_drama_timeline_texts.font_size IS '基于一千像素画面宽度的字号';
COMMENT ON COLUMN comic_drama_timeline_texts.color IS '文字颜色';
COMMENT ON COLUMN comic_drama_timeline_texts.alignment IS '文字对齐方式';
COMMENT ON COLUMN comic_drama_timeline_texts.background_color IS '可选文字背景颜色';
COMMENT ON COLUMN comic_drama_timeline_texts.revision IS '文字片段乐观锁修订号';
COMMENT ON COLUMN comic_drama_timeline_texts.created_at IS '创建时间';
COMMENT ON COLUMN comic_drama_timeline_texts.updated_at IS '更新时间';
CREATE INDEX idx_comic_drama_timeline_texts_project_time ON comic_drama_timeline_texts(script_project_id, start_ms, id);

ALTER TABLE comic_drama_voice_tracks
    ADD COLUMN audio_storage_key VARCHAR(256),
    ADD COLUMN audio_duration_ms BIGINT,
    ADD COLUMN timeline_start_ms BIGINT,
    ADD COLUMN trim_start_ms BIGINT,
    ADD COLUMN trim_end_ms BIGINT,
    ADD CONSTRAINT ck_comic_drama_voice_tracks_audio_time CHECK (
        (audio_storage_key IS NULL AND audio_duration_ms IS NULL AND timeline_start_ms IS NULL AND trim_start_ms IS NULL AND trim_end_ms IS NULL)
        OR (audio_storage_key IS NOT NULL AND audio_duration_ms > 0 AND
            (timeline_start_ms IS NULL AND trim_start_ms IS NULL AND trim_end_ms IS NULL OR
             timeline_start_ms >= 0 AND trim_start_ms >= 0 AND trim_end_ms > trim_start_ms AND trim_end_ms <= audio_duration_ms))
    );
COMMENT ON COLUMN comic_drama_voice_tracks.audio_storage_key IS '已上传音频的媒体存储标识';
COMMENT ON COLUMN comic_drama_voice_tracks.audio_duration_ms IS '原始音频时长毫秒';
COMMENT ON COLUMN comic_drama_voice_tracks.timeline_start_ms IS '项目绝对时间轴起点毫秒，空表示未排期';
COMMENT ON COLUMN comic_drama_voice_tracks.trim_start_ms IS '源音频裁剪起点毫秒';
COMMENT ON COLUMN comic_drama_voice_tracks.trim_end_ms IS '源音频裁剪终点毫秒';
CREATE INDEX idx_comic_drama_voice_tracks_timeline ON comic_drama_voice_tracks(script_project_id, timeline_start_ms)
    WHERE timeline_start_ms IS NOT NULL;

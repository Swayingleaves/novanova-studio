CREATE TABLE shared_works (
    share_code VARCHAR(64) PRIMARY KEY,
    team_id BIGINT NOT NULL DEFAULT current_team_id(),
    user_id BIGINT NOT NULL REFERENCES users(id),
    request_id VARCHAR(64) NOT NULL,
    source_type VARCHAR(16) NOT NULL CHECK (source_type IN ('generation', 'canvas')),
    source_id TEXT NOT NULL,
    work_type VARCHAR(16) NOT NULL CHECK (work_type IN ('image', 'video', 'canvas')),
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category VARCHAR(50) NOT NULL,
    creator_name VARCHAR(200) NOT NULL,
    snapshot_data JSONB NOT NULL,
    work_status VARCHAR(20) NOT NULL CHECK (work_status IN ('preparing', 'pending', 'published', 'rejected', 'withdrawn', 'takenDown', 'failed')),
    review_reason TEXT NOT NULL DEFAULT '',
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE shared_works IS '用户分享作品及不可变公开内容快照';
COMMENT ON COLUMN shared_works.share_code IS '服务端生成的公开分享标识';
COMMENT ON COLUMN shared_works.team_id IS '发布空间，零为个人空间';
COMMENT ON COLUMN shared_works.user_id IS '投稿用户标识';
COMMENT ON COLUMN shared_works.request_id IS '客户端本次投稿幂等标识';
COMMENT ON COLUMN shared_works.source_type IS '来源类型：生成记录或画布';
COMMENT ON COLUMN shared_works.source_id IS '仅内部使用的来源记录标识';
COMMENT ON COLUMN shared_works.work_type IS '作品类型：图片、视频或完整画布';
COMMENT ON COLUMN shared_works.title IS '作品标题';
COMMENT ON COLUMN shared_works.description IS '作者填写的作品简介';
COMMENT ON COLUMN shared_works.category IS '首页展示分类';
COMMENT ON COLUMN shared_works.creator_name IS '发布时的创作者署名快照';
COMMENT ON COLUMN shared_works.snapshot_data IS '按白名单构造的内容快照，媒体使用分享内标识';
COMMENT ON COLUMN shared_works.work_status IS '准备、待审核、已发布、已驳回、已撤回、已下架或失败';
COMMENT ON COLUMN shared_works.review_reason IS '最近一次审核或下架原因';
COMMENT ON COLUMN shared_works.published_at IS '审核通过时间';
COMMENT ON COLUMN shared_works.created_at IS '创建时间';
COMMENT ON COLUMN shared_works.updated_at IS '最近状态更新时间';
CREATE INDEX idx_shared_works_public ON shared_works(published_at DESC, share_code) WHERE work_status = 'published';
CREATE INDEX idx_shared_works_owner ON shared_works(team_id, user_id, created_at DESC, share_code);
CREATE INDEX idx_shared_works_review ON shared_works(team_id, work_status, created_at DESC, share_code);
CREATE UNIQUE INDEX uk_shared_works_request ON shared_works(team_id, user_id, request_id);

CREATE TABLE shared_work_media (
    share_code VARCHAR(64) NOT NULL REFERENCES shared_works(share_code),
    asset_id VARCHAR(64) NOT NULL,
    storage_id TEXT NOT NULL,
    object_key TEXT NOT NULL,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_bytes BIGINT NOT NULL CHECK (file_bytes >= 0),
    cleaned_at TIMESTAMPTZ,
    PRIMARY KEY (share_code, asset_id),
    UNIQUE (storage_id, object_key)
);
COMMENT ON TABLE shared_work_media IS '分享作品专用私有媒体副本，不复用源对象';
COMMENT ON COLUMN shared_work_media.share_code IS '所属分享标识';
COMMENT ON COLUMN shared_work_media.asset_id IS '本次分享分配的媒体标识';
COMMENT ON COLUMN shared_work_media.storage_id IS '实际上传使用的存储配置，仅内部读取';
COMMENT ON COLUMN shared_work_media.object_key IS '独立私有对象键，仅内部读取';
COMMENT ON COLUMN shared_work_media.file_name IS '媒体文件名';
COMMENT ON COLUMN shared_work_media.mime_type IS '媒体类型';
COMMENT ON COLUMN shared_work_media.file_bytes IS '服务端确认的实际大小';
COMMENT ON COLUMN shared_work_media.cleaned_at IS '已交给存储异步删除队列的时间';

CREATE TABLE shared_work_reviews (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    share_code VARCHAR(64) NOT NULL REFERENCES shared_works(share_code),
    operator_user_id BIGINT NOT NULL REFERENCES users(id),
    previous_status VARCHAR(20) NOT NULL,
    next_status VARCHAR(20) NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE shared_work_reviews IS '作品审核、撤回及下架操作记录';
COMMENT ON COLUMN shared_work_reviews.id IS '操作记录标识';
COMMENT ON COLUMN shared_work_reviews.share_code IS '分享作品标识';
COMMENT ON COLUMN shared_work_reviews.operator_user_id IS '操作人用户标识';
COMMENT ON COLUMN shared_work_reviews.previous_status IS '操作前状态';
COMMENT ON COLUMN shared_work_reviews.next_status IS '操作后状态';
COMMENT ON COLUMN shared_work_reviews.reason IS '操作原因';
COMMENT ON COLUMN shared_work_reviews.created_at IS '操作时间';
CREATE INDEX idx_shared_work_reviews_work ON shared_work_reviews(share_code, id);

ALTER TABLE shared_works ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_works FORCE ROW LEVEL SECURITY;
CREATE POLICY shared_works_read ON shared_works FOR SELECT USING (team_system_access() OR team_id = current_team_id() OR work_status = 'published');
CREATE POLICY shared_works_insert ON shared_works FOR INSERT WITH CHECK (team_id = current_team_id());
CREATE POLICY shared_works_update ON shared_works FOR UPDATE USING (team_system_access() OR team_id = current_team_id()) WITH CHECK (team_system_access() OR team_id = current_team_id());
ALTER TABLE shared_work_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_work_media FORCE ROW LEVEL SECURITY;
CREATE POLICY shared_work_media_read ON shared_work_media FOR SELECT USING (EXISTS (SELECT 1 FROM shared_works WHERE shared_works.share_code = shared_work_media.share_code));
CREATE POLICY shared_work_media_write ON shared_work_media FOR ALL USING (EXISTS (SELECT 1 FROM shared_works WHERE shared_works.share_code = shared_work_media.share_code AND (team_system_access() OR team_id = current_team_id()))) WITH CHECK (EXISTS (SELECT 1 FROM shared_works WHERE shared_works.share_code = shared_work_media.share_code AND (team_system_access() OR team_id = current_team_id())));
ALTER TABLE shared_work_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_work_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY shared_work_reviews_scope ON shared_work_reviews USING (EXISTS (SELECT 1 FROM shared_works WHERE shared_works.share_code = shared_work_reviews.share_code AND (team_system_access() OR team_id = current_team_id())));

CREATE TABLE shared_work_copy_jobs (
    id VARCHAR(64) PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    copy_status VARCHAR(16) NOT NULL CHECK (copy_status IN ('preparing', 'completed', 'failed')),
    media_manifest JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE shared_work_copy_jobs IS '个人画布独立复制过程的媒体清单，用于失败及中断回收';
COMMENT ON COLUMN shared_work_copy_jobs.id IS '复制任务及目标文档标识';
COMMENT ON COLUMN shared_work_copy_jobs.user_id IS '接收者用户标识，固定写入个人空间';
COMMENT ON COLUMN shared_work_copy_jobs.copy_status IS '准备中、已完成或失败';
COMMENT ON COLUMN shared_work_copy_jobs.media_manifest IS '复制前预分配的媒体键与对象键，仅内部可见';
COMMENT ON COLUMN shared_work_copy_jobs.updated_at IS '最近处理时间';
CREATE INDEX idx_shared_work_copy_jobs_cleanup ON shared_work_copy_jobs(updated_at) WHERE copy_status <> 'completed';
ALTER TABLE shared_work_copy_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_work_copy_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY shared_work_copy_jobs_personal ON shared_work_copy_jobs USING (team_system_access() OR current_team_id() = 0) WITH CHECK (team_system_access() OR current_team_id() = 0);

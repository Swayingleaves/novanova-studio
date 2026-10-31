CREATE TABLE email_campaigns (
    id BIGSERIAL PRIMARY KEY,
    request_id UUID NOT NULL UNIQUE,
    subject VARCHAR(200) NOT NULL,
    body_html TEXT NOT NULL,
    from_email VARCHAR(320) NOT NULL,
    recipient_mode VARCHAR(20) NOT NULL CHECK (recipient_mode IN ('all', 'selected')),
    interval_seconds INTEGER NOT NULL CHECK (interval_seconds BETWEEN 1 AND 3600),
    status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'cancelled')),
    recipient_count INTEGER NOT NULL DEFAULT 0,
    created_by BIGINT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMPTZ
);
COMMENT ON TABLE email_campaigns IS '管理员邮件群发任务，保存不可变的主题、正文、发件人与收件范围快照';
COMMENT ON COLUMN email_campaigns.id IS '群发任务主键';
COMMENT ON COLUMN email_campaigns.request_id IS '客户端请求标识，防止重复提交创建重复任务';
COMMENT ON COLUMN email_campaigns.subject IS '邮件主题';
COMMENT ON COLUMN email_campaigns.body_html IS '已清理的邮件正文，图片使用内嵌内容标识';
COMMENT ON COLUMN email_campaigns.from_email IS '创建任务时的发件人地址';
COMMENT ON COLUMN email_campaigns.recipient_mode IS '收件范围：all全部有邮箱用户，selected指定用户';
COMMENT ON COLUMN email_campaigns.interval_seconds IS '每封邮件完成后至少等待的秒数';
COMMENT ON COLUMN email_campaigns.status IS '任务状态：queued排队、running发送中、completed处理完成、cancelled已取消';
COMMENT ON COLUMN email_campaigns.recipient_count IS '提交时实际收件人数量';
COMMENT ON COLUMN email_campaigns.created_by IS '创建任务的管理员用户主键';
COMMENT ON COLUMN email_campaigns.created_at IS '任务创建时间';
COMMENT ON COLUMN email_campaigns.finished_at IS '任务完成或取消时间';
CREATE INDEX idx_email_campaigns_created ON email_campaigns(created_at DESC, id DESC);
CREATE INDEX idx_email_campaigns_active ON email_campaigns(id) WHERE status IN ('queued', 'running');

CREATE TABLE email_campaign_images (
    campaign_id BIGINT NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
    content_id VARCHAR(30) NOT NULL,
    mime_type VARCHAR(40) NOT NULL,
    image_data BYTEA NOT NULL,
    PRIMARY KEY (campaign_id, content_id)
);
COMMENT ON TABLE email_campaign_images IS '群发图片二进制快照，使用邮件内嵌图片避免对象存储签名链接过期';
COMMENT ON COLUMN email_campaign_images.campaign_id IS '所属群发任务主键';
COMMENT ON COLUMN email_campaign_images.content_id IS '邮件内嵌图片的内容标识';
COMMENT ON COLUMN email_campaign_images.mime_type IS '经校验的图片媒体类型';
COMMENT ON COLUMN email_campaign_images.image_data IS '图片文件内容，每任务总大小不超过十兆字节';

CREATE TABLE email_deliveries (
    id BIGSERIAL PRIMARY KEY,
    campaign_id BIGINT NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL,
    email VARCHAR(320) NOT NULL,
    nickname VARCHAR(200) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'unknown', 'cancelled')),
    error_message VARCHAR(1000),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    UNIQUE (campaign_id, user_id),
    UNIQUE (campaign_id, email)
);
COMMENT ON TABLE email_deliveries IS '逐收件人发送记录，邮箱使用提交时快照，每封邮件仅有一位收件人';
COMMENT ON COLUMN email_deliveries.id IS '发送记录主键';
COMMENT ON COLUMN email_deliveries.campaign_id IS '所属群发任务主键';
COMMENT ON COLUMN email_deliveries.user_id IS '提交时收件用户主键，删除用户后仍保留发送记录';
COMMENT ON COLUMN email_deliveries.email IS '提交时收件邮箱快照';
COMMENT ON COLUMN email_deliveries.nickname IS '提交时用户昵称快照';
COMMENT ON COLUMN email_deliveries.status IS 'queued待发送、sending发送中、sent邮件服务器已接受、failed发送失败、unknown结果不确定、cancelled已取消';
COMMENT ON COLUMN email_deliveries.error_message IS '失败或结果不确定的中文说明';
COMMENT ON COLUMN email_deliveries.started_at IS '最近一次开始发送时间，同时用于滚动窗口限流';
COMMENT ON COLUMN email_deliveries.finished_at IS '发送完成或取消时间';
CREATE INDEX idx_email_deliveries_campaign_status ON email_deliveries(campaign_id, status, id);
CREATE INDEX idx_email_deliveries_attempt ON email_deliveries(started_at) WHERE started_at IS NOT NULL;
CREATE INDEX idx_email_deliveries_sending ON email_deliveries(started_at) WHERE status = 'sending';

CREATE TABLE email_dispatch_control (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    next_send_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE email_dispatch_control IS '群发派发控制单例，行锁串行分配跨实例发送额度';
COMMENT ON COLUMN email_dispatch_control.id IS '固定为一的单例主键';
COMMENT ON COLUMN email_dispatch_control.next_send_at IS '全局下一封邮件最早允许发送的时间';
INSERT INTO email_dispatch_control(id) VALUES (1);

-- 群发只在平台空间运行，团队管理员不能通过团队上下文访问群发数据。
DO $$
DECLARE table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['email_campaigns', 'email_campaign_images', 'email_deliveries', 'email_dispatch_control'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format('CREATE POLICY platform_email_access ON %I USING (current_setting(''novanova.team_id'', true) = ''0'') WITH CHECK (current_setting(''novanova.team_id'', true) = ''0'')', table_name);
    END LOOP;
END $$;

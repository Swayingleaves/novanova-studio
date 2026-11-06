CREATE TABLE fantastic_work_likes (
    target_key VARCHAR(200) NOT NULL,
    user_id BIGINT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (target_key, user_id)
);
COMMENT ON TABLE fantastic_work_likes IS '首页 Fantastic Show 内容点赞，每个用户对同一内容只保留一条记录';
COMMENT ON COLUMN fantastic_work_likes.target_key IS '内容标识：official:精选内容ID 或 user:分享标识';
COMMENT ON COLUMN fantastic_work_likes.user_id IS '点赞用户标识';
COMMENT ON COLUMN fantastic_work_likes.created_at IS '点赞时间';

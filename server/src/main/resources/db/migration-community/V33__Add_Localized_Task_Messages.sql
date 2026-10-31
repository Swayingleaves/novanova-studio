-- 保存任务系统消息键与插值参数，原错误字段保留中文诊断。
ALTER TABLE ai_generation_tasks
    ADD COLUMN error_message_key VARCHAR(180) NOT NULL DEFAULT '',
    ADD COLUMN error_message_arguments JSONB NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN ai_generation_tasks.error_message_key IS '与语言无关的系统消息键';
COMMENT ON COLUMN ai_generation_tasks.error_message_arguments IS '系统消息插值参数JSON数组';

ALTER TABLE creation_agent_request
    ADD COLUMN error_message_key VARCHAR(180) NOT NULL DEFAULT '',
    ADD COLUMN error_message_arguments JSONB NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN creation_agent_request.error_message_key IS '与语言无关的系统消息键';
COMMENT ON COLUMN creation_agent_request.error_message_arguments IS '系统消息插值参数JSON数组';

ALTER TABLE video_composition_tasks
    ADD COLUMN error_message_key VARCHAR(180) NOT NULL DEFAULT '',
    ADD COLUMN error_message_arguments JSONB NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN video_composition_tasks.error_message_key IS '与语言无关的系统消息键';
COMMENT ON COLUMN video_composition_tasks.error_message_arguments IS '系统消息插值参数JSON数组';


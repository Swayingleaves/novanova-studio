CREATE TABLE script_source_documents (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL UNIQUE REFERENCES script_projects(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id),
    client_request_id VARCHAR(64) NOT NULL,
    source_type VARCHAR(16) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_extension VARCHAR(8) NOT NULL,
    text_encoding VARCHAR(16),
    storage_config_id VARCHAR(64) NOT NULL,
    object_key VARCHAR(512) NOT NULL,
    file_sha256 VARCHAR(64) NOT NULL,
    file_bytes BIGINT NOT NULL,
    normalized_text TEXT,
    revision BIGINT NOT NULL DEFAULT 0,
    status VARCHAR(16) NOT NULL DEFAULT 'queued',
    warning TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_script_source_request UNIQUE (user_id, client_request_id),
    CONSTRAINT ck_script_source_type CHECK (source_type IN ('novel', 'script')),
    CONSTRAINT ck_script_source_status CHECK (status IN ('queued', 'parsing', 'completed', 'failed')),
    CONSTRAINT ck_script_source_file_bytes CHECK (file_bytes > 0)
);
COMMENT ON TABLE script_source_documents IS '剧本项目导入的不可变原文件与规范化正文';
COMMENT ON COLUMN script_source_documents.id IS '原文稳定标识';
COMMENT ON COLUMN script_source_documents.project_id IS '关联的剧本项目标识';
COMMENT ON COLUMN script_source_documents.user_id IS '上传用户标识';
COMMENT ON COLUMN script_source_documents.client_request_id IS '客户端幂等请求标识';
COMMENT ON COLUMN script_source_documents.source_type IS '原文类型：小说或剧本';
COMMENT ON COLUMN script_source_documents.file_name IS '上传时的原始文件名';
COMMENT ON COLUMN script_source_documents.file_extension IS '文件扩展名';
COMMENT ON COLUMN script_source_documents.text_encoding IS '文本文件采用的明确编码';
COMMENT ON COLUMN script_source_documents.storage_config_id IS '上传时使用的平台对象存储配置标识';
COMMENT ON COLUMN script_source_documents.object_key IS '私有对象存储键，不向客户端公开';
COMMENT ON COLUMN script_source_documents.file_sha256 IS '原文件SHA-256摘要';
COMMENT ON COLUMN script_source_documents.file_bytes IS '原文件字节数';
COMMENT ON COLUMN script_source_documents.normalized_text IS '仅规范换行后的完整提取正文';
COMMENT ON COLUMN script_source_documents.revision IS '人工校对结构修订号';
COMMENT ON COLUMN script_source_documents.status IS '解析状态';
COMMENT ON COLUMN script_source_documents.warning IS '待校对等非致命提示';
COMMENT ON COLUMN script_source_documents.created_at IS '创建时间';
COMMENT ON COLUMN script_source_documents.updated_at IS '更新时间';
CREATE INDEX idx_script_source_documents_user ON script_source_documents(user_id, created_at DESC);

CREATE TABLE script_source_sections (
    id VARCHAR(64) PRIMARY KEY,
    document_id VARCHAR(64) NOT NULL REFERENCES script_source_documents(id) ON DELETE CASCADE,
    parent_id VARCHAR(64) REFERENCES script_source_sections(id) ON DELETE CASCADE,
    section_type VARCHAR(16) NOT NULL,
    title VARCHAR(255) NOT NULL,
    start_offset INTEGER NOT NULL,
    end_offset INTEGER NOT NULL,
    sort_order INTEGER NOT NULL,
    needs_review BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT ck_script_source_section_type CHECK (section_type IN ('chapter', 'scene')),
    CONSTRAINT ck_script_source_section_span CHECK (start_offset >= 0 AND end_offset > start_offset)
);
COMMENT ON TABLE script_source_sections IS '原文中的章节与场景结构，偏移采用UTF-16且终点不含';
COMMENT ON COLUMN script_source_sections.id IS '结构段稳定标识';
COMMENT ON COLUMN script_source_sections.document_id IS '所属原文标识';
COMMENT ON COLUMN script_source_sections.parent_id IS '父章节标识，顶层结构段为空';
COMMENT ON COLUMN script_source_sections.section_type IS '结构段类型：章节或场景';
COMMENT ON COLUMN script_source_sections.title IS '人工可校对的标题';
COMMENT ON COLUMN script_source_sections.start_offset IS '在规范化正文中的起点，包含';
COMMENT ON COLUMN script_source_sections.end_offset IS '在规范化正文中的终点，不包含';
COMMENT ON COLUMN script_source_sections.sort_order IS '同级排序序号';
COMMENT ON COLUMN script_source_sections.needs_review IS '规则未识别标题时需要人工校对';
CREATE INDEX idx_script_source_sections_document ON script_source_sections(document_id, parent_id, sort_order);
CREATE INDEX idx_script_source_sections_span ON script_source_sections(document_id, start_offset, end_offset);

CREATE TABLE script_source_chunks (
    id VARCHAR(64) PRIMARY KEY,
    document_id VARCHAR(64) NOT NULL REFERENCES script_source_documents(id) ON DELETE CASCADE,
    section_id VARCHAR(64) NOT NULL REFERENCES script_source_sections(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    start_offset INTEGER NOT NULL,
    end_offset INTEGER NOT NULL,
    content TEXT NOT NULL,
    character_count INTEGER NOT NULL,
    CONSTRAINT uq_script_source_chunk UNIQUE (section_id, chunk_index),
    CONSTRAINT ck_script_source_chunk_span CHECK (start_offset >= 0 AND end_offset > start_offset)
);
COMMENT ON TABLE script_source_chunks IS '供后续分析使用的有序原文片段';
COMMENT ON COLUMN script_source_chunks.id IS '片段稳定标识';
COMMENT ON COLUMN script_source_chunks.document_id IS '所属原文标识';
COMMENT ON COLUMN script_source_chunks.section_id IS '所属顶层章节或场次';
COMMENT ON COLUMN script_source_chunks.chunk_index IS '结构段内片段顺序';
COMMENT ON COLUMN script_source_chunks.start_offset IS '规范化正文起点，包含';
COMMENT ON COLUMN script_source_chunks.end_offset IS '规范化正文终点，不包含';
COMMENT ON COLUMN script_source_chunks.content IS '片段正文';
COMMENT ON COLUMN script_source_chunks.character_count IS '片段UTF-16字符数，不代表模型令牌数';
CREATE INDEX idx_script_source_chunks_document ON script_source_chunks(document_id, start_offset);

CREATE TABLE script_source_import_tasks (
    id VARCHAR(64) PRIMARY KEY,
    document_id VARCHAR(64) NOT NULL UNIQUE REFERENCES script_source_documents(id) ON DELETE CASCADE,
    status VARCHAR(16) NOT NULL DEFAULT 'queued',
    stage VARCHAR(24) NOT NULL DEFAULT 'uploaded',
    processed_sections INTEGER NOT NULL DEFAULT 0,
    total_sections INTEGER NOT NULL DEFAULT 0,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_script_source_task_status CHECK (status IN ('queued', 'running', 'completed', 'failed'))
);
COMMENT ON TABLE script_source_import_tasks IS '原文解析任务状态与分段检查点';
COMMENT ON COLUMN script_source_import_tasks.id IS '导入任务稳定标识';
COMMENT ON COLUMN script_source_import_tasks.document_id IS '所属原文标识';
COMMENT ON COLUMN script_source_import_tasks.status IS '任务状态';
COMMENT ON COLUMN script_source_import_tasks.stage IS '当前解析阶段';
COMMENT ON COLUMN script_source_import_tasks.processed_sections IS '已持久化的顶层结构段数';
COMMENT ON COLUMN script_source_import_tasks.total_sections IS '需要处理的顶层结构段数';
COMMENT ON COLUMN script_source_import_tasks.attempt_count IS '执行尝试次数';
COMMENT ON COLUMN script_source_import_tasks.error_message IS '最后一次失败原因';
COMMENT ON COLUMN script_source_import_tasks.updated_at IS '任务状态更新时间';
CREATE INDEX idx_script_source_tasks_recovery ON script_source_import_tasks(status, updated_at);

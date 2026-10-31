-- 小说改编一键流水线的异步任务：阶段、进度、计费快照与人工停点状态。
CREATE TABLE novel_adaptation_jobs (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES script_projects(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id),
    client_request_id VARCHAR(64) NOT NULL,
    model_value VARCHAR(300) NOT NULL,
    model_config_id VARCHAR(64) NOT NULL,
    settings JSONB NOT NULL,
    fact_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    phase VARCHAR(16) NOT NULL DEFAULT 'skeleton',
    stage VARCHAR(16) NOT NULL DEFAULT 'overview',
    status VARCHAR(16) NOT NULL DEFAULT 'queued',
    total_units INTEGER NOT NULL DEFAULT 0,
    processed_units INTEGER NOT NULL DEFAULT 0,
    estimated_calls INTEGER NOT NULL DEFAULT 0,
    settled_calls INTEGER NOT NULL DEFAULT 0,
    credits INTEGER NOT NULL DEFAULT 0,
    error_message TEXT NOT NULL DEFAULT '',
    lease_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_novel_adaptation_job_request UNIQUE (user_id, client_request_id),
    CONSTRAINT ck_novel_adaptation_job_phase CHECK (phase IN ('skeleton', 'episodes', 'drafts')),
    CONSTRAINT ck_novel_adaptation_job_stage CHECK (stage IN ('overview', 'characters', 'world', 'outline', 'episodes', 'episode', 'done')),
    CONSTRAINT ck_novel_adaptation_job_status CHECK (status IN ('queued', 'running', 'awaiting', 'completed', 'failed', 'canceled')),
    CONSTRAINT ck_novel_adaptation_job_amount CHECK (total_units >= 0 AND processed_units >= 0
        AND estimated_calls >= 0 AND settled_calls >= 0 AND credits >= 0)
);
COMMENT ON TABLE novel_adaptation_jobs IS '小说改编一键流水线任务、计费快照与人工停点状态';
COMMENT ON COLUMN novel_adaptation_jobs.id IS '任务标识，同时作为积分预扣与退款的操作标识';
COMMENT ON COLUMN novel_adaptation_jobs.project_id IS '剧本项目标识';
COMMENT ON COLUMN novel_adaptation_jobs.user_id IS '发起用户标识';
COMMENT ON COLUMN novel_adaptation_jobs.client_request_id IS '客户端幂等请求标识';
COMMENT ON COLUMN novel_adaptation_jobs.model_value IS '所选文本模型，格式为渠道标识::模型名称';
COMMENT ON COLUMN novel_adaptation_jobs.model_config_id IS '所选文本模型配置标识，用于模型并发队列';
COMMENT ON COLUMN novel_adaptation_jobs.settings IS '用户确认的改编形式、集数、时长、节奏与改编程度';
COMMENT ON COLUMN novel_adaptation_jobs.fact_ids IS '启动时锁定的已确认事实标识快照，全量传入';
COMMENT ON COLUMN novel_adaptation_jobs.phase IS '流水线阶段：骨架、分集规划或各集正文';
COMMENT ON COLUMN novel_adaptation_jobs.stage IS '当前或最后完成的改编阶段，done表示全部结束';
COMMENT ON COLUMN novel_adaptation_jobs.status IS '任务状态：排队、运行、等待人工确认、完成、失败、取消';
COMMENT ON COLUMN novel_adaptation_jobs.total_units IS '已规划的模型调用总数';
COMMENT ON COLUMN novel_adaptation_jobs.processed_units IS '已完成的模型调用数';
COMMENT ON COLUMN novel_adaptation_jobs.estimated_calls IS '报价时估算的模型调用次数，用于退款结算';
COMMENT ON COLUMN novel_adaptation_jobs.settled_calls IS '已按成功步骤结算的调用次数';
COMMENT ON COLUMN novel_adaptation_jobs.credits IS '启动时预扣的积分';
COMMENT ON COLUMN novel_adaptation_jobs.error_message IS '最后一次失败原因';
COMMENT ON COLUMN novel_adaptation_jobs.lease_until IS '执行租约到期时间';
COMMENT ON COLUMN novel_adaptation_jobs.created_at IS '创建时间';
COMMENT ON COLUMN novel_adaptation_jobs.updated_at IS '更新时间';
-- 同一项目同时只允许一个未结束的任务，包含等待人工确认的阶段。
CREATE UNIQUE INDEX uq_novel_adaptation_job_active ON novel_adaptation_jobs(project_id)
    WHERE status IN ('queued', 'running', 'awaiting');
CREATE INDEX idx_novel_adaptation_jobs_project ON novel_adaptation_jobs(project_id, created_at DESC);
CREATE INDEX idx_novel_adaptation_jobs_recovery ON novel_adaptation_jobs(status, updated_at);

-- 草稿归属任务，便于查询一次任务产出了哪些阶段的草稿；同步生成的草稿该列为空。
ALTER TABLE novel_adaptation_drafts ADD COLUMN job_id VARCHAR(64) REFERENCES novel_adaptation_jobs(id) ON DELETE CASCADE;
COMMENT ON COLUMN novel_adaptation_drafts.job_id IS '产出该草稿的一键流水线任务标识，同步单阶段生成为空';
CREATE INDEX idx_novel_adaptation_drafts_job ON novel_adaptation_drafts(job_id, stage);

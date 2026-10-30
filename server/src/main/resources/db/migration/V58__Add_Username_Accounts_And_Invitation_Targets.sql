ALTER TABLE users
    ADD COLUMN created_by_team_id BIGINT REFERENCES teams(id),
    ADD COLUMN created_by_user_id BIGINT REFERENCES users(id),
    ADD CONSTRAINT ck_users_created_by_team CHECK (created_by_team_id IS NULL OR created_by_team_id > 0);
COMMENT ON COLUMN users.created_by_team_id IS '首次创建账号的团队，平台创建及历史账号为空，不随入团或移除改变';
COMMENT ON COLUMN users.created_by_user_id IS '首次创建账号的管理员，历史账号及公开注册账号为空';
COMMENT ON COLUMN users.email IS '规范化邮箱，无邮箱用户名账号为空';
COMMENT ON COLUMN users.username IS '全平台唯一且区分大小写的用户名，邮箱注册账号初始使用邮箱';

ALTER TABLE team_invitations
    ALTER COLUMN email DROP NOT NULL,
    ADD COLUMN invited_user_id BIGINT REFERENCES users(id),
    ADD COLUMN invited_account VARCHAR(255);
-- 已注册邮箱邀请绑定稳定用户标识，未注册邮箱邀请继续等待本人注册。
UPDATE team_invitations invitations SET invited_user_id = users.id
    FROM users WHERE invitations.email = users.email;
UPDATE team_invitations SET invited_account = email WHERE invited_account IS NULL;
ALTER TABLE team_invitations
    ALTER COLUMN invited_account SET NOT NULL,
    ADD CONSTRAINT ck_team_invitation_target CHECK (invited_user_id IS NOT NULL OR email IS NOT NULL);
COMMENT ON TABLE team_invitations IS '由目标用户主动接受的团队邀请，已有账号绑定用户标识，未注册账号绑定邮箱';
COMMENT ON COLUMN team_invitations.email IS '受邀邮箱，用户名邀请无邮箱时为空';
COMMENT ON COLUMN team_invitations.invited_user_id IS '稳定受邀用户标识，未注册邮箱邀请为空，改名不改变目标';
COMMENT ON COLUMN team_invitations.invited_account IS '发出邀请时的账号展示快照，不作为已有账号的鉴权依据';
CREATE UNIQUE INDEX uk_team_pending_invitation_user ON team_invitations(team_id, invited_user_id)
    WHERE invitation_status = 'pending' AND invited_user_id IS NOT NULL;
CREATE INDEX idx_team_invitations_user_status ON team_invitations(invited_user_id, invitation_status, expires_at)
    WHERE invited_user_id IS NOT NULL;

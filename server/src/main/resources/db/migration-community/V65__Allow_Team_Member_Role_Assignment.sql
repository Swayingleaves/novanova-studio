-- 主管理员由团队记录唯一指定，团队可以额外授权多名管理员。
DROP INDEX uk_team_administrator;
COMMENT ON COLUMN teams.administrator_user_id IS '主管理员用户标识，成员授权不能变更';
COMMENT ON COLUMN team_members.member_role IS '团队角色：administrator团队管理员、member普通成员；主管理员由teams.administrator_user_id确定';

CREATE OR REPLACE FUNCTION enforce_team_member_limit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    maximum_members INTEGER;
    primary_administrator BIGINT;
BEGIN
    SELECT member_limit, administrator_user_id INTO maximum_members, primary_administrator
        FROM teams WHERE id = NEW.team_id FOR UPDATE;
    -- 授权管理员仍占用子账号名额，仅主管理员本人不占名额。
    IF NEW.member_status <> 'removed' AND NEW.user_id IS DISTINCT FROM primary_administrator THEN
        IF (SELECT COUNT(*) FROM team_members
            WHERE team_id = NEW.team_id AND user_id <> NEW.user_id
                AND user_id IS DISTINCT FROM primary_administrator AND member_status <> 'removed') >= maximum_members
        THEN RAISE EXCEPTION '团队子账号数量已达到上限' USING ERRCODE = '23514'; END IF;
    END IF;
    RETURN NEW;
END $$;
COMMENT ON FUNCTION enforce_team_member_limit() IS '持有团队行锁校验子账号人数，授权管理员与禁用成员占名额，仅主管理员及已移除成员除外';

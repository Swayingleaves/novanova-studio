-- 签到调整为仅每日签到积分，移除连续签到阶梯奖励

ALTER TABLE platform_credit_settings
    DROP CONSTRAINT ck_platform_credit_settings_check_in;

ALTER TABLE platform_credit_settings
    DROP COLUMN check_in_streak_3_credits,
    DROP COLUMN check_in_streak_7_credits,
    DROP COLUMN check_in_streak_14_credits,
    DROP COLUMN check_in_streak_30_credits;

ALTER TABLE platform_credit_settings
    ADD CONSTRAINT ck_platform_credit_settings_check_in CHECK (check_in_credits >= 0);

COMMENT ON COLUMN platform_credit_settings.check_in_credits IS '每日签到积分，仅当天签到有效、过期不补签，0表示签到不发放积分';

ALTER TABLE user_check_ins
    DROP CONSTRAINT ck_user_check_ins_streak,
    DROP CONSTRAINT ck_user_check_ins_credits,
    DROP CONSTRAINT ck_user_check_ins_bonus,
    DROP CONSTRAINT ck_user_check_ins_bonus_streak;

ALTER TABLE user_check_ins
    DROP COLUMN streak_days,
    DROP COLUMN bonus_credits,
    DROP COLUMN bonus_streak_days;

ALTER TABLE user_check_ins
    RENAME COLUMN base_credits TO credits;

ALTER TABLE user_check_ins
    ADD CONSTRAINT ck_user_check_ins_credits CHECK (credits >= 0);

COMMENT ON COLUMN user_check_ins.credits IS '本次签到发放的积分，按签到当天的配置发放';

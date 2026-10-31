"use client";
import { useTranslation } from "@/features/locale/use-translation";


import { useEffect, useMemo, useState } from "react";
import { App, Button, Form, Input, Tabs } from "antd";
import { ArrowRight } from "lucide-react";
import { useRouter } from "@/shared/lib/team-navigation";

import { loginByAccount, registerByEmail, sendEmailCode } from "@/services/api/server";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { OAuth2LoginOptions } from "@/features/auth/components/oauth2-login-options";
import { completeAuthentication } from "@/features/auth/lib/complete-authentication";
import { useSpaceBrand } from "@/features/team/use-space-brand";

type LoginForm = {
    account: string;
    password: string;
};

type RegisterForm = {
    email: string;
    code: string;
    password: string;
    nickname?: string;
};

const EMAIL_CODE_COOLDOWN_SECONDS = 60;
const EMAIL_CODE_COOLDOWN_STORAGE_KEY = "novanova:auth:email_code_cooldown_until";

type AuthFormProps = {
    /** 登录或注册成功后的回调 */
    onSuccess?: () => void;
    /** OAuth2登录成功后的站内跳转目标 */
    redirectPath?: string;
    /** 邀请链接携带的邀请码 */
    invitationCode?: string;
};

export function AuthForm({ onSuccess, redirectPath, invitationCode }: AuthFormProps) {
    const translate = useTranslation();
    const { message } = App.useApp();
    const router = useRouter();
    const brand = useSpaceBrand();
    const registrationEnabled = !brand.isTeam;
    const platformInvitationCode = registrationEnabled ? invitationCode : undefined;
    const [activeKey, setActiveKey] = useState(platformInvitationCode ? "register" : "login");
    const [sendingCode, setSendingCode] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [codeCooldownSeconds, setCodeCooldownSeconds] = useState(0);
    const [loginForm] = Form.useForm<LoginForm>();
    const [registerForm] = Form.useForm<RegisterForm>();
    const closeAuthModal = useUserStore((state) => state.closeAuthModal);

    useEffect(() => {
        if (!registrationEnabled) return;
        const updateCountdown = () => {
            const remainingSeconds = readEmailCodeCooldownSeconds();
            setCodeCooldownSeconds(remainingSeconds);
            if (remainingSeconds <= 0) {
                clearEmailCodeCooldown();
            }
        };
        updateCountdown();
        const timer = window.setInterval(updateCountdown, 1000);
        return () => window.clearInterval(timer);
    }, [registrationEnabled]);

    const codeButtonText = useMemo(() => {
        if (sendingCode) return translate("auth.sending");
        if (codeCooldownSeconds > 0) return translate("auth.resendInS", { value0: codeCooldownSeconds });
        return translate("auth.sendCode");
    }, [codeCooldownSeconds, sendingCode, translate.locale]);

    const sendCode = async () => {
        if (!registrationEnabled) return;
        const email = registerForm.getFieldValue("email");
        if (!email) {
            message.warning(translate("auth.enterYourEmailFirst"));
            return;
        }
        if (codeCooldownSeconds > 0) {
            message.warning(translate("auth.sendAgainInSeconds", { value0: codeCooldownSeconds }));
            return;
        }
        setSendingCode(true);
        try {
            await sendEmailCode(email);
            startEmailCodeCooldown();
            setCodeCooldownSeconds(EMAIL_CODE_COOLDOWN_SECONDS);
            message.success(translate("auth.codeSentCheckYourInbox"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("auth.failedToSendCode"));
        } finally {
            setSendingCode(false);
        }
    };

    const login = async (values: LoginForm) => {
        setSubmitting(true);
        try {
            const result = await loginByAccount(values);
            completeAuthentication(result, redirectPath);
            message.success(translate("auth.signedIn"));
            onSuccess?.();
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("auth.signInFailed"));
        } finally {
            setSubmitting(false);
        }
    };

    const register = async (values: RegisterForm) => {
        if (!registrationEnabled) return;
        setSubmitting(true);
        try {
            const result = await registerByEmail({ ...values, invitationCode: platformInvitationCode });
            completeAuthentication(result, redirectPath);
            message.success(translate("auth.signedUp"));
            onSuccess?.();
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("auth.signUpFailed"));
        } finally {
            setSubmitting(false);
        }
    };

    const goToForgotPassword = () => {
        closeAuthModal();
        router.push("/auth/forgotPassword");
    };

    return (
        <>
            <Tabs
                activeKey={registrationEnabled ? activeKey : "login"}
                onChange={setActiveKey}
                items={[
                {
                    key: "login",
                    label: translate("auth.signIn_1e2df9"),
                    children: (
                        <Form form={loginForm} layout="vertical" requiredMark={false} onFinish={login} className="pt-2">
                            <Form.Item name="account" label={translate("auth.account")} rules={[{ required: true, whitespace: true, message: translate("auth.enterAccount") }]}>
                                <Input size="large" autoComplete="username" placeholder={translate("auth.enterAccount")} />
                            </Form.Item>
                            <Form.Item name="password" label={translate("auth.password")} rules={[{ required: true, message: translate("auth.enterAPassword") }]}>
                                <Input.Password size="large" autoComplete="current-password" placeholder={translate("auth.enterAPassword")} />
                            </Form.Item>
                            <div className="-mt-2 mb-2 flex justify-end">
                                <Button type="link" className="min-h-11 px-0" onClick={goToForgotPassword}>
                                    {translate("auth.forgotPassword")}</Button>
                            </div>
                            <Button type="primary" htmlType="submit" size="large" block loading={submitting} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                                {translate("auth.signIn_1e2df9")}</Button>
                            <OAuth2LoginOptions redirectPath={redirectPath} invitationCode={platformInvitationCode} />
                        </Form>
                    ),
                },
                ...(registrationEnabled ? [{
                    key: "register",
                    label: translate("auth.signUp"),
                    children: (
                        <Form form={registerForm} layout="vertical" requiredMark={false} onFinish={register} className="pt-2">
                            <Form.Item name="email" label={translate("auth.email")} rules={[{ required: true, message: translate("auth.enterAnEmailAddress") }, { type: "email", message: translate("auth.invalidEmailAddress") }]}>
                                <Input size="large" autoComplete="email" placeholder="name@example.com" />
                            </Form.Item>
                            <Form.Item label={translate("auth.verificationCode")} required>
                                <div className="grid grid-cols-[1fr_auto] gap-2">
                                    <Form.Item name="code" noStyle rules={[{ required: true, message: translate("auth.enterVerificationCode") }]}>
                                        <Input size="large" autoComplete="one-time-code" placeholder={translate("auth.6DigitCode")} />
                                    </Form.Item>
                                    <Button size="large" loading={sendingCode} disabled={codeCooldownSeconds > 0} onClick={sendCode}>
                                        {codeButtonText}
                                    </Button>
                                </div>
                            </Form.Item>
                            <Form.Item name="nickname" label={translate("auth.displayName")}>
                                <Input size="large" autoComplete="nickname" placeholder={translate("auth.optional")} />
                            </Form.Item>
                            <Form.Item name="password" label={translate("auth.password")} rules={[{ required: true, message: translate("auth.enterAPassword") }, { min: 8, message: translate("auth.atLeast8Characters") }]}>
                                <Input.Password size="large" autoComplete="new-password" placeholder={translate("auth.atLeast8Characters_d482f2")} />
                            </Form.Item>
                            <Button type="primary" htmlType="submit" size="large" block loading={submitting} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                                {translate("auth.signUpAndSignIn")}</Button>
                            <OAuth2LoginOptions redirectPath={redirectPath} invitationCode={platformInvitationCode} />
                        </Form>
                    ),
                }] : []),
                ]}
            />
        </>
    );
}

function readEmailCodeCooldownSeconds() {
    if (typeof window === "undefined") return 0;
    try {
        const raw = window.localStorage.getItem(EMAIL_CODE_COOLDOWN_STORAGE_KEY);
        const expiresAt = raw ? Number(raw) : 0;
        if (!Number.isFinite(expiresAt) || expiresAt <= 0) return 0;
        return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    } catch {
        return 0;
    }
}

function startEmailCodeCooldown() {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(EMAIL_CODE_COOLDOWN_STORAGE_KEY, String(Date.now() + EMAIL_CODE_COOLDOWN_SECONDS * 1000));
    } catch {
        // 浏览器禁止本地存储时，仅保留当前页面内的倒计时状态。
    }
}

function clearEmailCodeCooldown() {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.removeItem(EMAIL_CODE_COOLDOWN_STORAGE_KEY);
    } catch {
        // 浏览器禁止本地存储时无需额外处理。
    }
}

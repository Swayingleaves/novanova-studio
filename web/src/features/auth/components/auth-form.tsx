"use client";
import { useTranslation } from "@/features/locale/use-translation";


import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Form, Input } from "antd";
import type { InputRef } from "antd";
import { useRouter } from "@/shared/lib/team-navigation";

import { loginByAccount, registerByEmail, sendEmailCode, ServerApiError } from "@/services/api/server";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { OAuth2LoginOptions } from "@/features/auth/components/oauth2-login-options";
import { completeAuthentication } from "@/features/auth/lib/complete-authentication";
import { useSpaceBrand } from "@/features/team/use-space-brand";

type AuthFormFields = {
    account: string;
    password: string;
    email: string;
    code: string;
};

/** 登录与注册合并成同一入口后的两个面：凭证面与邮箱验证面。 */
type AuthStep = "credentials" | "email";

const EMAIL_CODE_COOLDOWN_SECONDS = 60;
const EMAIL_CODE_COOLDOWN_STORAGE_KEY = "novanova:auth:email_code_cooldown_until";

/** 账号不存在时后端返回的系统消息键，用来把界面翻到邮箱验证。 */
const ACCOUNT_NOT_FOUND_MESSAGE_KEY = "business.accountNotFound";
/** 邮箱已被占用时后端返回的系统消息键。 */
const EMAIL_ALREADY_REGISTERED_MESSAGE_KEY = "business.emailAlreadyRegistered";
/** 用户名已被占用时后端返回的系统消息键。 */
const ACCOUNT_ALREADY_EXISTS_MESSAGE_KEY = "business.accountAlreadyExists";

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
    const [form] = Form.useForm<AuthFormFields>();
    const [step, setStep] = useState<AuthStep>("credentials");
    const [pendingAccount, setPendingAccount] = useState("");
    const [emailLocked, setEmailLocked] = useState(false);
    const [sendingCode, setSendingCode] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [codeCooldownSeconds, setCodeCooldownSeconds] = useState(0);
    const [codeSentToEmail, setCodeSentToEmail] = useState("");
    const closeAuthModal = useUserStore((state) => state.closeAuthModal);
    const emailInputRef = useRef<InputRef>(null);
    const emailValue = Form.useWatch("email", form) as string | undefined;
    const accountValue = Form.useWatch("account", form) as string | undefined;
    // 邮箱填完整才展开验证码，避免一进邮箱步骤就给用户一堆空字段。
    const codeVisible = Boolean(emailValue && emailValue.includes("@"));
    // 已经发过码的账号原样再提交时直接翻回邮箱面，验证码和倒计时都还在，不重复发信。
    const canResumeEmailStep = Boolean(pendingAccount && codeSentToEmail && accountValue?.trim() === pendingAccount);

    // 翻到邮箱面后等翻转结束再聚焦，否则焦点会在旋转中途跳过去。
    useEffect(() => {
        if (step !== "email" || emailLocked) return;
        const timer = window.setTimeout(() => emailInputRef.current?.focus(), 520);
        return () => window.clearTimeout(timer);
    }, [step, emailLocked]);

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

    /** 回到凭证面只切面，不清邮箱和验证码：翻回邮箱面时状态还在。 */
    const backToCredentials = (account?: string) => {
        if (account) form.setFieldValue("account", account);
        setStep("credentials");
    };

    const sendCode = async () => {
        if (!registrationEnabled) return;
        const email = String(form.getFieldValue("email") ?? "").trim();
        if (!email) {
            message.warning(translate("auth.enterYourEmailFirst"));
            return;
        }
        if (!email.includes("@")) {
            message.warning(translate("auth.invalidEmailAddress"));
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
            setCodeSentToEmail(email);
            message.success(translate("auth.codeSentCheckYourInbox"));
        } catch (error) {
            if (isMessageKey(error, EMAIL_ALREADY_REGISTERED_MESSAGE_KEY)) {
                message.warning(translate("auth.emailAlreadyRegisteredSignInInstead"));
                backToCredentials(email);
                return;
            }
            message.error(error instanceof Error ? error.message : translate("auth.failedToSendCode"));
        } finally {
            setSendingCode(false);
        }
    };

    /** 凭证面：先按登录处理，账号不存在再翻到邮箱验证面。 */
    const submitCredentials = async () => {
        let values: Pick<AuthFormFields, "account" | "password">;
        try {
            values = await form.validateFields(["account", "password"]);
        } catch {
            return;
        }
        const account = values.account.trim();
        // 同一个账号已经翻过一次：直接翻回邮箱面，邮箱和验证码都还在，不再请求登录、不再发信。
        if (pendingAccount && account === pendingAccount) {
            setStep("email");
            return;
        }
        setSubmitting(true);
        try {
            const result = await loginByAccount(values);
            completeAuthentication(result, redirectPath);
            message.success(translate("auth.signedIn"));
            onSuccess?.();
        } catch (error) {
            if (registrationEnabled && isMessageKey(error, ACCOUNT_NOT_FOUND_MESSAGE_KEY)) {
                const isEmail = account.includes("@");
                setPendingAccount(account);
                setEmailLocked(isEmail);
                setCodeSentToEmail("");
                form.setFieldValue("email", isEmail ? account : "");
                // 只翻面，不自动发码：验证码由用户点「发送验证码」自己触发。
                setStep("email");
                return;
            }
            message.error(error instanceof Error ? error.message : translate("auth.signInFailed"));
        } finally {
            setSubmitting(false);
        }
    };

    /** 邮箱面：沿用凭证面填好的密码，验证码通过即完成注册并登录。 */
    const submitRegistration = async () => {
        let values: Pick<AuthFormFields, "email" | "code">;
        try {
            values = await form.validateFields(["email", "code"]);
        } catch {
            return;
        }
        const password = String(form.getFieldValue("password") ?? "");
        if (password.length < 8) {
            message.warning(translate("auth.atLeast8Characters"));
            backToCredentials();
            return;
        }
        setSubmitting(true);
        try {
            // 先填用户名再补邮箱时沿用该用户名；先填邮箱注册时后端回落到邮箱作为用户名。
            const username = pendingAccount && !pendingAccount.includes("@") ? pendingAccount : undefined;
            const result = await registerByEmail({ email: values.email.trim(), code: values.code.trim(), password, invitationCode: platformInvitationCode, username });
            completeAuthentication(result, redirectPath);
            message.success(translate("auth.signedUp"));
            onSuccess?.();
        } catch (error) {
            if (isMessageKey(error, EMAIL_ALREADY_REGISTERED_MESSAGE_KEY)) {
                message.warning(translate("auth.emailAlreadyRegisteredSignInInstead"));
                backToCredentials(values.email.trim());
                return;
            }
            if (isMessageKey(error, ACCOUNT_ALREADY_EXISTS_MESSAGE_KEY)) {
                message.warning(error instanceof Error ? error.message : translate("auth.signUpFailed"));
                setPendingAccount("");
                backToCredentials();
                return;
            }
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
        <Form form={form} layout="vertical" requiredMark={false} className="auth-form mt-3" onValuesChange={(changed) => {
            // 换邮箱后旧验证码必然对不上，直接清掉，避免用户拿旧码去注册新邮箱。
            if (Object.prototype.hasOwnProperty.call(changed, "email")) form.setFieldValue("code", "");
        }}>
            <div className="auth-flip" data-step={step}>
                <div className="auth-flip-face" data-face="credentials" aria-hidden={step !== "credentials"}>
                    <Form.Item name="account" rules={[{ required: true, whitespace: true, message: translate("auth.enterAccount") }]}>
                        <Input size="large" variant="filled" className="h-12!" aria-label={translate("auth.account")} autoComplete="username" placeholder={translate("auth.enterAccount")} onPressEnter={submitCredentials} />
                    </Form.Item>
                    <Form.Item name="password" rules={[{ required: true, message: translate("auth.enterAPassword") }]}>
                        <Input.Password size="large" variant="filled" className="h-12!" aria-label={translate("auth.password")} autoComplete="current-password" placeholder={translate("auth.enterAPassword")} onPressEnter={submitCredentials} />
                    </Form.Item>
                    <div className="-mt-1 mb-3 flex justify-end">
                        <Button type="link" className="min-h-9 px-0 text-xs" onClick={goToForgotPassword}>
                            {translate("auth.forgotPassword")}</Button>
                    </div>
                    <Button type="primary" size="large" block loading={submitting} className="h-12! font-medium" onClick={submitCredentials}>
                        {translate("auth.signInOrSignUp")}</Button>
                    {canResumeEmailStep ? (
                        <p className="mt-3 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 text-center text-xs leading-relaxed text-[var(--studio-muted)]">
                            <span>{translate("auth.codeSentTo", { value0: codeSentToEmail })}</span>
                            <button type="button" className="text-xs! text-[var(--studio-primary)]! hover:underline" onClick={() => setStep("email")}>
                                {translate("auth.continueVerification")}
                            </button>
                        </p>
                    ) : registrationEnabled ? (
                        <p className="mt-3 text-center text-xs leading-relaxed text-[var(--studio-muted)]">{translate("auth.unregisteredAccountsAreCreatedAfterEmailVerification")}</p>
                    ) : null}
                    <OAuth2LoginOptions redirectPath={redirectPath} invitationCode={platformInvitationCode} />
                </div>
                <div className="auth-flip-face" data-face="email" aria-hidden={step !== "email"}>
                    <p className="mb-3 text-[13px] leading-relaxed text-[var(--studio-muted)]">
                        {translate(emailLocked ? "auth.emailIsNotRegisteredCreateItNow" : "auth.accountIsNotRegisteredAddAnEmail", { value0: pendingAccount })}
                    </p>
                    <Form.Item name="email" rules={[{ required: true, message: translate("auth.enterAnEmailAddress") }, { type: "email", message: translate("auth.invalidEmailAddress") }]}>
                        <Input ref={emailInputRef} size="large" variant="filled" className="h-12!" readOnly={emailLocked} aria-label={translate("auth.email")} autoComplete="email" placeholder={translate("auth.enterAnEmailAddress")} />
                    </Form.Item>
                    <div className="auth-reveal" data-open={codeVisible}>
                        <div>
                            <div className="grid grid-cols-[1fr_auto] items-start gap-2">
                                <Form.Item name="code" rules={[{ required: true, message: translate("auth.enterVerificationCode") }]}>
                                    <Input size="large" variant="filled" className="h-12!" aria-label={translate("auth.verificationCode")} autoComplete="one-time-code" placeholder={translate("auth.6DigitCode")} onPressEnter={submitRegistration} />
                                </Form.Item>
                                <Button size="large" className="h-12!" loading={sendingCode} disabled={codeCooldownSeconds > 0} onClick={() => void sendCode()}>
                                    {codeButtonText}
                                </Button>
                            </div>
                        </div>
                    </div>
                    <Button type="primary" size="large" block loading={submitting} className="mt-1 h-12! font-medium" onClick={submitRegistration}>
                        {translate("auth.signInOrSignUp")}</Button>
                    <Button type="link" block className="mt-1 min-h-9 text-xs" onClick={() => backToCredentials()}>
                        {translate("auth.backToSignIn")}</Button>
                </div>
            </div>
        </Form>
    );
}

function isMessageKey(error: unknown, messageKey: string) {
    return error instanceof ServerApiError && error.messageKey === messageKey;
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

"use client";

import { useEffect, useMemo, useState } from "react";
import { App, Button, Form, Input, Tabs } from "antd";
import { ArrowRight } from "lucide-react";

import { loginByEmail, registerByEmail, sendEmailCode } from "@/services/api/server";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { OAuth2LoginOptions } from "@/features/auth/components/oauth2-login-options";

type LoginForm = {
    email: string;
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
};

export function AuthForm({ onSuccess, redirectPath }: AuthFormProps) {
    const { message } = App.useApp();
    const [activeKey, setActiveKey] = useState("login");
    const [sendingCode, setSendingCode] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [codeCooldownSeconds, setCodeCooldownSeconds] = useState(0);
    const [loginForm] = Form.useForm<LoginForm>();
    const [registerForm] = Form.useForm<RegisterForm>();
    const setSession = useUserStore((state) => state.setSession);

    useEffect(() => {
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
    }, []);

    const codeButtonText = useMemo(() => {
        if (sendingCode) return "发送中...";
        if (codeCooldownSeconds > 0) return `${codeCooldownSeconds}s 后重发`;
        return "发送验证码";
    }, [codeCooldownSeconds, sendingCode]);

    const sendCode = async () => {
        const email = registerForm.getFieldValue("email");
        if (!email) {
            message.warning("请先输入邮箱");
            return;
        }
        if (codeCooldownSeconds > 0) {
            message.warning(`请在 ${codeCooldownSeconds} 秒后再次发送`);
            return;
        }
        setSendingCode(true);
        try {
            await sendEmailCode(email);
            startEmailCodeCooldown();
            setCodeCooldownSeconds(EMAIL_CODE_COOLDOWN_SECONDS);
            message.success("验证码已发送，请查看邮箱");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "发送验证码失败");
        } finally {
            setSendingCode(false);
        }
    };

    const login = async (values: LoginForm) => {
        setSubmitting(true);
        try {
            const result = await loginByEmail(values);
            setSession(result);
            message.success("登录成功");
            onSuccess?.();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "登录失败");
        } finally {
            setSubmitting(false);
        }
    };

    const register = async (values: RegisterForm) => {
        setSubmitting(true);
        try {
            const result = await registerByEmail(values);
            setSession(result);
            message.success("注册成功");
            onSuccess?.();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "注册失败");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <>
            <Tabs
                activeKey={activeKey}
                onChange={setActiveKey}
                items={[
                {
                    key: "login",
                    label: "登录",
                    children: (
                        <Form form={loginForm} layout="vertical" requiredMark={false} onFinish={login} className="pt-2">
                            <Form.Item name="email" label="邮箱" rules={[{ required: true, message: "请输入邮箱" }, { type: "email", message: "邮箱格式不正确" }]}>
                                <Input size="large" autoComplete="email" placeholder="name@example.com" />
                            </Form.Item>
                            <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}>
                                <Input.Password size="large" autoComplete="current-password" placeholder="请输入密码" />
                            </Form.Item>
                            <Button type="primary" htmlType="submit" size="large" block loading={submitting} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                                登录
                            </Button>
                            <OAuth2LoginOptions redirectPath={redirectPath} />
                        </Form>
                    ),
                },
                {
                    key: "register",
                    label: "注册",
                    children: (
                        <Form form={registerForm} layout="vertical" requiredMark={false} onFinish={register} className="pt-2">
                            <Form.Item name="email" label="邮箱" rules={[{ required: true, message: "请输入邮箱" }, { type: "email", message: "邮箱格式不正确" }]}>
                                <Input size="large" autoComplete="email" placeholder="name@example.com" />
                            </Form.Item>
                            <Form.Item label="验证码" required>
                                <div className="grid grid-cols-[1fr_auto] gap-2">
                                    <Form.Item name="code" noStyle rules={[{ required: true, message: "请输入验证码" }]}>
                                        <Input size="large" autoComplete="one-time-code" placeholder="6 位验证码" />
                                    </Form.Item>
                                    <Button size="large" loading={sendingCode} disabled={codeCooldownSeconds > 0} onClick={sendCode}>
                                        {codeButtonText}
                                    </Button>
                                </div>
                            </Form.Item>
                            <Form.Item name="nickname" label="昵称">
                                <Input size="large" autoComplete="nickname" placeholder="可选" />
                            </Form.Item>
                            <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }, { min: 8, message: "密码至少 8 位" }]}>
                                <Input.Password size="large" autoComplete="new-password" placeholder="至少 8 位" />
                            </Form.Item>
                            <Button type="primary" htmlType="submit" size="large" block loading={submitting} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                                注册并登录
                            </Button>
                        </Form>
                    ),
                },
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

"use client";

import { useEffect, useState } from "react";
import { App, Button, Input, Modal } from "antd";
import { Mail } from "lucide-react";

import { useUserStore } from "@/features/auth/stores/use-user-store";
import { bindCurrentUserEmail, logoutCurrentUser, sendBindEmailCode } from "@/services/api/server";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PRIVATE_RELAY_SUFFIX = "@privaterelay.linux.do";

/**
 * 强制绑定真实邮箱弹窗：
 * 针对通过 LINUX DO 登录且当前邮箱为不可收信隐私中转邮箱的新老用户，
 * 未完成绑定前禁止关闭或继续页面操作。
 */
export function BindEmailModal() {
    const { message } = App.useApp();
    const user = useUserStore((state) => state.user);
    const setUser = useUserStore((state) => state.setUser);
    const clearSession = useUserStore((state) => state.clearSession);

    const [email, setEmail] = useState("");
    const [code, setCode] = useState("");
    const [sendingCode, setSendingCode] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [countdown, setCountdown] = useState(0);

    const open = Boolean(user?.emailBindingRequired);

    useEffect(() => {
        if (countdown <= 0) return;
        const timer = window.setTimeout(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
        return () => window.clearTimeout(timer);
    }, [countdown]);

    useEffect(() => {
        if (!open) {
            setEmail("");
            setCode("");
            setCountdown(0);
        }
    }, [open]);

    if (!open) return null;

    const normalizedEmail = email.trim().toLowerCase();

    const validateEmail = (): string | null => {
        if (!normalizedEmail) return "请输入常用邮箱";
        if (!EMAIL_PATTERN.test(normalizedEmail)) return "请输入正确的邮箱格式";
        if (normalizedEmail.endsWith(PRIVATE_RELAY_SUFFIX)) return "请填写可正常收信的常用邮箱，不能使用隐私中转邮箱";
        return null;
    };

    const handleSendCode = async () => {
        const errorText = validateEmail();
        if (errorText) {
            message.warning(errorText);
            return;
        }
        setSendingCode(true);
        try {
            await sendBindEmailCode(normalizedEmail);
            setCountdown(60);
            message.success("验证码已发送至邮箱，请注意查收");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "发送验证码失败，请稍后重试");
        } finally {
            setSendingCode(false);
        }
    };

    const handleSubmit = async () => {
        const errorText = validateEmail();
        if (errorText) {
            message.warning(errorText);
            return;
        }
        if (!code.trim()) {
            message.warning("请输入邮箱验证码");
            return;
        }
        setSubmitting(true);
        try {
            const updated = await bindCurrentUserEmail({ email: normalizedEmail, code: code.trim() });
            setUser(updated);
            message.success("邮箱绑定成功");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "邮箱绑定失败，请检查验证码后重试");
        } finally {
            setSubmitting(false);
        }
    };

    const handleLogout = async () => {
        try {
            await logoutCurrentUser();
        } catch {
            // 退出登录以清理本地会话为准。
        }
        clearSession();
    };

    return (
        <Modal
            open={open}
            closable={false}
            keyboard={false}
            mask={{ closable: false }}
            footer={null}
            centered
            width={440}
            zIndex={1200}
        >
            <div className="space-y-4 py-1">
                <div className="flex items-start gap-3">
                    <span className="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--studio-primary-soft)] text-[var(--studio-primary)]">
                        <Mail className="size-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                        <h2 className="text-base font-semibold text-[var(--studio-ink)]">请绑定常用邮箱</h2>
                        <p className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">
                            当前账号通过 LINUX DO 登录，使用的是隐私中转邮箱，无法正常接收验证码与通知。请绑定一个真实可用邮箱后继续使用。
                        </p>
                    </div>
                </div>

                <div className="space-y-3">
                    <div>
                        <label htmlFor="bind-real-email-input" className="mb-1 block text-xs font-medium text-[var(--studio-text)]">
                            常用邮箱
                        </label>
                        <Input
                            id="bind-real-email-input"
                            size="large"
                            type="email"
                            value={email}
                            placeholder="请输入可正常收信的邮箱"
                            autoComplete="email"
                            onChange={(event) => setEmail(event.target.value)}
                            onPressEnter={() => void handleSubmit()}
                        />
                    </div>

                    <div>
                        <label htmlFor="bind-real-email-code" className="mb-1 block text-xs font-medium text-[var(--studio-text)]">
                            邮箱验证码
                        </label>
                        <div className="flex items-center gap-2">
                            <Input
                                id="bind-real-email-code"
                                size="large"
                                maxLength={10}
                                value={code}
                                placeholder="请输入验证码"
                                onChange={(event) => setCode(event.target.value)}
                                onPressEnter={() => void handleSubmit()}
                            />
                            <Button
                                size="large"
                                className="shrink-0"
                                loading={sendingCode}
                                disabled={sendingCode || countdown > 0}
                                onClick={() => void handleSendCode()}
                            >
                                {countdown > 0 ? `${countdown}s` : "获取验证码"}
                            </Button>
                        </div>
                    </div>
                </div>

                <div className="space-y-2 pt-1">
                    <Button type="primary" size="large" block loading={submitting} onClick={() => void handleSubmit()}>
                        确认绑定并继续
                    </Button>
                    <Button type="text" size="small" block disabled={submitting} onClick={() => void handleLogout()}>
                        退出当前账号
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

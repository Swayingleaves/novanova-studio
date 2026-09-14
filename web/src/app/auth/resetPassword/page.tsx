"use client";

import { Suspense, useState } from "react";
import { App, Alert, Button, Form, Input } from "antd";
import { ArrowRight } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { resetPassword } from "@/services/api/server";
import { useUserStore } from "@/features/auth/stores/use-user-store";

type ResetPasswordForm = {
    newPassword: string;
    confirmPassword: string;
};

export default function ResetPasswordPage() {
    return (
        <Suspense fallback={<main className="studio-shell-bg flex min-h-dvh items-center justify-center text-sm text-[var(--studio-muted)]">正在打开重置页面...</main>}>
            <ResetPasswordContent />
        </Suspense>
    );
}

function ResetPasswordContent() {
    const { message } = App.useApp();
    const searchParams = useSearchParams();
    const clearSession = useUserStore((state) => state.clearSession);
    const [form] = Form.useForm<ResetPasswordForm>();
    const [submitting, setSubmitting] = useState(false);
    const [completed, setCompleted] = useState(false);
    const [resetLinkInvalid, setResetLinkInvalid] = useState(false);
    const token = searchParams.get("token")?.trim();

    const submit = async (values: ResetPasswordForm) => {
        if (!token) return;
        setSubmitting(true);
        try {
            await resetPassword({ token, newPassword: values.newPassword });
            clearSession();
            setCompleted(true);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "重置密码失败";
            setResetLinkInvalid(errorMessage.includes("重置链接已失效") || errorMessage.includes("重置链接无效"));
            form.setFields([{ name: "newPassword", errors: [errorMessage] }]);
            message.error(errorMessage);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <main className="studio-shell-bg flex min-h-dvh items-center justify-center px-4">
            <section className="studio-glass w-full max-w-[380px] rounded-xl p-8" aria-labelledby="reset-password-title">
                {!token ? (
                    <>
                        <h1 id="reset-password-title" className="studio-title mb-4 text-2xl font-semibold">重置链接无效</h1>
                        <Alert type="error" showIcon message="缺少重置链接" description="请重新发送密码重置邮件，并使用邮件中的最新链接。" />
                        <Button type="primary" size="large" block className="mt-6" href="/auth/forgotPassword">
                            重新发送重置邮件
                        </Button>
                    </>
                ) : completed ? (
                    <div className="space-y-6" role="status" aria-live="polite">
                        <div>
                            <h1 id="reset-password-title" className="studio-title text-2xl font-semibold">密码重置成功</h1>
                            <p className="studio-subtitle mt-2 text-sm">为保护账号安全，所有设备上的旧登录状态已失效，请使用新密码重新登录。</p>
                        </div>
                        <Button type="primary" size="large" block href="/auth" icon={<ArrowRight className="size-4" />} iconPlacement="end">
                            去登录
                        </Button>
                    </div>
                ) : (
                    <>
                        <div className="mb-6">
                            <h1 id="reset-password-title" className="studio-title text-2xl font-semibold">设置新密码</h1>
                            <p className="studio-subtitle mt-2 text-sm">新密码至少 8 位。提交后，其他设备上的登录状态将失效。</p>
                        </div>
                        {resetLinkInvalid ? (
                            <div className="mb-4 space-y-3">
                                <Alert type="error" showIcon message="重置链接已失效" description="请重新发送邮件，并使用最新链接设置密码。" />
                                <Button type="link" href="/auth/forgotPassword" className="h-auto px-0">重新发送重置邮件</Button>
                            </div>
                        ) : null}
                        <Form form={form} layout="vertical" requiredMark={false} onFinish={submit}>
                            <Form.Item name="newPassword" label="新密码" rules={[{ required: true, message: "请输入新密码" }, { min: 8, message: "密码至少 8 位" }]}>
                                <Input.Password size="large" autoComplete="new-password" placeholder="至少 8 位" />
                            </Form.Item>
                            <Form.Item name="confirmPassword" label="确认新密码" dependencies={["newPassword"]} rules={[{ required: true, message: "请再次输入新密码" }, ({ getFieldValue }) => ({ validator: (_, value) => !value || getFieldValue("newPassword") === value ? Promise.resolve() : Promise.reject(new Error("两次输入的密码不一致")) })]}>
                                <Input.Password size="large" autoComplete="new-password" placeholder="再次输入新密码" />
                            </Form.Item>
                            <Button type="primary" htmlType="submit" size="large" block loading={submitting} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                                确认重置密码
                            </Button>
                        </Form>
                    </>
                )}
            </section>
        </main>
    );
}

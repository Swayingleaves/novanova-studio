"use client";

import { useState } from "react";
import { App, Button, Form, Input } from "antd";
import { ArrowLeft, Send } from "lucide-react";

import { requestPasswordReset } from "@/services/api/server";

type ForgotPasswordForm = {
    email: string;
};

export default function ForgotPasswordPage() {
    const { message } = App.useApp();
    const [form] = Form.useForm<ForgotPasswordForm>();
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    const submit = async (values: ForgotPasswordForm) => {
        setSubmitting(true);
        try {
            await requestPasswordReset(values.email);
            setSubmitted(true);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "发送重置邮件失败";
            form.setFields([{ name: "email", errors: [errorMessage] }]);
            message.error(errorMessage);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <main className="studio-shell-bg flex min-h-dvh items-center justify-center px-4">
            <section className="studio-glass w-full max-w-[380px] rounded-xl p-8" aria-labelledby="forgot-password-title">
                {submitted ? (
                    <div className="space-y-6" role="status" aria-live="polite">
                        <div>
                            <h1 id="forgot-password-title" className="studio-title text-2xl font-semibold">请查看邮箱</h1>
                            <p className="studio-subtitle mt-2 text-sm">如该邮箱已注册，重置密码链接已发送。链接有效期为 15 分钟。</p>
                        </div>
                        <Button type="primary" size="large" block href="/auth" icon={<ArrowLeft className="size-4" />}>
                            返回登录
                        </Button>
                    </div>
                ) : (
                    <>
                        <div className="mb-6">
                            <h1 id="forgot-password-title" className="studio-title text-2xl font-semibold">找回密码</h1>
                            <p className="studio-subtitle mt-2 text-sm">输入注册邮箱，我们会向你发送一次性重置链接。</p>
                        </div>
                        <Form form={form} layout="vertical" requiredMark={false} onFinish={submit}>
                            <Form.Item name="email" label="邮箱" rules={[{ required: true, message: "请输入邮箱" }, { type: "email", message: "邮箱格式不正确" }]}>
                                <Input size="large" type="email" autoComplete="email" placeholder="name@example.com" />
                            </Form.Item>
                            <Button type="primary" htmlType="submit" size="large" block loading={submitting} icon={<Send className="size-4" />} iconPlacement="end">
                                发送重置链接
                            </Button>
                            <div className="mt-3 flex justify-center">
                                <Button type="link" className="min-h-11" href="/auth" icon={<ArrowLeft className="size-4" />}>
                                    返回登录
                                </Button>
                            </div>
                        </Form>
                    </>
                )}
            </section>
        </main>
    );
}

"use client";
import { LanguageMenu } from "@/features/locale/components/language-menu";
import { useTranslation } from "@/features/locale/use-translation";


import { useState } from "react";
import { App, Button, Form, Input } from "antd";
import { ArrowLeft, Send } from "lucide-react";

import { requestPasswordReset } from "@/services/api/server";

type ForgotPasswordForm = {
    email: string;
};

export default function ForgotPasswordPage() {
    const translate = useTranslation();
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
            const errorMessage = error instanceof Error ? error.message : translate("auth.failedToSendResetEmail");
            form.setFields([{ name: "email", errors: [errorMessage] }]);
            message.error(errorMessage);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <main className="studio-shell-bg flex min-h-dvh items-center justify-center px-4">
            <div className="fixed right-4 top-4 z-50"><LanguageMenu /></div>
            <section className="studio-glass w-full max-w-[380px] rounded-xl p-8" aria-labelledby="forgot-password-title">
                {submitted ? (
                    <div className="space-y-6" role="status" aria-live="polite">
                        <div>
                            <h1 id="forgot-password-title" className="studio-title text-2xl font-semibold">{translate("auth.checkYourInbox")}</h1>
                            <p className="studio-subtitle mt-2 text-sm">{translate("auth.ifRegisteredAResetLinkHasBeenSentValid")}</p>
                        </div>
                        <Button type="primary" size="large" block href="/auth" icon={<ArrowLeft className="size-4" />}>
                            {translate("auth.backToSignIn")}</Button>
                    </div>
                ) : (
                    <>
                        <div className="mb-6">
                            <h1 id="forgot-password-title" className="studio-title text-2xl font-semibold">{translate("auth.recoverPassword")}</h1>
                            <p className="studio-subtitle mt-2 text-sm">{translate("auth.enterYourAccountEmailToReceiveAOneTime")}</p>
                        </div>
                        <Form form={form} layout="vertical" requiredMark={false} onFinish={submit}>
                            <Form.Item name="email" label={translate("auth.email")} rules={[{ required: true, message: translate("auth.enterAnEmailAddress") }, { type: "email", message: translate("auth.invalidEmailAddress") }]}>
                                <Input size="large" type="email" autoComplete="email" placeholder="name@example.com" />
                            </Form.Item>
                            <Button type="primary" htmlType="submit" size="large" block loading={submitting} icon={<Send className="size-4" />} iconPlacement="end">
                                {translate("auth.sendResetLink")}</Button>
                            <div className="mt-3 flex justify-center">
                                <Button type="link" className="min-h-11" href="/auth" icon={<ArrowLeft className="size-4" />}>
                                    {translate("auth.backToSignIn")}</Button>
                            </div>
                        </Form>
                    </>
                )}
            </section>
        </main>
    );
}

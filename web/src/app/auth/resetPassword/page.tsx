"use client";
import { LanguageMenu } from "@/features/locale/components/language-menu";
import { useTranslation } from "@/features/locale/use-translation";


import { Suspense, useState } from "react";
import { App, Alert, Button, Form, Input } from "antd";
import { ArrowRight } from "lucide-react";
import { useSearchParams } from "@/shared/lib/team-navigation";

import { resetPassword, ServerRequestError } from "@/services/api/server";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { teamPath } from "@/features/team/stores/use-team-store";

type ResetPasswordForm = {
    newPassword: string;
    confirmPassword: string;
};

export default function ResetPasswordPage() {
    const translate = useTranslation();
    return (
        <Suspense fallback={<main className="studio-shell-bg flex min-h-dvh items-center justify-center text-sm text-[var(--studio-muted)]">
            <div className="fixed right-4 top-4 z-50"><LanguageMenu /></div>{translate("auth.openingResetPage")}</main>}>
            <ResetPasswordContent />
        </Suspense>
    );
}

function ResetPasswordContent() {
    const translate = useTranslation();
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
            const errorMessage = error instanceof Error ? error.message : translate("auth.passwordResetFailed");
            setResetLinkInvalid(error instanceof ServerRequestError && error.messageKey === "business.resetLinkExpiredOrAlreadyUsed");
            form.setFields([{ name: "newPassword", errors: [errorMessage] }]);
            message.error(errorMessage);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <main className="studio-shell-bg flex min-h-dvh items-center justify-center px-4">
            <div className="fixed right-4 top-4 z-50"><LanguageMenu /></div>
            <section className="studio-glass w-full max-w-[380px] rounded-xl p-8" aria-labelledby="reset-password-title">
                {!token ? (
                    <>
                        <h1 id="reset-password-title" className="studio-title mb-4 text-2xl font-semibold">{translate("auth.invalidResetLink")}</h1>
                        <Alert type="error" showIcon title={translate("auth.missingResetLink")} description={translate("auth.resendTheResetEmailAndUseTheLatestLink")} />
                        <Button type="primary" size="large" block className="mt-6" href={teamPath("/auth/forgotPassword")}>
                            {translate("auth.resendResetEmail")}</Button>
                    </>
                ) : completed ? (
                    <div className="space-y-6" role="status" aria-live="polite">
                        <div>
                            <h1 id="reset-password-title" className="studio-title text-2xl font-semibold">{translate("auth.passwordReset")}</h1>
                            <p className="studio-subtitle mt-2 text-sm">{translate("auth.oldSessionsOnAllDevicesWereInvalidatedSignIn")}</p>
                        </div>
                        <Button type="primary" size="large" block href={teamPath("/auth")} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                            {translate("auth.signIn")}</Button>
                    </div>
                ) : (
                    <>
                        <div className="mb-6">
                            <h1 id="reset-password-title" className="studio-title text-2xl font-semibold">{translate("auth.setNewPassword")}</h1>
                            <p className="studio-subtitle mt-2 text-sm">{translate("auth.newPasswordNeeds8CharactersOtherDevicesWillBe")}</p>
                        </div>
                        {resetLinkInvalid ? (
                            <div className="mb-4 space-y-3">
                                <Alert type="error" showIcon title={translate("auth.resetLinkExpired")} description={translate("auth.resendEmailAndUseTheLatestResetLink")} />
                                <Button type="link" href={teamPath("/auth/forgotPassword")} className="h-auto px-0">{translate("auth.resendResetEmail")}</Button>
                            </div>
                        ) : null}
                        <Form form={form} layout="vertical" requiredMark={false} onFinish={submit}>
                            <Form.Item name="newPassword" label={translate("auth.newPassword")} rules={[{ required: true, message: translate("auth.enterANewPassword") }, { min: 8, message: translate("auth.atLeast8Characters") }]}>
                                <Input.Password size="large" autoComplete="new-password" placeholder={translate("auth.atLeast8Characters_d482f2")} />
                            </Form.Item>
                            <Form.Item name="confirmPassword" label={translate("auth.confirmNewPassword")} dependencies={["newPassword"]} rules={[{ required: true, message: translate("auth.reEnterNewPassword") }, ({ getFieldValue }) => ({ validator: (_, value) => !value || getFieldValue("newPassword") === value ? Promise.resolve() : Promise.reject(new Error(translate("auth.passwordsDoNotMatch"))) })]}>
                                <Input.Password size="large" autoComplete="new-password" placeholder={translate("auth.reEnterNewPassword_b3c58f")} />
                            </Form.Item>
                            <Button type="primary" htmlType="submit" size="large" block loading={submitting} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                                {translate("auth.resetPassword")}</Button>
                        </Form>
                    </>
                )}
            </section>
        </main>
    );
}

"use client";

import { useState } from "react";
import { Alert, App, Form, Input, Modal } from "antd";
import { useTranslation } from "@/features/locale/use-translation";
import { useTeamStore } from "@/features/team/stores/use-team-store";
import { resetServerUserPassword } from "@/services/api/server";
import { resetMemberPassword } from "@/services/api/team";

/** 管理入口共用的全局密码重置表单，权限由服务端最终判定。 */
export function ResetAccountPasswordModal({ target, onClose, onReset }: {
    target: { userId: number; username: string } | null;
    onClose: () => void;
    onReset: () => Promise<unknown>;
}) {
    const translate = useTranslation();
    const { message } = App.useApp();
    const team = useTeamStore((state) => state.team);
    const [form] = Form.useForm<{ newPassword: string; confirmPassword: string }>();
    const [saving, setSaving] = useState(false);
    const submit = async ({ newPassword }: { newPassword: string }) => {
        if (!target) return;
        setSaving(true);
        try {
            const reset = team ? resetMemberPassword : resetServerUserPassword;
            await reset({ userId: target.userId, newPassword });
            message.success(translate("administration.passwordReset"));
            onClose();
            await onReset();
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("administration.passwordResetFailed"));
        } finally {
            setSaving(false);
        }
    };
    return <Modal title={`${translate("administration.resetPassword")} · ${target?.username || ""}`} open={!!target}
        destroyOnHidden confirmLoading={saving} onCancel={onClose} onOk={() => form.submit()}
        afterClose={() => form.resetFields()} okText={translate("administration.resetPassword")}>
        <Alert className="mb-5" type="warning" showIcon title={translate("administration.globalPasswordResetNotice")} />
        <Form form={form} layout="vertical" requiredMark={false} onFinish={submit}>
            <Form.Item name="newPassword" label={translate("auth.newPassword")} rules={[{ required: true, message: translate("auth.enterAPassword") }, { min: 8, message: translate("auth.atLeast8Characters") }]}>
                <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Form.Item name="confirmPassword" label={translate("auth.confirmNewPassword")} dependencies={["newPassword"]}
                rules={[{ required: true, message: translate("auth.enterAPassword") }, ({ getFieldValue }) => ({ validator: (_, value) => !value || value === getFieldValue("newPassword") ? Promise.resolve() : Promise.reject(new Error(translate("auth.passwordsDoNotMatch"))) })]}>
                <Input.Password autoComplete="new-password" />
            </Form.Item>
        </Form>
    </Modal>;
}

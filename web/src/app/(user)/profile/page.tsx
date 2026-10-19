"use client";
import { currentLanguageTag } from "@/features/locale/translate";

import { translateMessage as translate } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";


import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, App, Avatar, Button, Descriptions, Form, Input, Modal, Skeleton } from "antd";
import { useQuery } from "@tanstack/react-query";
import { Camera, Copy, LockKeyhole, LogIn, Save } from "lucide-react";

import { changeCurrentUserPassword, getCurrentUserInfo, getInvitationInfo, updateCurrentUserProfile } from "@/services/api/server";
import { uploadMediaFile } from "@/features/storage/services/file-storage";
import { useUserStore, type ServerUserProfile } from "@/features/auth/stores/use-user-store";
import { useTeamStore } from "@/features/team/stores/use-team-store";
import { useCopyText } from "@/shared/hooks/use-copy-text";

type ProfileFormValues = Pick<ServerUserProfile, "username" | "nickname" | "avatar">;
type PasswordFormValues = { currentPassword: string; newPassword: string; confirmPassword: string };

const MAX_AVATAR_FILE_SIZE = 2 * 1024 * 1024;

export default function ProfilePage() {
    const translate = useTranslation();
    const hydrated = useUserStore((state) => state.hydrated);
    const user = useUserStore((state) => state.user);
    const setUser = useUserStore((state) => state.setUser);
    const openAuthModal = useUserStore((state) => state.openAuthModal);
    const [profile, setProfile] = useState<ServerUserProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [reloadVersion, setReloadVersion] = useState(0);

    useEffect(() => {
        if (!hydrated) return;
        if (!user) {
            setProfile(null);
            setLoadError("");
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        setLoadError("");
        setProfile(null);
        void getCurrentUserInfo()
            .then((nextProfile) => {
                if (cancelled) return;
                setProfile(nextProfile);
                setUser(nextProfile);
            })
            .catch((error) => {
                if (!cancelled) setLoadError(error instanceof Error ? error.message : translate("profile.failedToLoadProfile"));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [hydrated, reloadVersion, setUser, user?.id]);

    return (
        <main className="studio-page h-full overflow-y-auto px-4 py-6 sm:px-6">
            <div className="mx-auto flex max-w-4xl flex-col gap-6">
                <header className="border-b border-[var(--studio-line)] pb-5">
                    <h1 className="studio-title text-2xl font-semibold">{translate("profile.profile")}</h1>
                    <p className="studio-subtitle mt-2 text-sm">{translate("profile.manageYourProfileAndAvatar")}</p>
                </header>

                {!hydrated || loading ? <ProfileSkeleton /> : null}
                {hydrated && !user ? (
                    <section className="flex min-h-72 flex-col items-center justify-center text-center">
                        <h2 className="studio-title text-lg font-medium">{translate("profile.signInToManageYourProfile")}</h2>
                        <p className="studio-subtitle mt-2 text-sm">{translate("profile.avatarAndNamesAppearInTheCreativeWorkspace")}</p>
                        <Button type="primary" className="mt-5" icon={<LogIn className="size-4" />} onClick={() => openAuthModal("/profile")}>
                            {translate("profile.signIn")}</Button>
                    </section>
                ) : null}
                {loadError ? (
                    <Alert
                        type="error"
                        showIcon
                        title={translate("profile.failedToLoadProfile")}
                        description={loadError}
                        action={
                            <Button size="small" onClick={() => setReloadVersion((value) => value + 1)}>
                                {translate("profile.reload")}</Button>
                        }
                    />
                ) : null}
                {user && profile && !loading ? <ProfileEditor profile={profile} onProfileUpdated={setProfile} /> : null}
            </div>
        </main>
    );
}

function ProfileEditor({ profile, onProfileUpdated }: { profile: ServerUserProfile; onProfileUpdated: (profile: ServerUserProfile) => void }) {
    const translate = useTranslation();
    const { message } = App.useApp();
    const [form] = Form.useForm<ProfileFormValues>();
    const avatarInputRef = useRef<HTMLInputElement>(null);
    const localAvatarPreviewUrlRef = useRef("");
    const setUser = useUserStore((state) => state.setUser);
    const [submitting, setSubmitting] = useState(false);
    const team = useTeamStore((state) => state.team);
    const [uploadingAvatar, setUploadingAvatar] = useState(false);
    const [selectedAvatarFile, setSelectedAvatarFile] = useState<File | null>(null);
    const [avatarPreview, setAvatarPreview] = useState(profile.avatar);
    const [passwordModalOpen, setPasswordModalOpen] = useState(false);

    const releaseLocalAvatarPreview = useCallback(() => {
        if (!localAvatarPreviewUrlRef.current) return;
        URL.revokeObjectURL(localAvatarPreviewUrlRef.current);
        localAvatarPreviewUrlRef.current = "";
    }, []);

    useEffect(() => {
        releaseLocalAvatarPreview();
        form.setFieldsValue(profile);
        setAvatarPreview(profile.avatar);
        setSelectedAvatarFile(null);
    }, [form, profile, releaseLocalAvatarPreview]);

    useEffect(() => () => releaseLocalAvatarPreview(), [releaseLocalAvatarPreview]);

    const selectAvatar = (file?: File) => {
        if (!file) return;
        if (!file.type.startsWith("image/")) {
            message.error(translate("profile.selectAnImageFile"));
            return;
        }
        if (file.size > MAX_AVATAR_FILE_SIZE) {
            message.error(translate("profile.avatarMustNotExceed2MB"));
            if (avatarInputRef.current) avatarInputRef.current.value = "";
            return;
        }
        releaseLocalAvatarPreview();
        const localPreview = URL.createObjectURL(file);
        localAvatarPreviewUrlRef.current = localPreview;
        setAvatarPreview(localPreview);
        setSelectedAvatarFile(file);
    };

    const saveProfile = async (values: ProfileFormValues) => {
        if (submitting || uploadingAvatar) return;
        setSubmitting(true);
        try {
            let avatar = values.avatar?.trim() || "";
            if (selectedAvatarFile) {
                setUploadingAvatar(true);
                const uploadedFile = await uploadMediaFile(selectedAvatarFile, "avatar");
                avatar = uploadedFile.url;
                form.setFieldValue("avatar", avatar);
                releaseLocalAvatarPreview();
                setAvatarPreview(avatar);
                setSelectedAvatarFile(null);
            }
            const nextProfile = await updateCurrentUserProfile({
                username: values.username.trim(),
                nickname: values.nickname?.trim() || "",
                avatar,
            });
            onProfileUpdated(nextProfile);
            setUser(nextProfile);
            message.success(translate("profile.profileSaved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("profile.failedToSaveProfile"));
        } finally {
            setUploadingAvatar(false);
            setSubmitting(false);
        }
    };

    return (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
            <section className="min-w-0">
                <div className="flex flex-wrap items-center gap-4 border-b border-[var(--studio-line)] pb-6">
                    <Avatar size={88} src={avatarPreview || undefined} alt={profile.nickname || profile.username}>
                        {profile.nickname || profile.username || "?"}
                    </Avatar>
                    <div className="min-w-0">
                        <div className="truncate text-base font-medium text-[var(--studio-ink)]">{profile.nickname || profile.username}</div>
                        <div className="mt-1 truncate text-sm text-[var(--studio-muted)]">{profile.email}</div>
                        <Button className="mt-3" icon={<Camera className="size-4" />} loading={uploadingAvatar} disabled={submitting} onClick={() => avatarInputRef.current?.click()}>
                            {translate("profile.changeAvatar")}</Button>
                    </div>
                </div>

                <Form form={form} initialValues={profile} layout="vertical" requiredMark={false} className="mt-6" onFinish={saveProfile}>
                    <Form.Item name="avatar" hidden>
                        <Input />
                    </Form.Item>
                    <Form.Item
                        name="username"
                        label={translate("profile.username")}
                        extra={translate("auth.usernameRule")}
                        rules={[
                            { required: true, whitespace: true, message: translate("profile.enterUsername") },
                            { max: 50, message: translate("profile.usernameMustNotExceed50Characters") },
                            { validator: (_, value: string) => !value || value.trim() === profile.username || !/[@\s]/u.test(value.trim()) ? Promise.resolve() : Promise.reject(new Error(translate("auth.usernameRule"))) },
                        ]}
                    >
                        <Input autoComplete="username" maxLength={50} placeholder={translate("profile.enterUsername")} />
                    </Form.Item>
                    <Form.Item name="nickname" label={translate("profile.displayName")} rules={[{ max: 50, message: translate("profile.displayNameMustNotExceed50Characters") }]}>
                        <Input autoComplete="nickname" maxLength={50} placeholder={translate("profile.enterADisplayName")} />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" icon={<Save className="size-4" />} loading={submitting} disabled={uploadingAvatar}>
                        {translate("profile.saveChanges")}</Button>
                </Form>
            </section>

            <section className="border-t border-[var(--studio-line)] pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
                <h2 className="studio-title text-base font-medium">{translate("profile.accountDetails")}</h2>
                <Descriptions className="mt-4" column={1} size="small" items={accountInformation(profile)} />
                <div className="mt-5 border-t border-[var(--studio-line)] pt-5">
                    <Button icon={<LockKeyhole className="size-4" />} onClick={() => setPasswordModalOpen(true)}>
                        {translate("profile.changePassword")}</Button>
                </div>
                {!team ? <InvitationLinkPanel /> : null}
            </section>
            <ChangePasswordModal open={passwordModalOpen} onClose={() => setPasswordModalOpen(false)} />
            <input
                ref={avatarInputRef}
                hidden
                type="file"
                accept="image/*"
                onChange={(event) => {
                    selectAvatar(event.target.files?.[0]);
                    event.target.value = "";
                }}
            />
        </div>
    );
}

/**
 * 仅在平台空间展示当前用户的专属邀请链接，不受其团队成员或管理员身份影响。
 *
 * @return 邀请链接面板
 */
function InvitationLinkPanel() {
    const translate = useTranslation();
    const copyText = useCopyText();
    const userId = useUserStore((state) => state.user?.id);
    const invitationQuery = useQuery({ queryKey: ["invitation-info", userId], queryFn: getInvitationInfo, enabled: Boolean(userId) });
    const invitationLink = invitationQuery.data && typeof window !== "undefined"
        ? `${window.location.origin}/auth?invitationCode=${encodeURIComponent(invitationQuery.data.invitationCode)}`
        : "";

    return (
        <div className="mt-5 border-t border-[var(--studio-line)] pt-5">
            <h2 className="studio-title text-base font-medium">{translate("profile.yourInvitationLink")}</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">{translate("profile.earnTheConfiguredReferralRewardWhenAFriendRegisters")}</p>
            {invitationQuery.isLoading ? <Skeleton.Input active block className="mt-3" /> : null}
            {invitationQuery.isError ? (
                <Alert
                    className="mt-3"
                    type="error"
                    showIcon
                    title={translate("profile.failedToLoadInvitationLink")}
                    action={<Button size="small" onClick={() => void invitationQuery.refetch()}>{translate("profile.retry")}</Button>}
                />
            ) : null}
            {invitationLink ? (
                <div className="mt-3 space-y-2">
                    <Input readOnly value={invitationLink} aria-label={translate("profile.yourInvitationLink")} />
                    <Button block icon={<Copy className="size-4" aria-hidden="true" />} onClick={() => copyText(invitationLink, translate("profile.invitationLinkCopied"))}>{translate("profile.copyInvitationLink")}</Button>
                </div>
            ) : null}
        </div>
    );
}

function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const translate = useTranslation();
    const { message } = App.useApp();
    const [form] = Form.useForm<PasswordFormValues>();
    const [submitting, setSubmitting] = useState(false);

    const closeModal = () => {
        if (submitting) return;
        form.resetFields();
        onClose();
    };

    const submitPassword = async (values: PasswordFormValues) => {
        setSubmitting(true);
        try {
            await changeCurrentUserPassword({ currentPassword: values.currentPassword, newPassword: values.newPassword });
            message.success(translate("profile.passwordChanged"));
            form.resetFields();
            onClose();
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("profile.failedToChangePassword"));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal
            title={translate("profile.changePassword")}
            open={open}
            onCancel={closeModal}
            onOk={() => form.submit()}
            okText={translate("profile.confirmChanges")}
            cancelText={translate("profile.cancel")}
            confirmLoading={submitting}
            cancelButtonProps={{ disabled: submitting }}
            destroyOnHidden
            width={480}
        >
            <Form form={form} layout="vertical" requiredMark={false} preserve={false} className="mt-5" onFinish={submitPassword}>
                <Form.Item name="currentPassword" label={translate("profile.currentPassword")} rules={[{ required: true, message: translate("profile.enterCurrentPassword") }]}>
                    <Input.Password autoComplete="current-password" placeholder={translate("profile.enterCurrentPassword")} />
                </Form.Item>
                <Form.Item
                    name="newPassword"
                    label={translate("profile.newPassword")}
                    rules={[
                        { required: true, message: translate("profile.enterANewPassword") },
                        { min: 8, message: translate("profile.newPasswordNeedsAtLeast8Characters") },
                    ]}
                >
                    <Input.Password autoComplete="new-password" placeholder={translate("profile.atLeast8Characters")} />
                </Form.Item>
                <Form.Item
                    name="confirmPassword"
                    label={translate("profile.confirmNewPassword")}
                    dependencies={["newPassword"]}
                    rules={[
                        { required: true, message: translate("profile.reEnterNewPassword") },
                        ({ getFieldValue }) => ({
                            validator(_, value) {
                                return !value || getFieldValue("newPassword") === value ? Promise.resolve() : Promise.reject(new Error(translate("profile.newPasswordsDoNotMatch")));
                            },
                        }),
                    ]}
                >
                    <Input.Password autoComplete="new-password" placeholder={translate("profile.reEnterNewPassword")} />
                </Form.Item>
            </Form>
        </Modal>
    );
}

function ProfileSkeleton() {
    return (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
            <section>
                <div className="flex items-center gap-4 border-b border-[var(--studio-line)] pb-6">
                    <Skeleton.Avatar active size={88} />
                    <Skeleton active paragraph={{ rows: 2, width: [180, 120] }} title={false} />
                </div>
                <Skeleton active className="mt-6" paragraph={{ rows: 5 }} title={false} />
            </section>
            <section className="border-t border-[var(--studio-line)] pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
                <Skeleton active paragraph={{ rows: 6 }} title={{ width: 96 }} />
            </section>
        </div>
    );
}

function accountInformation(profile: ServerUserProfile) {
    return [
        { key: "email", label: translate("profile.email"), children: profile.email || translate("administration.noEmail") },
        { key: "id", label: translate("profile.userID"), children: String(profile.id) },
        { key: "role", label: translate("profile.character"), children: profile.role === "admin" ? translate("profile.administrator") : translate("profile.user") },
        { key: "credit", label: translate("profile.availableCredits"), children: Number(profile.creditBalance || 0).toLocaleString(currentLanguageTag()) },
        { key: "created", label: translate("profile.registeredAt"), children: formatProfileTime(profile.createdAt) },
        { key: "lastLogin", label: translate("profile.lastSignIn"), children: formatProfileTime(profile.lastLoginAt) },
    ];
}

function formatProfileTime(value: string) {
    const time = Date.parse(value);
    return Number.isNaN(time) ? translate("profile.noRecords") : new Date(time).toLocaleString(currentLanguageTag(), { hour12: false });
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, App, Avatar, Button, Descriptions, Form, Input, Modal, Skeleton } from "antd";
import { Camera, LockKeyhole, LogIn, Save } from "lucide-react";

import { changeCurrentUserPassword, getCurrentUserInfo, updateCurrentUserProfile } from "@/services/api/server";
import { uploadMediaFile } from "@/features/storage/services/file-storage";
import { useUserStore, type ServerUserProfile } from "@/features/auth/stores/use-user-store";

type ProfileFormValues = Pick<ServerUserProfile, "username" | "nickname" | "avatar">;
type PasswordFormValues = { currentPassword: string; newPassword: string; confirmPassword: string };

const MAX_AVATAR_FILE_SIZE = 2 * 1024 * 1024;

export default function ProfilePage() {
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
                if (!cancelled) setLoadError(error instanceof Error ? error.message : "个人信息加载失败");
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
                    <h1 className="studio-title text-2xl font-semibold">个人信息</h1>
                    <p className="studio-subtitle mt-2 text-sm">管理账号展示资料与头像。</p>
                </header>

                {!hydrated || loading ? <ProfileSkeleton /> : null}
                {hydrated && !user ? (
                    <section className="flex min-h-72 flex-col items-center justify-center text-center">
                        <h2 className="studio-title text-lg font-medium">登录后管理个人信息</h2>
                        <p className="studio-subtitle mt-2 text-sm">头像、昵称和用户名会显示在创作工作台中。</p>
                        <Button type="primary" className="mt-5" icon={<LogIn className="size-4" />} onClick={() => openAuthModal("/profile")}>
                            登录
                        </Button>
                    </section>
                ) : null}
                {loadError ? (
                    <Alert
                        type="error"
                        showIcon
                        message="个人信息加载失败"
                        description={loadError}
                        action={
                            <Button size="small" onClick={() => setReloadVersion((value) => value + 1)}>
                                重新加载
                            </Button>
                        }
                    />
                ) : null}
                {user && profile && !loading ? <ProfileEditor profile={profile} onProfileUpdated={setProfile} /> : null}
            </div>
        </main>
    );
}

function ProfileEditor({ profile, onProfileUpdated }: { profile: ServerUserProfile; onProfileUpdated: (profile: ServerUserProfile) => void }) {
    const { message } = App.useApp();
    const [form] = Form.useForm<ProfileFormValues>();
    const avatarInputRef = useRef<HTMLInputElement>(null);
    const localAvatarPreviewUrlRef = useRef("");
    const setUser = useUserStore((state) => state.setUser);
    const [submitting, setSubmitting] = useState(false);
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
            message.error("请选择图片文件");
            return;
        }
        if (file.size > MAX_AVATAR_FILE_SIZE) {
            message.error("头像图片不能超过 2MB");
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
            message.success("个人信息已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "个人信息保存失败");
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
                            更换头像
                        </Button>
                    </div>
                </div>

                <Form form={form} initialValues={profile} layout="vertical" requiredMark={false} className="mt-6" onFinish={saveProfile}>
                    <Form.Item name="avatar" hidden>
                        <Input />
                    </Form.Item>
                    <Form.Item
                        name="username"
                        label="用户名"
                        rules={[
                            { required: true, whitespace: true, message: "请输入用户名" },
                            { max: 50, message: "用户名不能超过 50 个字符" },
                        ]}
                    >
                        <Input autoComplete="username" maxLength={50} placeholder="请输入用户名" />
                    </Form.Item>
                    <Form.Item name="nickname" label="昵称" rules={[{ max: 50, message: "昵称不能超过 50 个字符" }]}>
                        <Input autoComplete="nickname" maxLength={50} placeholder="请输入昵称" />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" icon={<Save className="size-4" />} loading={submitting} disabled={uploadingAvatar}>
                        保存更改
                    </Button>
                </Form>
            </section>

            <section className="border-t border-[var(--studio-line)] pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
                <h2 className="studio-title text-base font-medium">账号信息</h2>
                <Descriptions className="mt-4" column={1} size="small" items={accountInformation(profile)} />
                <div className="mt-5 border-t border-[var(--studio-line)] pt-5">
                    <Button icon={<LockKeyhole className="size-4" />} onClick={() => setPasswordModalOpen(true)}>
                        修改密码
                    </Button>
                </div>
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

function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
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
            message.success("密码已修改");
            form.resetFields();
            onClose();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "密码修改失败");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal
            title="修改密码"
            open={open}
            onCancel={closeModal}
            onOk={() => form.submit()}
            okText="确认修改"
            cancelText="取消"
            confirmLoading={submitting}
            cancelButtonProps={{ disabled: submitting }}
            destroyOnHidden
            width={480}
        >
            <Form form={form} layout="vertical" requiredMark={false} preserve={false} className="mt-5" onFinish={submitPassword}>
                <Form.Item name="currentPassword" label="原密码" rules={[{ required: true, message: "请输入原密码" }]}>
                    <Input.Password autoComplete="current-password" placeholder="请输入原密码" />
                </Form.Item>
                <Form.Item
                    name="newPassword"
                    label="新密码"
                    rules={[
                        { required: true, message: "请输入新密码" },
                        { min: 8, message: "新密码至少需要 8 位" },
                    ]}
                >
                    <Input.Password autoComplete="new-password" placeholder="至少 8 位" />
                </Form.Item>
                <Form.Item
                    name="confirmPassword"
                    label="确认新密码"
                    dependencies={["newPassword"]}
                    rules={[
                        { required: true, message: "请再次输入新密码" },
                        ({ getFieldValue }) => ({
                            validator(_, value) {
                                return !value || getFieldValue("newPassword") === value ? Promise.resolve() : Promise.reject(new Error("两次输入的新密码不一致"));
                            },
                        }),
                    ]}
                >
                    <Input.Password autoComplete="new-password" placeholder="请再次输入新密码" />
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
        { key: "email", label: "邮箱", children: profile.email },
        { key: "id", label: "用户 ID", children: String(profile.id) },
        { key: "role", label: "角色", children: profile.role === "admin" ? "管理员" : "普通用户" },
        { key: "credit", label: "可用积分", children: Number(profile.creditBalance || 0).toLocaleString("zh-CN") },
        { key: "created", label: "注册时间", children: formatProfileTime(profile.createdAt) },
        { key: "lastLogin", label: "最后登录", children: formatProfileTime(profile.lastLoginAt) },
    ];
}

function formatProfileTime(value: string) {
    const time = Date.parse(value);
    return Number.isNaN(time) ? "暂无记录" : new Date(time).toLocaleString("zh-CN", { hour12: false });
}

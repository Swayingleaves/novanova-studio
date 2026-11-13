"use client";

import { useTranslation } from "@/features/locale/use-translation";

import { App, Button, Form, Input, Tooltip } from "antd";
import { ExternalLink, ImageIcon, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { uploadImage } from "@/features/storage/services/image-storage";
import type { ExternalLinkDraft } from "../external-link-config";

type ExternalLinkConfigManagementProps = {
    /** 当前草稿。 */
    draft: ExternalLinkDraft;
    /** 草稿是否与已保存配置不同。 */
    dirty: boolean;
    /** 是否正在保存。 */
    saving: boolean;
    onChange: (draft: ExternalLinkDraft) => void;
    onSave: () => void;
    onClear: () => void;
};

/**
 * 管理右上角展示外链配置。
 *
 * @returns 标题、链接、说明与封面的编辑表单
 */
export function ExternalLinkConfigManagement({ draft, dirty, saving, onChange, onSave, onClear }: ExternalLinkConfigManagementProps) {
    const translate = useTranslation();
    const { message, modal } = App.useApp();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);

    const update = (patch: Partial<ExternalLinkDraft>) => onChange({ ...draft, ...patch });

    const uploadCover = async (file: File | undefined) => {
        if (!file) return;
        setUploading(true);
        try {
            const uploaded = await uploadImage(file, { compress: true });
            update({ coverUrl: uploaded.url });
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("administration.externalLinkCoverUploadFailed"));
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="min-w-0">
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    void uploadCover(file);
                }}
            />
            <Form layout="vertical" requiredMark={false} className="max-w-4xl">
                <div className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-sm font-semibold">
                                <ExternalLink className="size-4" aria-hidden="true" />
                                {translate("administration.externalLinkConfig")}
                            </div>
                            <div className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">{translate("administration.externalLinkConfigHint")}</div>
                        </div>
                        <div className="flex shrink-0 gap-2">
                            <Button type="primary" disabled={!dirty || saving} loading={saving} onClick={onSave}>
                                {translate("appShell.save")}
                            </Button>
                            <Button
                                danger
                                disabled={saving || !draft.title.trim()}
                                onClick={() =>
                                    modal.confirm({
                                        title: translate("administration.externalLinkRemove"),
                                        content: translate("administration.externalLinkRemoveConfirm"),
                                        okText: translate("administration.externalLinkRemove"),
                                        okType: "danger",
                                        cancelText: translate("administration.cancel"),
                                        onOk: onClear,
                                    })
                                }
                            >
                                {translate("administration.externalLinkRemove")}
                            </Button>
                        </div>
                    </div>

                    <div className="mt-5 grid gap-x-6 gap-y-4 md:grid-cols-2">
                        <Form.Item label={<span className="block">{translate("administration.externalLinkTitle")}</span>} className="mb-0">
                            <Input
                                value={draft.title}
                                maxLength={80}
                                disabled={saving}
                                placeholder={translate("administration.externalLinkTitlePlaceholder")}
                                onChange={(event) => update({ title: event.target.value })}
                            />
                        </Form.Item>
                        <Form.Item
                            label={<span className="block">{translate("administration.externalLinkUrl")}</span>}
                            extra={translate("administration.externalLinkUrlHint")}
                            className="mb-0"
                        >
                            <Input value={draft.url} maxLength={2048} disabled={saving} placeholder="https://..." onChange={(event) => update({ url: event.target.value })} />
                        </Form.Item>
                    </div>

                    <Form.Item label={<span className="block">{translate("administration.externalLinkCover")}</span>} extra={translate("administration.externalLinkCoverHint")} className="mb-0 mt-4">
                        <div className="flex flex-wrap items-start gap-3">
                            <div className="flex aspect-video w-32 shrink-0 items-center justify-center overflow-hidden rounded-md border border-[var(--studio-line)] bg-white">
                                {draft.coverUrl ? (
                                    <img src={draft.coverUrl} alt="" className="size-full object-contain" />
                                ) : (
                                    <ImageIcon className="size-5 text-[var(--studio-muted)]" aria-hidden="true" />
                                )}
                            </div>
                            <Input
                                value={draft.coverUrl}
                                maxLength={2048}
                                disabled={saving}
                                placeholder="https://..."
                                className="min-w-0 flex-1"
                                onChange={(event) => update({ coverUrl: event.target.value })}
                            />
                            <Tooltip title={translate("administration.externalLinkUploadCover")}>
                                <Button
                                    icon={<Upload className="size-4" />}
                                    loading={uploading}
                                    disabled={saving}
                                    aria-label={translate("administration.externalLinkUploadCover")}
                                    onClick={() => fileInputRef.current?.click()}
                                />
                            </Tooltip>
                        </div>
                    </Form.Item>

                    <Form.Item label={<span className="block">{translate("administration.externalLinkDescription")}</span>} className="mb-0 mt-4">
                        <Input.TextArea
                            value={draft.description}
                            maxLength={1000}
                            rows={4}
                            showCount
                            disabled={saving}
                            placeholder={translate("administration.externalLinkDescriptionPlaceholder")}
                            onChange={(event) => update({ description: event.target.value })}
                        />
                    </Form.Item>
                </div>
            </Form>
        </div>
    );
}

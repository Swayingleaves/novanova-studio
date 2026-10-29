"use client";

import { useTranslation } from "@/features/locale/use-translation";

import { App, Button, Form, Input, Tooltip } from "antd";
import { ChevronDown, ChevronUp, GripVertical, ImageIcon, Plus, QrCode, Trash2, Upload } from "lucide-react";
import { nanoid } from "nanoid";
import { useRef, useState } from "react";

import { uploadImage } from "@/features/storage/services/image-storage";
import { COMMUNITY_CONFIG_LIMIT, type CommunityConfigDraft } from "./community-config";

type CommunityConfigManagementProps = {
    /** 当前草稿列表，顺序即展示顺序。 */
    items: CommunityConfigDraft[];
    /** 草稿是否与已保存配置不同。 */
    dirty: boolean;
    /** 是否正在保存。 */
    saving: boolean;
    onChange: (items: CommunityConfigDraft[]) => void;
    onSave: () => void;
};

/**
 * 管理平台全局社群二维码配置。
 *
 * @returns 社群草稿列表、图片上传与排序操作
 */
export function CommunityConfigManagement({ items, dirty, saving, onChange, onSave }: CommunityConfigManagementProps) {
    const translate = useTranslation();
    const { message, modal } = App.useApp();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const uploadTargetRef = useRef("");
    const [uploadingId, setUploadingId] = useState("");
    const [draggingId, setDraggingId] = useState("");
    const [dropTargetId, setDropTargetId] = useState("");

    const updateItem = (id: string, patch: Partial<CommunityConfigDraft>) => {
        onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    };

    const addItem = () => {
        if (items.length >= COMMUNITY_CONFIG_LIMIT) {
            message.warning(translate("administration.communityLimit", { value0: COMMUNITY_CONFIG_LIMIT }));
            return;
        }
        onChange([...items, { id: `community-draft-${nanoid()}`, name: "", imageUrl: "" }]);
    };

    const removeItem = (item: CommunityConfigDraft) => {
        modal.confirm({
            title: translate("administration.delete"),
            content: translate("administration.communityDeleteConfirm"),
            okText: translate("administration.delete"),
            okType: "danger",
            cancelText: translate("administration.cancel"),
            onOk: () => onChange(items.filter((current) => current.id !== item.id)),
        });
    };

    const moveItem = (from: number, to: number) => {
        if (from === to || to < 0 || to >= items.length) return;
        const next = [...items];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        onChange(next);
    };

    const dropOnItem = (targetId: string) => {
        const from = items.findIndex((item) => item.id === draggingId);
        const to = items.findIndex((item) => item.id === targetId);
        setDraggingId("");
        setDropTargetId("");
        if (from < 0 || to < 0) return;
        moveItem(from, to);
    };

    const pickImage = (id: string) => {
        uploadTargetRef.current = id;
        fileInputRef.current?.click();
    };

    const uploadSelectedImage = async (file: File | undefined) => {
        if (!file) return;
        const targetId = uploadTargetRef.current;
        setUploadingId(targetId);
        try {
            const uploaded = await uploadImage(file);
            updateItem(targetId, { imageUrl: uploaded.url });
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("administration.communityImageUploadFailed"));
        } finally {
            setUploadingId("");
            uploadTargetRef.current = "";
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
                    void uploadSelectedImage(file);
                }}
            />
            <Form layout="vertical" requiredMark={false}>
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-3">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm font-semibold">
                            <QrCode className="size-4" aria-hidden="true" />
                            {translate("administration.communityConfig")}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">{translate("administration.communityConfigHint")}</div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                        <Button type="primary" disabled={!dirty || saving} loading={saving} onClick={onSave}>
                            {translate("appShell.save")}
                        </Button>
                        <Button icon={<Plus className="size-4" />} disabled={saving || items.length >= COMMUNITY_CONFIG_LIMIT} onClick={addItem}>
                            {translate("administration.communityAdd")}
                        </Button>
                    </div>
                </div>

                {items.length ? (
                    <div className="space-y-3">
                        {items.map((item, index) => (
                            <section
                                key={item.id}
                                className={`rounded-lg border bg-[var(--studio-panel)] p-3 transition ${dropTargetId === item.id ? "border-[var(--studio-action)]" : "border-[var(--studio-line)]"} ${draggingId === item.id ? "opacity-60" : ""}`}
                                onDragOver={(event) => {
                                    if (!draggingId) return;
                                    event.preventDefault();
                                    setDropTargetId(item.id);
                                }}
                                onDragLeave={(event) => {
                                    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                                    setDropTargetId((current) => (current === item.id ? "" : current));
                                }}
                                onDrop={(event) => {
                                    event.preventDefault();
                                    dropOnItem(item.id);
                                }}
                            >
                                <div className="flex flex-wrap items-start gap-3">
                                    <span
                                        draggable
                                        title={translate("administration.communityDragHint")}
                                        className="mt-1 inline-flex size-7 shrink-0 cursor-grab items-center justify-center rounded-md text-[var(--studio-muted)] transition hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)] active:cursor-grabbing"
                                        onDragStart={(event) => {
                                            setDraggingId(item.id);
                                            event.dataTransfer.effectAllowed = "move";
                                        }}
                                        onDragEnd={() => {
                                            setDraggingId("");
                                            setDropTargetId("");
                                        }}
                                    >
                                        <GripVertical className="size-4" aria-hidden="true" />
                                    </span>
                                    <div className="flex aspect-square w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-[var(--studio-line)] bg-white">
                                        {item.imageUrl ? (
                                            <img src={item.imageUrl} alt="" className="size-full object-contain" />
                                        ) : (
                                            <ImageIcon className="size-5 text-[var(--studio-muted)]" aria-hidden="true" />
                                        )}
                                    </div>
                                    <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
                                        <Form.Item label={translate("administration.communityName")} className="mb-0">
                                            <Input
                                                value={item.name}
                                                maxLength={60}
                                                disabled={saving}
                                                placeholder={translate("administration.communityNamePlaceholder")}
                                                onChange={(event) => updateItem(item.id, { name: event.target.value })}
                                            />
                                        </Form.Item>
                                        <Form.Item label={translate("administration.communityImageUrl")} className="mb-0">
                                            <Input
                                                value={item.imageUrl}
                                                maxLength={2048}
                                                disabled={saving}
                                                placeholder="https://..."
                                                onChange={(event) => updateItem(item.id, { imageUrl: event.target.value })}
                                            />
                                        </Form.Item>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                        <Tooltip title={translate("administration.uploadImage")}>
                                            <Button
                                                size="small"
                                                icon={<Upload className="size-3.5" />}
                                                disabled={saving}
                                                loading={uploadingId === item.id}
                                                aria-label={translate("administration.uploadImage")}
                                                onClick={() => pickImage(item.id)}
                                            />
                                        </Tooltip>
                                        <Tooltip title={translate("administration.communityMoveUp")}>
                                            <Button
                                                size="small"
                                                icon={<ChevronUp className="size-3.5" />}
                                                disabled={saving || index === 0}
                                                aria-label={translate("administration.communityMoveUp")}
                                                onClick={() => moveItem(index, index - 1)}
                                            />
                                        </Tooltip>
                                        <Tooltip title={translate("administration.communityMoveDown")}>
                                            <Button
                                                size="small"
                                                icon={<ChevronDown className="size-3.5" />}
                                                disabled={saving || index === items.length - 1}
                                                aria-label={translate("administration.communityMoveDown")}
                                                onClick={() => moveItem(index, index + 1)}
                                            />
                                        </Tooltip>
                                        <Tooltip title={translate("administration.delete")}>
                                            <Button
                                                size="small"
                                                danger
                                                icon={<Trash2 className="size-3.5" />}
                                                disabled={saving}
                                                aria-label={translate("administration.delete")}
                                                onClick={() => removeItem(item)}
                                            />
                                        </Tooltip>
                                    </div>
                                </div>
                            </section>
                        ))}
                    </div>
                ) : (
                    <div className="studio-empty flex min-h-44 flex-col items-center justify-center gap-3 rounded-lg text-sm">
                        <span>{translate("administration.communityEmpty")}</span>
                        <Button icon={<Plus className="size-4" />} disabled={saving} onClick={addItem}>
                            {translate("administration.communityAdd")}
                        </Button>
                    </div>
                )}
            </Form>
        </div>
    );
}

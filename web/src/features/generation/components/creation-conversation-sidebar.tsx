"use client";

import type { MenuProps } from "antd";
import { App, Button, Checkbox, Dropdown, Input, Modal, Tooltip } from "antd";
import { CheckSquare, LoaderCircle, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import type { CreationConversationItem, CreationSidebarProps } from "@/features/generation/components/creation-workspace-types";
import { MAX_CONVERSATION_TITLE_LENGTH, normalizeConversationTitle, validateConversationTitle } from "@/features/generation/lib/conversation-title";

type CreationConversationSidebarProps = CreationSidebarProps & {
    compact?: boolean;
};

type RenameTarget = {
    id: string;
    title: string;
};

export function CreationConversationSidebar({
    items,
    managementMode,
    hasSelection,
    onCreate,
    onToggleManagement,
    onToggleSelectAll,
    onDeleteSelected,
    onSelectConversation,
    onToggleConversation,
    onRenameConversation,
    onDeleteConversation,
    compact = false,
}: CreationConversationSidebarProps) {
    const { message, modal } = App.useApp();
    const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
    const [renameTitle, setRenameTitle] = useState("");
    const [renameError, setRenameError] = useState("");
    const [renaming, setRenaming] = useState(false);

    const openRenameDialog = (item: CreationConversationItem) => {
        setRenameTarget({ id: item.id, title: item.title });
        setRenameTitle(item.title);
        setRenameError("");
    };

    const closeRenameDialog = () => {
        if (renaming) {
            return;
        }
        setRenameTarget(null);
        setRenameTitle("");
        setRenameError("");
    };

    const submitRename = async () => {
        if (!renameTarget) {
            return;
        }
        const nextError = validateConversationTitle(renameTitle);
        if (nextError) {
            setRenameError(nextError);
            return;
        }
        const normalizedTitle = normalizeConversationTitle(renameTitle);
        setRenaming(true);
        try {
            await onRenameConversation(renameTarget.id, normalizedTitle);
            setRenameTarget(null);
            setRenameTitle("");
            setRenameError("");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "修改标题失败";
            setRenameError(errorMessage);
            message.error(errorMessage);
        } finally {
            setRenaming(false);
        }
    };

    const requestDelete = (item: CreationConversationItem) => {
        modal.confirm({
            title: "删除记录",
            content: `确定删除“${item.title}”吗？删除后无法恢复。`,
            okText: "删除",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    await onDeleteConversation(item.id);
                    message.success("记录已删除");
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "删除记录失败");
                    throw error;
                }
            },
        });
    };

    return (
        <>
            <div className={`flex h-full min-h-0 flex-col ${compact ? "" : "p-4"}`}>
                <div className="mb-4 flex items-center justify-between gap-3">
                    <Tooltip title="新建对话">
                        <Button type="text" size="small" className="!h-8 !w-8 !rounded-lg !p-0" icon={<Plus className="size-4" />} onClick={onCreate} aria-label="新建对话" />
                    </Tooltip>
                    <Button type="text" size="small" className="!h-8 !w-8 !rounded-lg !p-0" icon={managementMode ? <CheckSquare className="size-4" /> : <MoreHorizontal className="size-4" />} onClick={onToggleManagement} />
                </div>

                <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-xs font-medium text-[var(--studio-muted)]">最近</div>
                    {items.length ? <div className="text-xs text-[var(--studio-faint)]">{items.length}</div> : null}
                </div>

                {managementMode ? (
                    <div className="mb-3 flex flex-wrap gap-2">
                        <Button size="small" className="!rounded-[6px]" onClick={onToggleSelectAll}>
                            全选
                        </Button>
                        <Button size="small" danger className="!rounded-[6px]" icon={<Trash2 className="size-3.5" />} disabled={!hasSelection} onClick={onDeleteSelected}>
                            删除已选
                        </Button>
                    </div>
                ) : null}

                <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
                    {items.length ? (
                        <div className="space-y-1.5">
                            {items.map((item) => (
                                <ConversationItem
                                    key={item.id}
                                    item={item}
                                    enableContextMenu={!compact}
                                    managementMode={managementMode}
                                    onSelectConversation={onSelectConversation}
                                    onToggleConversation={onToggleConversation}
                                    onRequestRename={openRenameDialog}
                                    onRequestDelete={requestDelete}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="py-12 text-center text-sm text-[var(--studio-faint)]">暂无对话</div>
                    )}
                </div>
            </div>
            <Modal title="修改标题" open={Boolean(renameTarget)} onCancel={closeRenameDialog} onOk={() => void submitRename()} okText="保存" cancelText="取消" confirmLoading={renaming} destroyOnHidden>
                <div className="space-y-3 pt-2">
                    <Input
                        value={renameTitle}
                        autoFocus
                        status={renameError ? "error" : undefined}
                        placeholder="请输入对话标题"
                        onChange={(event) => {
                            setRenameTitle(event.target.value);
                            if (renameError) {
                                setRenameError("");
                            }
                        }}
                        onPressEnter={() => {
                            if (!renaming) {
                                void submitRename();
                            }
                        }}
                    />
                    <div className="flex items-center justify-between gap-3 text-xs">
                        <span className={renameError ? "text-red-500" : "text-[var(--studio-muted)]"}>{renameError || "标题修改后会立即同步到最近对话列表。"}</span>
                        <span className="shrink-0 text-[var(--studio-faint)]">
                            {normalizeConversationTitle(renameTitle).length}/{MAX_CONVERSATION_TITLE_LENGTH}
                        </span>
                    </div>
                </div>
            </Modal>
        </>
    );
}

function ConversationItem({
    item,
    enableContextMenu,
    managementMode,
    onSelectConversation,
    onToggleConversation,
    onRequestRename,
    onRequestDelete,
}: {
    item: CreationConversationItem;
    enableContextMenu: boolean;
    managementMode: boolean;
    onSelectConversation: (id: string) => void;
    onToggleConversation: (id: string, checked: boolean) => void;
    onRequestRename: (item: CreationConversationItem) => void;
    onRequestDelete: (item: CreationConversationItem) => void;
}) {
    const activeClassName = item.active ? "bg-[var(--studio-primary-soft)] ring-1 ring-[var(--studio-primary-line)]" : "hover:bg-[var(--studio-surface-hover)] hover:-translate-y-0.5 hover:border-[var(--studio-primary-line)]";
    const conversationMenuItems: MenuProps["items"] = [
        {
            key: "rename",
            label: "修改标题",
            icon: <Pencil className="size-3.5" />,
        },
        {
            key: "delete",
            label: item.status === "running" ? "生成中不可删除" : "删除记录",
            danger: true,
            disabled: item.status === "running",
            icon: <Trash2 className="size-3.5" />,
        },
    ];

    const itemContent = (
        <div className={`group flex w-full items-center gap-2 rounded-[6px] border border-transparent px-3 py-2.5 text-left transition-all duration-200 ease-out ${activeClassName}`}>
            <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => onSelectConversation(item.id)}>
                {managementMode ? <Checkbox className="shrink-0" checked={item.selected} onClick={(event) => event.stopPropagation()} onChange={(event) => onToggleConversation(item.id, event.target.checked)} /> : null}
                {item.preview ? <div className="shrink-0 overflow-hidden rounded-[6px] transition-transform duration-200 ease-out group-hover:scale-105">{item.preview}</div> : null}
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-[var(--studio-ink)]">{item.title}</div>
                    <div className="mt-1 truncate text-xs text-[var(--studio-muted)]">{item.subtitle}</div>
                </div>
            </button>
            {managementMode ? null : <ConversationStatus status={item.status} />}
            {managementMode ? null : (
                <Dropdown
                    trigger={["click"]}
                    menu={{
                        items: conversationMenuItems,
                        onClick: ({ key }) => {
                            if (key === "rename") {
                                onRequestRename(item);
                            } else if (key === "delete") {
                                onRequestDelete(item);
                            }
                        },
                    }}
                >
                    <button
                        type="button"
                        className="grid size-8 shrink-0 place-items-center rounded-[6px] text-[var(--studio-muted)] transition hover:bg-[var(--studio-surface-hover)] lg:hidden"
                        aria-label={`更多操作：${item.title}`}
                        onClick={(event) => {
                            event.stopPropagation();
                        }}
                    >
                        <MoreHorizontal className="size-4" />
                    </button>
                </Dropdown>
            )}
        </div>
    );

    if (managementMode || !enableContextMenu) {
        return itemContent;
    }

    return (
        <Dropdown
            trigger={["contextMenu"]}
            menu={{
                items: conversationMenuItems,
                onClick: ({ key }) => {
                    if (key === "rename") {
                        onRequestRename(item);
                    } else if (key === "delete") {
                        onRequestDelete(item);
                    }
                },
            }}
        >
            {itemContent}
        </Dropdown>
    );
}

function ConversationStatus({ status }: { status: CreationConversationItem["status"] }) {
    if (status === "running") {
        return <LoaderCircle className="size-4 shrink-0 animate-spin text-[var(--studio-primary)]" aria-label="生成中" />;
    }
    if (status === "unreadSuccess") {
        return <span className="size-2 shrink-0 rounded-full bg-blue-500" aria-label="生成完成" />;
    }
    if (status === "unreadFailed") {
        return <span className="size-2 shrink-0 rounded-full bg-red-500" aria-label="生成失败" />;
    }
    return null;
}

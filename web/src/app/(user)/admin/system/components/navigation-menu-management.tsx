"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, App, Button, ColorPicker, Input, Modal, Skeleton, Switch, Tooltip } from "antd";
import { ChevronDown, ChevronUp, GripVertical, PanelLeft, Pencil, RotateCcw, Search, Users } from "lucide-react";

import { useTranslation } from "@/features/locale/use-translation";
import {
    configurableNavigationTools,
    defaultNavigationMenuDrafts,
    mergeNavigationMenuConfigs,
    navigationMenuDraftSignature,
} from "@/features/navigation-menu/lib/navigation-menu-config";
import {
    NAVIGATION_BADGE_COLOR_PRESETS,
    NAVIGATION_BADGE_TEXT_PRESETS,
    NAVIGATION_MENU_ICON_OPTIONS,
    resolveNavigationMenuIcon,
} from "@/features/navigation-menu/lib/navigation-menu-icons";
import { useNavigationMenuStore } from "@/features/navigation-menu/stores/use-navigation-menu-store";
import {
    listNavigationMenuConfigs,
    saveNavigationMenuConfigs,
    type NavigationMenuConfigInput,
} from "@/services/api/navigation-menu";
import { cn } from "@/shared/lib/utils";

const configurableToolBySlug = new Map(configurableNavigationTools.map((tool) => [tool.slug, tool]));

type MenuAppearanceDraft = {
    menuKey: string;
    displayName: string;
    iconKey: string | null;
    badgeText: string;
    badgeColor: string | null;
};

/**
 * 平台管理员左侧导航菜单管理组件，支持显隐、拖拽/按钮排序以及自定义名称、图标与角标外观。
 *
 * @returns 左侧导航菜单配置界面
 */
export function NavigationMenuManagement() {
    const translate = useTranslation();
    const { message } = App.useApp();
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [baseline, setBaseline] = useState<NavigationMenuConfigInput[]>(() => defaultNavigationMenuDrafts());
    const [draft, setDraft] = useState<NavigationMenuConfigInput[]>(() => defaultNavigationMenuDrafts());
    const [draggingKey, setDraggingKey] = useState("");
    const [dropTargetKey, setDropTargetKey] = useState("");
    const [editing, setEditing] = useState<MenuAppearanceDraft | null>(null);
    const [iconSearch, setIconSearch] = useState("");

    const loadConfigs = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const configs = await listNavigationMenuConfigs();
            const merged = mergeNavigationMenuConfigs(configs || []);
            setBaseline(merged);
            setDraft(merged);
        } catch (error) {
            setLoadError(error instanceof Error ? error.message : translate("administration.menuLoadFailed"));
        } finally {
            setLoading(false);
        }
    }, [translate]);

    useEffect(() => {
        void loadConfigs();
    }, [loadConfigs]);

    const dirty = navigationMenuDraftSignature(draft) !== navigationMenuDraftSignature(baseline);
    const isDefault = navigationMenuDraftSignature(draft) === navigationMenuDraftSignature(defaultNavigationMenuDrafts());

    const toggleItem = (menuKey: string, enabled: boolean) => {
        setDraft((current) => current.map((item) => (item.menuKey === menuKey ? { ...item, enabled } : item)));
    };

    const moveItem = (fromIndex: number, toIndex: number) => {
        if (fromIndex === toIndex || toIndex < 0 || toIndex >= draft.length) return;
        setDraft((current) => {
            const next = [...current];
            const [moved] = next.splice(fromIndex, 1);
            next.splice(toIndex, 0, moved);
            return next;
        });
    };

    const dropOnItem = (targetKey: string) => {
        const fromIndex = draft.findIndex((item) => item.menuKey === draggingKey);
        const toIndex = draft.findIndex((item) => item.menuKey === targetKey);
        setDraggingKey("");
        setDropTargetKey("");
        if (fromIndex < 0 || toIndex < 0) return;
        moveItem(fromIndex, toIndex);
    };

    const resetToDefault = () => {
        setDraft(defaultNavigationMenuDrafts());
    };

    const openEditor = (item: NavigationMenuConfigInput) => {
        setIconSearch("");
        setEditing({
            menuKey: item.menuKey,
            displayName: item.displayName || "",
            iconKey: item.iconKey || null,
            badgeText: item.badgeText || "",
            badgeColor: item.badgeColor || null,
        });
    };

    const applyEditor = () => {
        if (!editing) return;
        const normalizedDisplayName = editing.displayName.trim() || null;
        const normalizedBadgeText = editing.badgeText.trim() || null;
        const normalizedBadgeColor = editing.badgeColor?.trim() || null;
        setDraft((current) =>
            current.map((item) =>
                item.menuKey === editing.menuKey
                    ? {
                          ...item,
                          displayName: normalizedDisplayName,
                          iconKey: editing.iconKey || null,
                          badgeText: normalizedBadgeText,
                          badgeColor: normalizedBadgeColor,
                      }
                    : item,
            ),
        );
        setEditing(null);
    };

    const resetEditingAppearance = () => {
        if (!editing) return;
        const tool = configurableToolBySlug.get(editing.menuKey);
        setEditing({
            menuKey: editing.menuKey,
            displayName: "",
            iconKey: null,
            badgeText: tool?.isNew ? "NEW" : "",
            badgeColor: null,
        });
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await saveNavigationMenuConfigs(draft);
            setBaseline(draft);
            useNavigationMenuStore.getState().setConfigsFromInputs(draft);
            message.success(translate("administration.menuSaved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("administration.menuSaveFailed"));
        } finally {
            setSaving(false);
        }
    };

    const filteredIcons = useMemo(() => {
        const keyword = iconSearch.trim().toLowerCase();
        if (!keyword) return NAVIGATION_MENU_ICON_OPTIONS;
        return NAVIGATION_MENU_ICON_OPTIONS.filter(
            (option) =>
                option.key.includes(keyword) ||
                option.label.toLowerCase().includes(keyword) ||
                option.keywords.toLowerCase().includes(keyword),
        );
    }, [iconSearch]);

    const editingTool = editing ? configurableToolBySlug.get(editing.menuKey) : undefined;
    const PreviewIcon = editing && editingTool ? resolveNavigationMenuIcon(editing.iconKey, editingTool.icon) : null;

    return (
        <div className="min-w-0 max-w-4xl">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-3">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[var(--studio-ink)]">
                        <PanelLeft className="size-4" aria-hidden="true" />
                        {translate("administration.menuManagement")}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">
                        {translate("administration.menuManagementHint")}
                    </div>
                </div>
                <div className="flex shrink-0 gap-2">
                    <Button
                        icon={<RotateCcw className="size-3.5" />}
                        disabled={loading || saving || isDefault}
                        onClick={resetToDefault}
                    >
                        {translate("administration.menuResetDefault")}
                    </Button>
                    <Button
                        type="primary"
                        disabled={loading || !dirty || saving}
                        loading={saving}
                        onClick={() => void handleSave()}
                    >
                        {translate("appShell.save")}
                    </Button>
                </div>
            </div>

            {loading ? (
                <div className="space-y-2.5">
                    {Array.from({ length: 6 }, (_, index) => (
                        <div key={index} className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-panel)] p-3">
                            <Skeleton active title={{ width: "36%" }} paragraph={false} />
                        </div>
                    ))}
                </div>
            ) : loadError ? (
                <Alert
                    type="error"
                    showIcon
                    title={translate("administration.menuLoadFailed")}
                    description={loadError}
                    action={
                        <Button size="small" onClick={() => void loadConfigs()}>
                            {translate("administration.reload")}
                        </Button>
                    }
                />
            ) : (
                <div className="space-y-2.5">
                    {draft.map((item, index) => {
                        const tool = configurableToolBySlug.get(item.menuKey);
                        if (!tool) return null;
                        const Icon = resolveNavigationMenuIcon(item.iconKey, tool.icon);
                        const defaultLabel = translate(tool.labelKey);
                        const label = item.displayName?.trim() || defaultLabel;

                        return (
                            <section
                                key={item.menuKey}
                                className={cn(
                                    "flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-[var(--studio-panel)] px-3 py-2.5 transition",
                                    dropTargetKey === item.menuKey ? "border-[var(--studio-action)]" : "border-[var(--studio-line)]",
                                    draggingKey === item.menuKey && "opacity-60",
                                )}
                                onDragOver={(event) => {
                                    if (!draggingKey) return;
                                    event.preventDefault();
                                    setDropTargetKey(item.menuKey);
                                }}
                                onDragLeave={(event) => {
                                    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                                    setDropTargetKey((current) => (current === item.menuKey ? "" : current));
                                }}
                                onDrop={(event) => {
                                    event.preventDefault();
                                    dropOnItem(item.menuKey);
                                }}
                            >
                                <div className={cn("flex min-w-0 flex-1 items-center gap-3", !item.enabled && "opacity-60")}>
                                    <span
                                        draggable={!saving}
                                        title={translate("administration.menuDragHint")}
                                        className="inline-flex size-7 shrink-0 cursor-grab items-center justify-center rounded-md text-[var(--studio-muted)] transition hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)] active:cursor-grabbing"
                                        onDragStart={(event) => {
                                            setDraggingKey(item.menuKey);
                                            event.dataTransfer.effectAllowed = "move";
                                            event.dataTransfer.setData("text/plain", item.menuKey);
                                        }}
                                        onDragEnd={() => {
                                            setDraggingKey("");
                                            setDropTargetKey("");
                                        }}
                                    >
                                        <GripVertical className="size-4" aria-hidden="true" />
                                    </span>
                                    <span className="inline-flex size-6 shrink-0 items-center justify-center rounded bg-[var(--studio-surface-raised)] text-xs font-medium tabular-nums text-[var(--studio-muted)]">
                                        {index + 1}
                                    </span>
                                    <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-[var(--studio-line)] bg-[var(--studio-surface)] text-[var(--studio-ink)]">
                                        <Icon className="size-4" aria-hidden="true" />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="truncate text-sm font-medium text-[var(--studio-ink)]">{label}</span>
                                            {item.displayName?.trim() && item.displayName.trim() !== defaultLabel ? (
                                                <span className="truncate text-xs text-[var(--studio-faint)]">({defaultLabel})</span>
                                            ) : null}
                                            {item.badgeText?.trim() ? (
                                                <span
                                                    className="rounded bg-[var(--studio-surface-raised)] px-1.5 py-0.5 text-[10px] font-bold tracking-wide"
                                                    style={{ color: item.badgeColor || "var(--studio-new)" }}
                                                >
                                                    {item.badgeText.trim()}
                                                </span>
                                            ) : null}
                                        </div>
                                        <div className="truncate text-xs text-[var(--studio-faint)]">/{tool.slug}</div>
                                    </div>
                                </div>

                                <div className="flex shrink-0 items-center gap-3">
                                    <Button
                                        size="small"
                                        icon={<Pencil className="size-3.5" />}
                                        disabled={saving}
                                        onClick={() => openEditor(item)}
                                    >
                                        编辑样式
                                    </Button>
                                    <div className="flex items-center gap-2 border-l border-[var(--studio-line)] pl-3">
                                        <span className={cn("text-xs", item.enabled ? "text-[var(--studio-text)]" : "text-[var(--studio-muted)]")}>
                                            {translate(item.enabled ? "administration.menuVisible" : "administration.menuHidden")}
                                        </span>
                                        <Switch
                                            size="small"
                                            checked={item.enabled}
                                            disabled={saving}
                                            aria-label={translate("administration.menuToggleAriaLabel", { name: label })}
                                            onChange={(checked) => toggleItem(item.menuKey, checked)}
                                        />
                                    </div>
                                    <div className="flex items-center gap-1 border-l border-[var(--studio-line)] pl-3">
                                        <Tooltip title={translate("administration.menuMoveUp")}>
                                            <Button
                                                size="small"
                                                icon={<ChevronUp className="size-3.5" />}
                                                disabled={saving || index === 0}
                                                aria-label={translate("administration.menuMoveUp")}
                                                onClick={() => moveItem(index, index - 1)}
                                            />
                                        </Tooltip>
                                        <Tooltip title={translate("administration.menuMoveDown")}>
                                            <Button
                                                size="small"
                                                icon={<ChevronDown className="size-3.5" />}
                                                disabled={saving || index === draft.length - 1}
                                                aria-label={translate("administration.menuMoveDown")}
                                                onClick={() => moveItem(index, index + 1)}
                                            />
                                        </Tooltip>
                                    </div>
                                </div>
                            </section>
                        );
                    })}

                    <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-[var(--studio-line)] bg-[var(--studio-surface-soft)] px-3 py-2.5">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                            <span className="inline-flex size-7 shrink-0" aria-hidden="true" />
                            <span className="inline-flex size-6 shrink-0 items-center justify-center rounded bg-[var(--studio-surface-raised)] text-xs font-medium tabular-nums text-[var(--studio-muted)]">
                                {draft.length + 1}
                            </span>
                            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-[var(--studio-line)] bg-[var(--studio-surface)] text-[var(--studio-muted)]">
                                <Users className="size-4" aria-hidden="true" />
                            </span>
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium text-[var(--studio-ink)]">{translate("common.administration")}</div>
                                <div className="truncate text-xs text-[var(--studio-faint)]">/admin/system</div>
                            </div>
                        </div>
                        <span className="text-xs text-[var(--studio-muted)]">{translate("administration.menuAdminFixedHint")}</span>
                    </section>
                </div>
            )}

            <Modal
                open={Boolean(editing && editingTool)}
                title={editingTool ? `编辑菜单样式 · ${translate(editingTool.labelKey)}` : "编辑菜单样式"}
                width={560}
                mask={{ closable: false }}
                onCancel={() => setEditing(null)}
                footer={
                    <div className="flex items-center justify-between">
                        <Button icon={<RotateCcw className="size-3.5" />} onClick={resetEditingAppearance}>
                            恢复该项默认
                        </Button>
                        <div className="flex gap-2">
                            <Button onClick={() => setEditing(null)}>取消</Button>
                            <Button type="primary" onClick={applyEditor}>
                                确定
                            </Button>
                        </div>
                    </div>
                }
            >
                {editing && editingTool && PreviewIcon ? (
                    <div className="space-y-4 pt-2">
                        <div className="flex items-center justify-between rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] px-4 py-3">
                            <div>
                                <div className="text-xs font-medium text-[var(--studio-ink)]">侧边栏实时预览</div>
                                <div className="mt-0.5 text-xs text-[var(--studio-muted)]">点击确定后需点击右上角「保存」生效到全站</div>
                            </div>
                            <div className="relative flex w-[72px] flex-col items-center justify-center gap-1 rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel)] px-2 py-2.5">
                                <PreviewIcon className="size-5 text-[var(--studio-ink)]" aria-hidden="true" />
                                <span className="max-w-full truncate text-[11px] font-medium text-[var(--studio-ink)]">
                                    {editing.displayName.trim() || translate(editingTool.labelKey)}
                                </span>
                                {editing.badgeText.trim() ? (
                                    <span
                                        className="new-badge right-1 top-1 max-w-[44px] truncate"
                                        style={{ color: editing.badgeColor || "var(--studio-new)" }}
                                    >
                                        {editing.badgeText.trim()}
                                    </span>
                                ) : null}
                            </div>
                        </div>

                        <div>
                            <label className="mb-1.5 block text-xs font-medium text-[var(--studio-ink)]">显示名称</label>
                            <Input
                                value={editing.displayName}
                                maxLength={32}
                                allowClear
                                placeholder={`默认：${translate(editingTool.labelKey)}（留空沿用默认名称）`}
                                onChange={(event) => setEditing((current) => (current ? { ...current, displayName: event.target.value } : current))}
                            />
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                                <label className="mb-1.5 block text-xs font-medium text-[var(--studio-ink)]">右上角标文案</label>
                                <Input
                                    value={editing.badgeText}
                                    maxLength={16}
                                    allowClear
                                    placeholder="留空则不显示角标，如 NEW / HOT"
                                    onChange={(event) => setEditing((current) => (current ? { ...current, badgeText: event.target.value } : current))}
                                />
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {NAVIGATION_BADGE_TEXT_PRESETS.map((preset) => (
                                        <button
                                            key={preset}
                                            type="button"
                                            className={cn(
                                                "cursor-pointer rounded border px-2 py-0.5 text-[11px]! font-medium transition",
                                                editing.badgeText.trim() === preset
                                                    ? "border-[var(--studio-primary)] bg-[var(--studio-primary-soft)] text-[var(--studio-ink)]!"
                                                    : "border-[var(--studio-line)] bg-[var(--studio-surface)] text-[var(--studio-muted)]! hover:text-[var(--studio-ink)]!",
                                            )}
                                            onClick={() => setEditing((current) => (current ? { ...current, badgeText: preset } : current))}
                                        >
                                            {preset}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="mb-1.5 block text-xs font-medium text-[var(--studio-ink)]">角标颜色</label>
                                <div className="flex items-center gap-2">
                                    <ColorPicker
                                        value={editing.badgeColor || undefined}
                                        allowClear
                                        showText={(color) => (editing.badgeColor ? color.toHexString() : "系统默认色")}
                                        onChange={(color) =>
                                            setEditing((current) => (current ? { ...current, badgeColor: color.toHexString() } : current))
                                        }
                                        onClear={() =>
                                            setEditing((current) => (current ? { ...current, badgeColor: null } : current))
                                        }
                                    />
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                    {NAVIGATION_BADGE_COLOR_PRESETS.map((hex) => {
                                        const selected = editing.badgeColor?.toLowerCase() === hex.toLowerCase();
                                        return (
                                            <button
                                                key={hex}
                                                type="button"
                                                title={hex}
                                                aria-label={`选择颜色 ${hex}`}
                                                className={cn(
                                                    "size-5 cursor-pointer rounded-full border-2 transition",
                                                    selected ? "scale-110 border-[var(--studio-ink)]" : "border-transparent hover:scale-105",
                                                )}
                                                style={{ backgroundColor: hex }}
                                                onClick={() => setEditing((current) => (current ? { ...current, badgeColor: hex } : current))}
                                            />
                                        );
                                    })}
                                    {editing.badgeColor ? (
                                        <button
                                            type="button"
                                            className="cursor-pointer px-1 text-xs! text-[var(--studio-muted)]! hover:text-[var(--studio-ink)]!"
                                            onClick={() => setEditing((current) => (current ? { ...current, badgeColor: null } : current))}
                                        >
                                            默认
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                        </div>

                        <div>
                            <div className="mb-1.5 flex items-center justify-between gap-2">
                                <label className="block text-xs font-medium text-[var(--studio-ink)]">选择图标</label>
                                {editing.iconKey ? (
                                    <button
                                        type="button"
                                        className="cursor-pointer text-xs! text-[var(--studio-muted)]! hover:text-[var(--studio-ink)]!"
                                        onClick={() => setEditing((current) => (current ? { ...current, iconKey: null } : current))}
                                    >
                                        使用默认图标
                                    </button>
                                ) : (
                                    <span className="text-xs text-[var(--studio-faint)]">当前使用默认图标</span>
                                )}
                            </div>
                            <Input
                                value={iconSearch}
                                prefix={<Search className="size-3.5 text-[var(--studio-muted)]" />}
                                allowClear
                                placeholder="搜索图标名称或关键词（如：视频、星光、火焰）"
                                onChange={(event) => setIconSearch(event.target.value)}
                            />
                            <div className="mt-2.5 grid max-h-48 grid-cols-6 gap-1.5 overflow-y-auto rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-2 sm:grid-cols-8">
                                {filteredIcons.map((option) => {
                                    const IconComponent = option.icon;
                                    const selected = editing.iconKey === option.key;
                                    return (
                                        <Tooltip key={option.key} title={option.label}>
                                            <button
                                                type="button"
                                                aria-label={option.label}
                                                className={cn(
                                                    "flex h-10 cursor-pointer items-center justify-center rounded-md border transition",
                                                    selected
                                                        ? "border-[var(--studio-primary)] bg-[var(--studio-primary-soft)] text-[var(--studio-ink)]!"
                                                        : "border-transparent bg-[var(--studio-panel)] text-[var(--studio-muted)]! hover:border-[var(--studio-line)] hover:text-[var(--studio-ink)]!",
                                                )}
                                                onClick={() => setEditing((current) => (current ? { ...current, iconKey: option.key } : current))}
                                            >
                                                <IconComponent className="size-4.5" aria-hidden="true" />
                                            </button>
                                        </Tooltip>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                ) : null}
            </Modal>
        </div>
    );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, App, Button, Skeleton, Switch, Tooltip } from "antd";
import { ChevronDown, ChevronUp, GripVertical, PanelLeft, RotateCcw, Users } from "lucide-react";

import { useTranslation } from "@/features/locale/use-translation";
import {
    configurableNavigationTools,
    defaultNavigationMenuDrafts,
    mergeNavigationMenuConfigs,
    navigationMenuDraftSignature,
} from "@/features/navigation-menu/lib/navigation-menu-config";
import { useNavigationMenuStore } from "@/features/navigation-menu/stores/use-navigation-menu-store";
import {
    listNavigationMenuConfigs,
    saveNavigationMenuConfigs,
    type NavigationMenuConfigInput,
} from "@/services/api/navigation-menu";
import { cn } from "@/shared/lib/utils";

const configurableToolBySlug = new Map(configurableNavigationTools.map((tool) => [tool.slug, tool]));

/**
 * 平台管理员左侧导航菜单管理组件，支持开关显隐与拖拽/按钮排序。
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
                        const Icon = tool.icon;
                        const label = translate(tool.labelKey);

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
                                            {tool.isNew ? (
                                                <span className="rounded bg-[var(--studio-surface-raised)] px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--studio-action)]">
                                                    NEW
                                                </span>
                                            ) : null}
                                        </div>
                                        <div className="truncate text-xs text-[var(--studio-faint)]">/{tool.slug}</div>
                                    </div>
                                </div>

                                <div className="flex shrink-0 items-center gap-3">
                                    <div className="flex items-center gap-2">
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
                            <span className="inline-flex size-6 shrink-0 items-center justify-center rounded bg-[var(--studio-surface-raised)] text-xs tabular-nums text-[var(--studio-faint)]">
                                {draft.length + 1}
                            </span>
                            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-[var(--studio-line)] bg-[var(--studio-surface)] text-[var(--studio-muted)]">
                                <Users className="size-4" aria-hidden="true" />
                            </span>
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium text-[var(--studio-ink)]">
                                    {translate("common.administration")}
                                </div>
                                <div className="truncate text-xs text-[var(--studio-faint)]">/admin/system</div>
                            </div>
                        </div>
                        <span className="text-xs text-[var(--studio-muted)]">
                            {translate("administration.menuSystemLockedHint")}
                        </span>
                    </section>
                </div>
            )}
        </div>
    );
}

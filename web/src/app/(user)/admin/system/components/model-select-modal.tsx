"use client";

import { useMemo, useState } from "react";
import { Pencil, Search } from "lucide-react";
import { Button, Checkbox, Input, Modal, Radio } from "antd";

import { useTranslation } from "@/features/locale/use-translation";
import { ModelIcon } from "@/features/settings/components/model-picker";
import type { AiConfig } from "@/features/settings/stores/use-config-store";
import { cn } from "@/shared/lib/utils";

/** 一个渠道下的可选模型，供模型选择弹窗渲染。 */
export type ChannelModelGroup = {
    channelId: string;
    channelName: string;
    models: Array<{ value: string; label: string }>;
};

type ModelSelectModalProps = {
    config: AiConfig;
    title: string;
    groups: ChannelModelGroup[];
    value: string[];
    multiple?: boolean;
    /** 已经存在模型配置的模型值，只有这些模型可以在弹窗里直接配置。 */
    configurableValues?: string[];
    onConfigure?: (model: string) => void;
    onCancel: () => void;
    onConfirm: (values: string[]) => void;
};

/** 模型选择弹窗：左侧渠道、右侧该渠道的模型，支持按模型名或渠道名筛选，选中后可直接配置。 */
export function ModelSelectModal({ config, title, groups, value, multiple = false, configurableValues = [], onConfigure, onCancel, onConfirm }: ModelSelectModalProps) {
    const translate = useTranslation();
    const [selected, setSelected] = useState<string[]>(value);
    const [query, setQuery] = useState("");
    const [activeChannelId, setActiveChannelId] = useState(() => groups.find((group) => group.models.some((model) => value.includes(model.value)))?.channelId ?? groups[0]?.channelId ?? "");
    const keyword = query.trim().toLowerCase();
    const matchedModels = useMemo(
        () =>
            groups.flatMap((group) =>
                group.models
                    .filter((model) => !keyword || group.channelName.toLowerCase().includes(keyword) || model.label.toLowerCase().includes(keyword))
                    .map((model) => ({ ...model, channelId: group.channelId, channelName: group.channelName })),
            ),
        [groups, keyword],
    );
    const visibleModels = keyword ? matchedModels : matchedModels.filter((model) => model.channelId === activeChannelId);
    const isSelected = (model: string) => selected.includes(model);
    const selectedCount = (channelId: string) => groups.find((group) => group.channelId === channelId)?.models.filter((model) => isSelected(model.value)).length || 0;
    const toggleModel = (model: string) => setSelected((values) => (multiple ? (values.includes(model) ? values.filter((item) => item !== model) : [...values, model]) : [model]));

    return (
        <Modal
            open
            title={title}
            width={760}
            onCancel={onCancel}
            footer={(
                <div className="flex w-full flex-wrap items-center justify-between gap-3">
                    <span className="text-xs text-[var(--studio-muted)]">{translate("appShell.selectedModelCount", { value0: selected.length })}</span>
                    <div className="flex gap-2">
                        {multiple ? <Button disabled={!selected.length} onClick={() => setSelected([])}>{translate("appShell.clearSelectedModels")}</Button> : null}
                        <Button onClick={onCancel}>{translate("appShell.cancel")}</Button>
                        <Button type="primary" disabled={!multiple && !selected.length} onClick={() => onConfirm(selected)}>{translate("appShell.confirm")}</Button>
                    </div>
                </div>
            )}
        >
            <Input allowClear prefix={<Search className="size-4 text-[var(--studio-muted)]" />} placeholder={translate("appShell.searchModels")} value={query} onChange={(event) => setQuery(event.target.value)} />
            <div className="mt-3 grid gap-3 md:grid-cols-[200px_minmax(0,1fr)]">
                <div className="max-h-[360px] space-y-1 overflow-y-auto rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-1.5">
                    {groups.map((group) => {
                        const matched = matchedModels.filter((model) => model.channelId === group.channelId).length;
                        if (keyword && !matched) return null;
                        const chosen = selectedCount(group.channelId);
                        return (
                            <button
                                key={group.channelId}
                                type="button"
                                onClick={() => {
                                    setActiveChannelId(group.channelId);
                                    setQuery("");
                                }}
                                className={cn(
                                    "flex w-full items-center justify-between gap-2 rounded-md border-l-2 px-2 py-1.5 text-left text-sm",
                                    !keyword && group.channelId === activeChannelId
                                        ? "border-[var(--studio-primary)] bg-[var(--studio-primary-soft)] font-medium text-[var(--studio-primary)]"
                                        : "border-transparent text-[var(--studio-text)] hover:bg-[var(--studio-surface-hover)]",
                                )}
                            >
                                <span className="truncate">{group.channelName}</span>
                                <span className="shrink-0 text-xs tabular-nums text-[var(--studio-muted)]">{chosen ? `${chosen}/${matched}` : matched}</span>
                            </button>
                        );
                    })}
                </div>
                <div className="max-h-[360px] space-y-0.5 overflow-y-auto rounded-lg border border-[var(--studio-line)] p-1.5">
                    {visibleModels.length ? (
                        visibleModels.map((model) => {
                            const checked = isSelected(model.value);
                            return (
                                <div
                                    key={model.value}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => toggleModel(model.value)}
                                    onKeyDown={(event) => {
                                        if (event.key !== "Enter" && event.key !== " ") return;
                                        event.preventDefault();
                                        toggleModel(model.value);
                                    }}
                                    className={cn(
                                        "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none",
                                        checked ? "bg-[var(--studio-primary-soft)] font-medium text-[var(--studio-ink)]" : "text-[var(--studio-text)] hover:bg-[var(--studio-surface-hover)]",
                                    )}
                                >
                                    <span className="pointer-events-none flex size-4 shrink-0 items-center justify-center">{multiple ? <Checkbox checked={checked} /> : <Radio checked={checked} />}</span>
                                    <ModelIcon config={config} model={model.value} />
                                    <span className="min-w-0 flex-1 truncate">{model.label}</span>
                                    {keyword ? <span className="shrink-0 text-xs text-[var(--studio-muted)]">{model.channelName}</span> : null}
                                    {onConfigure && configurableValues.includes(model.value) ? (
                                        <Button
                                            size="small"
                                            type="text"
                                            className="shrink-0"
                                            title={translate("appShell.edit")}
                                            icon={<Pencil className="size-3.5" />}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                onConfigure(model.value);
                                            }}
                                        />
                                    ) : null}
                                </div>
                            );
                        })
                    ) : (
                        <div className="flex h-24 items-center justify-center text-sm text-[var(--studio-muted)]">{translate("appShell.noMatchingModels")}</div>
                    )}
                </div>
            </div>
        </Modal>
    );
}

"use client";

import { App, Button, Input, Modal, Tag } from "antd";
import { Copy, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { createVideoGenerationCapabilityOptions } from "@/features/generation/lib/video-billing";
import { useTranslation } from "@/features/locale/use-translation";
import { modelOptionLabelWithRealName } from "@/features/settings/stores/use-config-store";
import type { AiConfig, VideoGenerationMode } from "@/features/settings/stores/use-config-store";
import type { ServerModelConfig } from "@/services/api/server";

import { copyableVideoSourceModels, planCustomConfigCopy } from "./model-config-copy";
import type { CustomGroupTextField } from "./model-config-copy";
import { modelConfigIdentity } from "./model-config-draft";

type ModelConfigCopyModalProps = {
    /** 当前正在编辑的目标模型。 */
    target: ServerModelConfig;
    /** 候选来源，通常是当前空间草稿里的全部模型配置。 */
    configs: ServerModelConfig[];
    config: AiConfig;
    onCancel: () => void;
    onCopy: (source: ServerModelConfig, modes: VideoGenerationMode[]) => void;
};

/** 从其他视频自定义模型复制自定义调用配置。 */
export function ModelConfigCopyModal({ target, configs, config, onCancel, onCopy }: ModelConfigCopyModalProps) {
    const translate = useTranslation();
    const { modal } = App.useApp();
    const [query, setQuery] = useState("");

    const sources = useMemo(() => copyableVideoSourceModels(configs, target), [configs, target]);
    const modeOptions = useMemo(() => createVideoGenerationCapabilityOptions(translate), [translate.locale]);
    const modeLabel = (mode: VideoGenerationMode) => modeOptions.find((option) => option.value === mode)?.label || mode;
    const fieldLabels: Record<CustomGroupTextField, string> = {
        requestPath: translate("appShell.requestPath"),
        requestModelName: translate("appShell.modelRequestName"),
        requestTemplate: translate("appShell.requestTemplate"),
        aiRequestPrompt: translate("appShell.aiRequestPrompt"),
        responseExample: translate("appShell.responseExample"),
        resultPath: translate("appShell.resultPath"),
        queryPath: translate("appShell.queryPath"),
        queryRequestTemplate: translate("appShell.queryRequestTemplate"),
        aiQueryPrompt: translate("appShell.aiQueryPrompt"),
        queryResponseExample: translate("appShell.queryResponseExample"),
        queryResultPath: translate("appShell.queryResultPath"),
    };

    const keyword = query.trim().toLowerCase();
    const visibleSources = useMemo(() => {
        if (!keyword) return sources;
        return sources.filter((item) => {
            const label = modelOptionLabelWithRealName(config, `${item.channelId}::${item.modelName}`);
            return label.toLowerCase().includes(keyword) || item.modelName.toLowerCase().includes(keyword);
        });
    }, [sources, config, keyword]);

    /** 复制单个来源模型：有内容冲突时先确认覆盖范围。 */
    const copyFrom = (source: ServerModelConfig) => {
        const rows = planCustomConfigCopy(source, target).filter((row) => row.sourceFilledFieldCount > 0);
        if (!rows.length) {
            modal.info({ zIndex: 1400, title: translate("appShell.copyConfigNoContent"), content: translate("appShell.copyConfigNoContentHint") });
            return;
        }
        const conflicting = rows.filter((row) => row.targetFilledFieldCount > 0);
        const modes = rows.map((row) => row.mode);
        if (!conflicting.length) {
            onCopy(source, modes);
            return;
        }
        modal.confirm({
            zIndex: 1400,
            title: translate("appShell.copyConfigOverwriteTitle"),
            content: (
                <div className="space-y-2 text-sm">
                    <div>{translate("appShell.theFollowingContentWillBeOverwritten")}</div>
                    <ul className="list-disc space-y-1 pl-5">
                        {conflicting.map((row) => (
                            <li key={row.mode}>
                                <span className="font-medium">{modeLabel(row.mode)}</span>
                                <span className="text-[var(--studio-muted)]">
                                    {" · "}
                                    {row.targetFilledFields.map((field) => fieldLabels[field]).join("、")}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            ),
            okText: translate("appShell.overwriteAndCopy"),
            cancelText: translate("appShell.cancel"),
            onOk: () => onCopy(source, modes),
        });
    };

    return (
        <Modal open centered width={720} zIndex={1300} title={translate("appShell.copyVideoConfigTitle")} onCancel={onCancel} footer={<Button onClick={onCancel}>{translate("appShell.cancel")}</Button>}>
            <div className="space-y-3">
                <p className="text-xs leading-5 text-[var(--studio-muted)]">{translate("appShell.copyVideoConfigHint")}</p>
                <Input allowClear prefix={<Search className="size-4 text-[var(--studio-muted)]" />} placeholder={translate("appShell.searchSourceModel")} value={query} onChange={(event) => setQuery(event.target.value)} />
                <div className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
                    {visibleSources.length ? visibleSources.map((source) => {
                        const rows = planCustomConfigCopy(source, target).filter((row) => row.sourceFilledFieldCount > 0);
                        return (
                            <div key={modelConfigIdentity(source)} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-3">
                                <div className="min-w-0 flex-1">
                                    <div className="text-sm font-medium">{modelOptionLabelWithRealName(config, `${source.channelId}::${source.modelName}`)}</div>
                                    <div className="mt-1.5 flex flex-wrap gap-1">
                                        {rows.length ? rows.map((row) => (
                                            <Tag key={row.mode} className="!m-0">
                                                {modeLabel(row.mode)}
                                                <span className="ml-1 text-[var(--studio-muted)]">{row.sourceFilledFieldCount}</span>
                                            </Tag>
                                        )) : <span className="text-xs text-[var(--studio-muted)]">{translate("appShell.copyConfigSourceEmpty")}</span>}
                                    </div>
                                </div>
                                <Button size="small" icon={<Copy className="size-3.5" />} disabled={!rows.length} onClick={() => copyFrom(source)}>
                                    {translate("appShell.copyAction")}
                                </Button>
                            </div>
                        );
                    }) : <div className="py-6 text-center text-xs text-[var(--studio-muted)]">{sources.length ? translate("appShell.noMatchingModels") : translate("appShell.noCopyableSourceModels")}</div>}
                </div>
            </div>
        </Modal>
    );
}

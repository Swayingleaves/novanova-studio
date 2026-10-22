"use client";

import { Button, Modal } from "antd";
import { Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

import { createVideoGenerationCapabilityOptions } from "@/features/generation/lib/video-billing";
import { useTranslation } from "@/features/locale/use-translation";
import type { VideoGenerationMode } from "@/features/settings/stores/use-config-store";
import type { ServerModelConfig } from "@/services/api/server";

import { applyCustomConfigAutoFill, planCustomConfigAutoFill } from "./model-config-copy";
import type { CustomConfigAutoFillRow, CustomGroupField } from "./model-config-copy";
import { customConfigFieldLabels } from "./model-config-copy-modal";

/**
 * 用同一模型的其他视频模式补全当前模式的空字段。
 *
 * @param config ServerModelConfig 当前编辑的模型，其他视频模式作为来源
 * @param mode VideoGenerationMode 当前编辑的模式
 * @param onCancel Function 关闭弹窗
 * @param onFill Function 回填结果与本次补上的字段
 */
export function ModelConfigAutoFillModal({ config, mode, onCancel, onFill }: {
    config: ServerModelConfig;
    mode: VideoGenerationMode;
    onCancel: () => void;
    onFill: (config: ServerModelConfig, filledFields: CustomGroupField[]) => void;
}) {
    const translate = useTranslation();
    const [selected, setSelected] = useState<VideoGenerationMode | null>(null);
    const modeOptions = useMemo(() => createVideoGenerationCapabilityOptions(translate), [translate.locale]);
    const fieldLabels = customConfigFieldLabels(translate);
    const modeLabel = (value: VideoGenerationMode) => modeOptions.find((option) => option.value === value)?.label || value;
    const rows = planCustomConfigAutoFill(config, config, mode);
    const current = rows.find((row) => row.mode === selected) || null;

    return (
        <Modal
            open
            centered
            width={620}
            zIndex={1300}
            title={`${translate("appShell.autoFill")} · ${modeLabel(mode)}`}
            onCancel={onCancel}
            footer={[
                <Button key="cancel" onClick={onCancel}>{translate("appShell.cancel")}</Button>,
                <Button key="ok" type="primary" disabled={!current?.fillableFields.length} onClick={() => current && onFill(applyCustomConfigAutoFill(config, mode, config.customModelConfig?.[current.mode]).config, current.fillableFields)}>
                    {translate("appShell.autoFillConfirm")}
                </Button>,
            ]}
        >
            <div className="space-y-3">
                <p className="text-xs leading-5 text-[var(--studio-muted)]">{translate("appShell.autoFillHint")}</p>
                <div className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
                    {rows.map((row: CustomConfigAutoFillRow) => {
                        const disabled = !row.fillableFields.length;
                        return (
                            <button
                                key={row.mode}
                                type="button"
                                disabled={disabled}
                                aria-pressed={selected === row.mode}
                                onClick={() => setSelected(row.mode)}
                                className={`w-full rounded-lg border p-3 text-left transition-colors ${selected === row.mode ? "border-violet-500/60 bg-violet-500/5" : "border-[var(--studio-line)] bg-[var(--studio-surface-soft)]"} ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                            >
                                <div className="flex items-center gap-2 text-sm font-medium">
                                    <Sparkles className="size-3.5 text-[var(--studio-muted)]" />
                                    {modeLabel(row.mode)}
                                </div>
                                <div className="mt-1 text-xs text-[var(--studio-muted)]">
                                    {!row.sourceFilledFields.length ? translate("appShell.autoFillSourceEmpty") : disabled ? translate("appShell.autoFillTargetFilled") : row.fillableFields.map((field) => fieldLabels[field]).join("、")}
                                </div>
                            </button>
                        );
                    })}
                </div>
                {current?.fillableFields.length ? <p className="text-xs text-[var(--studio-muted)]">{translate("appShell.autoFillOnlyEmpty")}</p> : null}
            </div>
        </Modal>
    );
}

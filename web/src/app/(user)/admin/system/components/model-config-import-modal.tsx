"use client";

import { Alert, Button, Input, Modal } from "antd";
import { useMemo, useState } from "react";

import { useTranslation } from "@/features/locale/use-translation";
import type { ServerModelConfig } from "@/services/api/server";

import { parseCustomModelTransfer, type CustomModelTransferIssue } from "./model-config-transfer";

type ModelConfigImportModalProps = {
    /** 当前正在编辑的模型，导入不允许跨图片/视频类型。 */
    target: ServerModelConfig;
    onCancel: () => void;
    onImport: (patch: Partial<ServerModelConfig>) => void;
};

/** 把失败原因转换为界面文案。 */
function issueMessage(translate: ReturnType<typeof useTranslation>, issue: CustomModelTransferIssue, actualType?: string) {
    if (issue === "invalid-json") return translate("appShell.importConfigInvalidJson");
    if (issue === "invalid-payload") return translate("appShell.importConfigInvalidPayload");
    if (issue === "model-type-mismatch") return translate("appShell.importConfigTypeMismatch", { value0: actualType === "image" ? translate("appShell.imageModel") : translate("appShell.videoModel") });
    return "";
}

/**
 * 导入其他实例复制出的自定义模型配置。
 *
 * @param props 目标模型、取消与导入回调
 * @return 导入弹窗
 */
export function ModelConfigImportModal({ target, onCancel, onImport }: ModelConfigImportModalProps) {
    const translate = useTranslation();
    const [text, setText] = useState("");
    const targetModelType = target.modelType;
    const result = useMemo(() => parseCustomModelTransfer(text, targetModelType), [text, targetModelType]);
    const importPatch = result.ok ? result.patch : null;
    const typeLabel = targetModelType === "image" ? translate("appShell.imageModel") : translate("appShell.videoModel");

    return (
        <Modal
            open
            centered
            width={720}
            zIndex={1300}
            title={translate("appShell.importConfigTitle")}
            onCancel={onCancel}
            footer={
                <>
                    <Button onClick={onCancel}>{translate("appShell.cancel")}</Button>
                    <Button type="primary" disabled={!importPatch} onClick={() => importPatch && onImport(importPatch)}>
                        {translate("appShell.importConfig")}
                    </Button>
                </>
            }
        >
            <div className="space-y-3">
                <p className="text-xs leading-5 text-[var(--studio-muted)]">{translate("appShell.importConfigHint")}</p>
                <Input.TextArea
                    value={text}
                    autoSize={{ minRows: 12, maxRows: 18 }}
                    spellCheck={false}
                    className="font-mono text-xs"
                    placeholder={translate("appShell.importConfigPlaceholder")}
                    onChange={(event) => setText(event.target.value)}
                />
                {result.ok ? (
                    <Alert
                        type="success"
                        showIcon
                        title={translate("appShell.importConfigReady", {
                            value0: typeLabel,
                            value1: result.summary.displayName || "-",
                            value2: result.summary.capabilityCount,
                            value3: result.summary.priceCount,
                            value4: result.summary.customModeCount,
                        })}
                    />
                ) : result.issue === "empty" ? null : (
                    <Alert type="error" showIcon title={issueMessage(translate, result.issue, result.actualType)} />
                )}
            </div>
        </Modal>
    );
}

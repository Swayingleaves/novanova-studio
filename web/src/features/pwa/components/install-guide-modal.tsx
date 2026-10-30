"use client";

import { Modal } from "antd";

import { useTranslation } from "@/features/locale/use-translation";
import { platformBrand } from "@/features/team/space-brand";

import type { InstallGuideKind } from "../install-policy";
import { usePwaStore } from "../use-pwa-store";

/** 手动安装引导弹窗（PRD 4.6.2）：不支持原生安装弹窗的平台按 guideKind 展示菜单路径 */
export function InstallGuideModal() {
    const translate = useTranslation();
    const guideOpen = usePwaStore((state) => state.guideOpen);
    const guideKind = usePwaStore((state) => state.guideKind);
    const setGuideOpen = usePwaStore((state) => state.setGuideOpen);

    // 按浏览器类型取对应三步文案（静态键调用，便于 messages 测试校验）
    const steps: Record<InstallGuideKind, string[]> = {
        "chrome-menu": [
            translate("pwa.guideChromeStep1"),
            translate("pwa.guideChromeStep2"),
            translate("pwa.guideChromeStep3"),
        ],
        "edge-menu": [
            translate("pwa.guideEdgeStep1"),
            translate("pwa.guideEdgeStep2"),
            translate("pwa.guideEdgeStep3"),
        ],
        "safari-dock": [
            translate("pwa.guideSafariStep1"),
            translate("pwa.guideSafariStep2"),
            translate("pwa.guideSafariStep3", { value0: platformBrand.name }),
        ],
    };
    const stepList = guideKind ? steps[guideKind] : [];

    return (
        <Modal
            open={guideOpen && stepList.length > 0}
            title={translate("pwa.guideTitle", { value0: platformBrand.name })}
            onCancel={() => setGuideOpen(false)}
            footer={null}
            data-testid="pwa-install-guide"
        >
            <ol className="flex list-none flex-col gap-3 py-2">
                {stepList.map((text, index) => (
                    <li key={index} className="flex items-start gap-3">
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--studio-primary-soft)] text-xs font-semibold text-[var(--studio-primary)]">{index + 1}</span>
                        <span className="pt-0.5 text-sm leading-6 text-[var(--studio-ink)]">{text}</span>
                    </li>
                ))}
            </ol>
        </Modal>
    );
}

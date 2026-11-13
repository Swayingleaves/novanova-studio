"use client";

import { Popover } from "antd";
import { HelpCircle } from "lucide-react";

import { useTranslation } from "@/features/locale/use-translation";
import { SKILL_PROMPT_ACTIONS } from "@/features/skill-market/lib/skill-prompt-actions";

const actionHelpKey = {
    askUserModelConfig: "askUserModelConfigHelp",
    askUserConfirm: "askUserConfirmHelp",
    askUserUploadImage: "askUserUploadImageHelp",
    askUserUploadVideo: "askUserUploadVideoHelp",
} as const;

/** 流程提示词标题。右侧问号说明怎么写，以及可以用 @ 唤起的内置标识。 */
export function SkillPromptLabel({ text }: { text: string }) {
    const translate = useTranslation();
    return (
        <span className="inline-flex items-center gap-1.5">
            <span>{text}</span>
            <Popover
                trigger="click"
                placement="rightTop"
                content={
                    <div className="w-[min(22rem,calc(100vw-48px))] space-y-2 text-sm leading-6 text-[var(--studio-ink)]">
                        <p>{translate("skillMarket.promptHelpIntro")}</p>
                        <p className="text-[var(--studio-muted)]">{translate("skillMarket.promptHelpMention")}</p>
                        <p className="font-medium">{translate("skillMarket.promptHelpActions")}</p>
                        <ul className="space-y-1.5">
                            {SKILL_PROMPT_ACTIONS.map((action) => (
                                <li key={action.token}>
                                    <span className="font-medium">@{translate(`skillMarket.${action.labelKey}`)}</span>
                                    <span className="text-[var(--studio-muted)]"> · {translate(`skillMarket.${actionHelpKey[action.labelKey]}`)}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                }
            >
                <button
                    type="button"
                    aria-label={translate("skillMarket.promptHelp")}
                    className="inline-flex text-[var(--studio-muted)] hover:text-[var(--studio-ink)]"
                    onMouseDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                    }}
                >
                    <HelpCircle className="size-3.5" />
                </button>
            </Popover>
        </span>
    );
}

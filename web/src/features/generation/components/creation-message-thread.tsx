"use client";
import { useTranslation } from "@/features/locale/use-translation";
import { ASK_USER_CONFIRM, ASK_USER_MODEL_CONFIG, ASK_USER_UPLOAD_IMAGE, ASK_USER_UPLOAD_VIDEO, CONTINUE_AFTER_MODEL_CONFIG, SKILL_CONFIRM_MESSAGE } from "@/features/skill-market/lib/skill-prompt-actions";
import { useActionLabel } from "@/features/locale/use-action-label";


import { Button, Input, Modal, Tooltip } from "antd";
import { ArrowRight, Copy, LoaderCircle, PenLine } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "@/shared/lib/team-navigation";

import { AgentActivityTimeline } from "@/features/generation/components/agent-activity-timeline";
import type { CreationMessageThreadProps } from "@/features/generation/components/creation-workspace-types";
import { ThinkingBlock } from "@/features/chat";
import { useCopyText } from "@/shared/hooks/use-copy-text";
import { storeInitialPromptForNavigation } from "@/shared/lib/initial-prompt";

// 底部判定阈值需覆盖输入框紧凑/展开的高度差：输入框展开时滚动视口变矮，
// 若阈值太小，滚到底展开输入框后会因差值超限被误判为“未到底”而缩回（震荡）。
const AT_BOTTOM_THRESHOLD = 180;

export function CreationMessageThread({ sections, emptyState, onAtBottomChange, onActionReply, onPromptEdit, onUploadImage, onUploadVideo, onAdjustDuration, onOpenModelSettings }: CreationMessageThreadProps) {
    const translate = useTranslation();
    const actionLabel = useActionLabel();
    const scrollRef = useRef<HTMLDivElement>(null);
    const keepPinnedToBottomRef = useRef(true);
    const latestFreshUserRoundIdRef = useRef<string | null>(null);
    const copyText = useCopyText();
    const router = useRouter();

    const isAtBottom = () => {
        const el = scrollRef.current;
        return !el || el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_THRESHOLD;
    };

    const scrollToBottom = () => {
        const el = scrollRef.current;
        if (!el) {
            return;
        }
        el.scrollTop = el.scrollHeight;
    };

    const latestSection = sections[sections.length - 1];
    const latestRound = latestSection?.rounds[latestSection.rounds.length - 1];
    const latestFreshUserRoundId = latestRound?.userText && !latestRound.statusText && !latestRound.assistantText && !latestRound.resultContent ? latestRound.id : null;
    const hasNewFreshUserRound = latestFreshUserRoundId !== null && latestFreshUserRoundId !== latestFreshUserRoundIdRef.current;

    // 内容新增后，如果用户原本就在底部，或首次出现新的用户消息，则自动贴到底部。
    useLayoutEffect(() => {
        if (keepPinnedToBottomRef.current || hasNewFreshUserRound) {
            scrollToBottom();
            keepPinnedToBottomRef.current = true;
            onAtBottomChange?.(true);
        } else {
            const atBottom = isAtBottom();
            // 内容更新后若实际已在底部，同步 pinned 语义，避免后续渲染误判。
            if (atBottom) {
                keepPinnedToBottomRef.current = true;
            }
            onAtBottomChange?.(atBottom);
        }
        latestFreshUserRoundIdRef.current = latestFreshUserRoundId;
    }, [hasNewFreshUserRound, latestFreshUserRoundId, onAtBottomChange, sections]);

    const handleScroll = () => {
        const atBottom = isAtBottom();
        keepPinnedToBottomRef.current = atBottom;
        onAtBottomChange?.(atBottom);
    };

    return (
        <div ref={scrollRef} className="thin-scrollbar min-h-0 flex-1 overflow-y-auto" onScroll={handleScroll}>
            {sections.length ? (
                <div className="mx-auto w-full max-w-5xl px-4 pb-6 pt-6 sm:px-6">
                    {sections.map((section) => (
                        <section key={section.id} className="mb-10 last:mb-0">
                            <div className="mb-5 flex items-center gap-3">
                                <h2 className="text-sm font-semibold text-[var(--studio-muted)]">{section.label}</h2>
                                <div className="h-px flex-1 bg-[var(--studio-line)]" />
                            </div>
                            <div className="space-y-8">
                                {section.rounds.map((round) => (
                                    <article key={round.id} className="space-y-4">
                                        {round.userText || round.userAttachments ? (
                                            <div className="flex justify-end">
                                                <div className="group flex w-fit max-w-[92%] flex-col items-end sm:max-w-[82%]">
                                                    {round.userAttachments ? <div className="mb-3">{round.userAttachments}</div> : null}
                                                    {round.userText ? (
                                                        <div className="relative rounded-[28px] bg-[rgba(83,96,116,0.08)] px-5 py-4 pr-14">
                                                            <MessageCopyButton side="right" placement="inside" onClick={() => copyText(round.userCopyText || round.userText, translate("generation.userMessageCopied"))} />
                                                            <p className="whitespace-pre-wrap text-sm leading-7 text-[var(--studio-ink)] sm:text-[15px]">{round.userContent ?? round.userText}</p>
                                                        </div>
                                                    ) : null}
                                                </div>
                                            </div>
                                        ) : null}
                                        <div className="space-y-3">
                                            {round.thinkings?.map((thinking) => (
                                                <ThinkingBlock key={thinking.id} block={thinking} streaming={round.activeThinkingId === thinking.id} />
                                            ))}
                                            {round.awaitingReply ? (
                                                <div className="flex items-center gap-2 text-xs text-[var(--studio-muted)]">
                                                    <LoaderCircle className="size-3.5 animate-spin" />
                                                    <span>{translate("generation.waitingForReply")}</span>
                                                </div>
                                            ) : null}
                                            {round.activities?.length ? <AgentActivityTimeline activities={round.activities} /> : null}
                                            {round.statusText ? <div className="text-xs font-medium text-[var(--studio-muted)]">{round.statusText}</div> : null}
                                            {round.assistantText ? (
                                                <div className="group inline-flex max-w-3xl items-start gap-2">
                                                    <div className="min-w-0 flex-1">
                                                        <div className="prose prose-sm max-w-none text-sm leading-7 text-[var(--studio-ink)] dark:prose-invert">
                                                            <ReactMarkdown>{round.assistantText}</ReactMarkdown>
                                                        </div>
                                                    </div>
                                                    <MessageCopyButton side="right" placement="inline" onClick={() => copyText(round.assistantText || "", translate("generation.assistantMessageCopied"))} />
                                                </div>
                                            ) : null}
                                            {round.resultContent}
                                            {round.choiceSettingsContent ? <div className="max-w-3xl">{round.choiceSettingsContent}</div> : null}
                                            {round.action?.type === "navigate" && round.action.href ? (
                                                <div className="pt-1">
                                                    <Button
                                                        type="primary"
                                                        size="small"
                                                        icon={<ArrowRight className="size-3.5" />}
                                                        onClick={() => {
                                                            const action = round.action;
                                                            if (!action || action.type !== "navigate" || !action.href) return;
                                                            if (action.initialPrompt) storeInitialPromptForNavigation(action.initialPrompt);
                                                            router.push(action.href);
                                                        }}
                                                    >
                                                        {actionLabel(round.action)}
                                                    </Button>
                                                </div>
                                            ) : null}
                                            {round.action?.type === "choice" && round.action.options?.length ? (
                                                <ChoiceGroup
                                                    options={round.action.options}
                                                    assistantText={round.assistantText}
                                                    draftedPrompts={round.draftedPrompts}
                                                    onReply={(value) => onActionReply?.(value)}
                                                    onPromptEdit={onPromptEdit}
                                                    onUpload={onUploadImage}
                                                    onUploadVideo={onUploadVideo}
                                                    onAdjustDuration={onAdjustDuration}
                                                    onOpenModelSettings={onOpenModelSettings}
                                                    disabledReasons={round.choiceDisabledReasons}
                                                />
                                            ) : null}
                                            {round.actionBar ? <div className="pt-1">{round.actionBar}</div> : null}
                                        </div>
                                    </article>
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
            ) : (
                emptyState
            )}
        </div>
    );
}

/** 选项按钮组：单选点击即发；multiple 标记整组多选（勾选后确认提交，多个 value 用顿号拼接）；action=upload_image 触发参考图上传；action=adjust_video_duration 只打开时长设置，不发送消息。 */
export function ChoiceGroup({
    options,
    assistantText,
    draftedPrompts,
    onReply,
    onPromptEdit,
    onUpload,
    onUploadVideo,
    onAdjustDuration,
    onOpenModelSettings,
    disabledReasons,
}: {
    options: { label: string; value: string; multiple?: boolean; action?: string }[];
    assistantText?: string;
    onReply: (value: string) => void;
    draftedPrompts?: Record<string, string>;
    onPromptEdit?: (value: string, assistantText?: string, draftedPrompts?: Record<string, string>) => void;
    onUpload?: () => void;
    onUploadVideo?: () => void;
    onAdjustDuration?: (seconds: string) => void;
    onOpenModelSettings?: () => void;
    /** 需要禁用的选项及禁用原因，key 为选项 value。 */
    disabledReasons?: Record<string, string>;
}) {
    const translate = useTranslation();
    const actionLabel = useActionLabel();
    const multiple = options.some((option) => option.multiple);
    const [selected, setSelected] = useState<string[]>([]);
    const [customOpen, setCustomOpen] = useState(false);
    const [customValue, setCustomValue] = useState("");

    /** 上传视频要先于“上传”开头的文案判断，否则「上传视频」会被当成图片上传。 */
    const isVideoUploadOption = (option: { label: string; action?: string }) => option.action === ASK_USER_UPLOAD_VIDEO || /^(上传视频|upload video)/i.test(option.label);
    /** 识别"上传图片"类选项：优先专用 action，兜底按按钮文案（label）以"上传"开头判定；
     *  不能用 value 判断——"确认生成"按钮的 value 是完整提示词，可能包含"上传"字样（如"以用户上传的产品图片为基准"）。 */
    const isImageUploadOption = (option: { label: string; value: string; multiple?: boolean; action?: string }) => option.action === "upload_image" || option.action === ASK_USER_UPLOAD_IMAGE || (!isVideoUploadOption(option) && /^(上传|upload\b)/i.test(option.label));

    /** 点击选项：上传类选项直接打开文件选择；否则单选发送或多选切换选中。 */
    const reservedAction = (action?: string) => action === "adjust_video_duration" || action === "continue_after_duration" || action === ASK_USER_MODEL_CONFIG || action === CONTINUE_AFTER_MODEL_CONFIG || action === ASK_USER_CONFIRM || action === ASK_USER_UPLOAD_IMAGE || action === ASK_USER_UPLOAD_VIDEO;
    const durationAdjustment = options.every((option) => reservedAction(option.action));
    const handleOptionClick = (option: { label: string; value: string; multiple?: boolean; action?: string }) => {
        if (disabledReasons?.[option.value]) return;
        if (option.action === "adjust_video_duration") {
            onAdjustDuration?.(option.value);
            return;
        }
        if (option.action === ASK_USER_MODEL_CONFIG) {
            onOpenModelSettings?.();
            return;
        }
        if (option.action === ASK_USER_CONFIRM) {
            onReply(SKILL_CONFIRM_MESSAGE);
            return;
        }
        if (isVideoUploadOption(option)) {
            onUploadVideo?.();
            return;
        }
        if (isImageUploadOption(option)) {
            onUpload?.();
            return;
        }
        if (multiple) {
            toggle(option.value);
            return;
        }
        if (option.value === "修改提示词重新生成" || option.value === "重新调整提示词") {
            if (onPromptEdit) onPromptEdit(option.value, assistantText, draftedPrompts);
            else onReply(option.value);
            return;
        }
        onReply(option.value);
    };

    const toggle = (value: string) => {
        setSelected((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]));
    };

    const submitMulti = () => {
        if (!selected.length) return;
        onReply(selected.join("、"));
    };

    const submitCustom = () => {
        const text = customValue.trim();
        if (!text) return;
        setCustomOpen(false);
        setCustomValue("");
        onReply(text);
    };

    const customButton = (
        <Button
            className="creation-choice-custom-button"
            icon={<PenLine className="size-3.5" />}
            onClick={() => {
                setCustomValue("");
                setCustomOpen(true);
            }}
        >
            {translate("generation.custom")}</Button>
    );
    const customModal = (
        <Modal title={translate("generation.customInput")} open={customOpen} onOk={submitCustom} onCancel={() => setCustomOpen(false)} okText={translate("generation.send")} cancelText={translate("generation.cancel")} destroyOnHidden>
            <Input.TextArea value={customValue} rows={4} autoFocus placeholder={translate("generation.enterStyleContentOrAdditionalInstructionsToSendTo")} onChange={(event) => setCustomValue(event.target.value)} />
        </Modal>
    );

    if (!multiple) {
        return (
            <div className="flex flex-wrap items-center gap-2.5 pt-2">
                {options.map((option) => {
                    const disabledReason = disabledReasons?.[option.value];
                    const button = (
                        <Button key={option.value} className="creation-choice-button" disabled={Boolean(disabledReason)} onClick={() => handleOptionClick(option)}>
                            {actionLabel(option)}
                        </Button>
                    );
                    return disabledReason ? (
                        <Tooltip key={option.value} title={disabledReason}>
                            {button}
                        </Tooltip>
                    ) : (
                        button
                    );
                })}
                {durationAdjustment ? null : customButton}
                {durationAdjustment ? null : customModal}
            </div>
        );
    }

    return (
        <div className="space-y-2.5 pt-2">
            <div className="flex flex-wrap items-center gap-2.5">
                {options.map((option) => {
                    const disabledReason = disabledReasons?.[option.value];
                    const button = (
                        <Button
                            key={option.value}
                            className={selected.includes(option.value) ? "creation-choice-button creation-choice-multi creation-choice-selected" : "creation-choice-button creation-choice-multi"}
                            disabled={Boolean(disabledReason)}
                            onClick={() => handleOptionClick(option)}
                        >
                            {actionLabel(option)}
                        </Button>
                    );
                    return disabledReason ? (
                        <Tooltip key={option.value} title={disabledReason}>
                            {button}
                        </Tooltip>
                    ) : (
                        button
                    );
                })}
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
                <Button type="primary" size="small" disabled={!selected.length} onClick={submitMulti}>
                    {selected.length ? translate("generation.confirmSelected", { value0: selected.length }) : translate("generation.confirmSelection")}
                </Button>
                {customButton}
            </div>
            {customModal}
        </div>
    );
}

/** 历史记录中的选项条：普通选项只读；时长不一致的确认项在提供回调时仍可点击。 */
export function ChoiceHistoryBar({ choices, onSelect }: { choices: { label: string; value: string; multiple?: boolean; action?: string }[]; onSelect?: (choice: { label: string; value: string; multiple?: boolean; action?: string }) => void }) {
    const actionLabel = useActionLabel();
    return (
        <div className="flex flex-wrap items-center gap-2.5 pt-2">
            {choices.map((choice) => {
                const interactive = Boolean(onSelect) && choice.action === "adjust_video_duration";
                return (
                    <Button key={`${choice.action || "choice"}-${choice.value}`} className={interactive ? "creation-choice-button" : "creation-choice-button creation-choice-readonly"} disabled={!interactive} onClick={interactive ? () => onSelect?.(choice) : undefined}>
                        {actionLabel(choice)}
                    </Button>
                );
            })}
        </div>
    );
}

function MessageCopyButton({ onClick, side, placement = "edge" }: { onClick: () => void; side: "left" | "right"; placement?: "inside" | "edge" | "inline" }) {
    const translate = useTranslation();
    const positionStyle: CSSProperties | undefined =
        placement === "inline"
            ? undefined
            : placement === "inside"
              ? side === "left"
                  ? { top: 8, left: 8 }
                  : { top: 8, right: 8 }
              : side === "left"
                ? { top: 0, left: 8, transform: "translateY(-50%)" }
                : { top: 0, right: 8, transform: "translateY(-50%)" };
    const className =
        placement === "inline"
            ? "!relative !mt-1 !h-8 !w-8 !min-w-0 !shrink-0 !self-start !rounded-full !border !border-[var(--studio-line)] !bg-[var(--studio-panel-solid)] !p-0 !text-[var(--studio-muted)] opacity-0 pointer-events-none shadow-sm transition group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto hover:!border-[var(--studio-primary-line)] hover:!text-[var(--studio-ink)]"
            : "!absolute z-10 !h-8 !w-8 !min-w-0 !rounded-full !border !border-[var(--studio-line)] !bg-[var(--studio-panel-solid)] !p-0 !text-[var(--studio-muted)] opacity-0 pointer-events-none shadow-sm transition group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto hover:!border-[var(--studio-primary-line)] hover:!text-[var(--studio-ink)]";
    return (
        <Tooltip title={translate("generation.copyMessage")}>
            <Button size="small" type="text" aria-label={translate("generation.copyMessage")} style={positionStyle} className={className} icon={<Copy className="size-3.5" />} onClick={onClick} />
        </Tooltip>
    );
}

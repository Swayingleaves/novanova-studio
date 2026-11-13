import type { CreditAmount } from "@/shared/lib/credit-amounts";
import type { ReactNode } from "react";

import type { AgentAction } from "@/features/canvas/api/agent";
import type { AgentActivityState, ThinkingBlockState } from "@/features/chat/types";
import type { GenerationStyleOption, SkillOption } from "@/services/api/server";
import type { PromptImageReference } from "@/features/generation/lib/image-reference-mentions";
import type { CreationMode } from "@/features/generation/lib/creation-mode-preference";

export type CreationConversationStatus = "running" | "unreadSuccess" | "unreadFailed" | "none";

export type CreationConversationItem = {
    id: string;
    title: string;
    subtitle: string;
    preview?: ReactNode;
    active: boolean;
    selected: boolean;
    status: CreationConversationStatus;
};

export type CreationReferenceChip = {
    id: string;
    label: string;
    preview: ReactNode;
    onRemove: () => void;
};

export type CreationStyleOption = GenerationStyleOption;

export type CreationThreadRound = {
    id: string;
    userText: string;
    /** 用户消息的行内展示内容；提供时替代纯文本，用于渲染 @ 图片/视频芯片。 */
    userContent?: ReactNode;
    userCopyText?: string;
    userAttachments?: ReactNode;
    thinkings?: ThinkingBlockState[];
    activeThinkingId?: string;
    /** 思考已结束或尚未开始，请求仍在进行且回复还没到达。 */
    awaitingReply?: boolean;
    activities?: AgentActivityState[];
    statusText: string;
    assistantText?: string;
    /** 工作流待确认阶段的结构化提示词草案。 */
    draftedPrompts?: Record<string, string>;
    resultContent: ReactNode;
    action?: AgentAction;
    actionBar?: ReactNode;
    /** choice 选项中需要禁用项的提示原因，key 为选项 value（如"确认生成"）。 */
    choiceDisabledReasons?: Record<string, string>;
    /** 跟随 choice 消息内联展示的补充内容（如工作流图片参数选择卡片），位于助手文本与选项按钮之间。 */
    choiceSettingsContent?: ReactNode;
};

export type CreationThreadSection = {
    id: string;
    label: string;
    rounds: CreationThreadRound[];
};

export type CreationSidebarProps = {
    heading: string;
    items: CreationConversationItem[];
    loading: boolean;
    hasMore: boolean;
    loadError: string | null;
    onLoadMore: () => void;
    onRetry: () => void;
    managementMode: boolean;
    hasSelection: boolean;
    onCreate: () => void;
    onToggleManagement: () => void;
    onToggleSelectAll: () => void;
    onDeleteSelected: () => void;
    onSelectConversation: (id: string) => void;
    onToggleConversation: (id: string, checked: boolean) => void;
    onRenameConversation: (id: string, title: string) => Promise<void>;
    onDeleteConversation: (id: string) => Promise<void>;
};

export type CreationComposerAction = {
    key: string;
    label: string;
    icon: ReactNode;
    className?: string;
    popoverContent?: ReactNode;
    placement?: "toolbar" | "submit";
    iconOnly?: boolean;
    disabled?: boolean;
    loading?: boolean;
    /** 紧跟在该动作后渲染的额外控件，例如常驻模型选择器。 */
    trailing?: ReactNode;
    onClick: () => void;
};

export type CreationMessageThreadProps = {
    sections: CreationThreadSection[];
    emptyState: ReactNode;
    onAtBottomChange?: (atBottom: boolean) => void;
    /** 用户点击 choice 选项按钮时回调，value 将作为用户消息发送 */
    onActionReply?: (value: string) => void;
    /** 用户点击修改提示词选项时回调，第二个参数为当前助手消息中的提示词草案。 */
    onPromptEdit?: (value: string, assistantText?: string, draftedPrompts?: Record<string, string>) => void;
    /** 用户点击上传图片动作时回调，打开图片文件选择，不发送消息 */
    onUploadImage?: () => void;
    /** 用户点击上传视频动作时回调，打开视频文件选择，不发送消息 */
    onUploadVideo?: () => void;
    /** 用户点击 action=adjust_video_duration 时回调，value 为对话要求的秒数，不发送消息 */
    onAdjustDuration?: (seconds: string) => void;
    /** 用户点击 action=ask_user_model_config 时回调，只打开更多设置，不发送消息 */
    onOpenModelSettings?: () => void;
};

export type CreationComposerProps = {
    agentLabel?: string;
    value: string;
    placeholder: string;
    references: CreationReferenceChip[];
    /** 启用行内素材引用；编号与本次提交的图片/视频附件顺序一致。 */
    imageReferences?: PromptImageReference[];
    styleOptions?: CreationStyleOption[];
    selectedStyles?: CreationStyleOption[];
    styleLoading?: boolean;
    styleError?: string | null;
    skillOptions?: SkillOption[];
    selectedSkill?: SkillOption | null;
    skillLoading?: boolean;
    skillError?: string | null;
    actions: CreationComposerAction[];
    /** 当前对话模式：agent 由主 Agent 规划优化，chat 直接提交生成。 */
    creationMode?: CreationMode;
    onCreationModeChange?: (mode: CreationMode) => void;
    /** 从技能市场「去创作」进入后锁定 Agent，不能切到 Chat。 */
    chatModeLocked?: boolean;
    running: boolean;
    queued?: boolean;
    canSubmit: boolean;
    /** 下一句将消耗的积分；null 表示无法报价，undefined 表示本次提交不涉及扣费、不展示价格。 */
    creditCost?: CreditAmount | null;
    /** 输入框上方展示的通用提示内容（如工作流参数选择卡片）。 */
    notice?: ReactNode;
    compact?: boolean;
    focusWhenValueSet?: boolean;
    stopping?: boolean;
    onChange: (value: string) => void;
    onStyleSelect?: (style: CreationStyleOption) => void;
    onStyleRemove?: (styleId: number) => void;
    onSkillSelect?: (skill: SkillOption) => void;
    onSkillRemove?: () => void;
    onPasteImages?: (files: File[]) => void;
    onSubmit: () => void;
    onStop?: () => void;
    /** 首页居中使用时去掉工作区左侧对齐偏移。 */
    embedded?: boolean;
    /** Agent 名称右侧的额外控件，例如首页的图片/视频切换。 */
    headerExtra?: ReactNode;
};

export type CreationWorkspaceSidebarProps = CreationSidebarProps & {
    mobileOpen: boolean;
    onOpenMobile: () => void;
    onCloseMobile: () => void;
};

export type CreationWorkspaceSettingsProps = {
    open: boolean;
    title: string;
    onClose: () => void;
    content: ReactNode;
};

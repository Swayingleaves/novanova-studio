import type { ReactNode } from "react";

import type { AgentAction } from "@/features/canvas/api/agent";
import type { AgentActivityState, ThinkingBlockState } from "@/features/chat/types";
import type { GenerationStyleOption, SkillOption } from "@/services/api/server";

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
    userCopyText?: string;
    userAttachments?: ReactNode;
    thinkings?: ThinkingBlockState[];
    activeThinkingId?: string;
    activities?: AgentActivityState[];
    statusText: string;
    assistantText?: string;
    resultContent: ReactNode;
    action?: AgentAction;
    actionBar?: ReactNode;
};

export type CreationThreadSection = {
    id: string;
    label: string;
    rounds: CreationThreadRound[];
};

export type CreationSidebarProps = {
    heading: string;
    items: CreationConversationItem[];
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
    onClick: () => void;
};

export type CreationMessageThreadProps = {
    sections: CreationThreadSection[];
    emptyState: ReactNode;
    onAtBottomChange?: (atBottom: boolean) => void;
    /** 用户点击 choice 选项按钮时回调，value 将作为用户消息发送 */
    onActionReply?: (value: string) => void;
    /** 用户点击 action=upload_image 的 choice 选项时回调，触发页面参考图上传 */
    onUploadImage?: () => void;
};

export type CreationComposerProps = {
    agentLabel?: string;
    value: string;
    placeholder: string;
    references: CreationReferenceChip[];
    styleOptions?: CreationStyleOption[];
    selectedStyles?: CreationStyleOption[];
    styleLoading?: boolean;
    styleError?: string | null;
    skillOptions?: SkillOption[];
    selectedSkill?: SkillOption | null;
    skillLoading?: boolean;
    skillError?: string | null;
    actions: CreationComposerAction[];
    running: boolean;
    queued?: boolean;
    canSubmit: boolean;
    creditCost: number | null;
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

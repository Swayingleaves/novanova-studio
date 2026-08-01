import type { ReactNode } from "react";

import type { AgentAction } from "@/features/canvas/api/agent";
import type { AgentActivityState, ThinkingBlockState } from "@/features/chat/types";

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

export type CreationStyleOption = {
    id: number;
    name: string;
    generationType: "image" | "video";
    stylePrompt?: string;
};

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
};

export type CreationComposerProps = {
    agentLabel?: string;
    value: string;
    placeholder: string;
    references: CreationReferenceChip[];
    styleOptions?: CreationStyleOption[];
    selectedStyles?: CreationStyleOption[];
    styleLoading?: boolean;
    actions: CreationComposerAction[];
    running: boolean;
    canSubmit: boolean;
    creditCost: number;
    compact?: boolean;
    focusWhenValueSet?: boolean;
    stopping?: boolean;
    onChange: (value: string) => void;
    onStyleSelect?: (style: CreationStyleOption) => void;
    onStyleRemove?: (styleId: number) => void;
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

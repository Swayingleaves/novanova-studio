"use client";

import { useState } from "react";
import { Drawer, Grid } from "antd";
import { PanelLeft } from "lucide-react";

import { CreationComposer } from "@/features/generation/components/creation-composer";
import { CreationConversationSidebar } from "@/features/generation/components/creation-conversation-sidebar";
import { CreationMessageThread } from "@/features/generation/components/creation-message-thread";
import { CreationSettingsModal } from "@/features/generation/components/creation-settings-modal";
import type { CreationComposerProps, CreationMessageThreadProps, CreationWorkspaceSettingsProps, CreationWorkspaceSidebarProps } from "@/features/generation/components/creation-workspace-types";

type CreationWorkspaceProps = {
    sidebar: CreationWorkspaceSidebarProps;
    thread: CreationMessageThreadProps;
    composer: CreationComposerProps;
    settings: CreationWorkspaceSettingsProps;
};

export function CreationWorkspace({ sidebar, thread, composer, settings }: CreationWorkspaceProps) {
    const screens = Grid.useBreakpoint();
    const isMobile = !screens.lg;
    const [threadAtBottom, setThreadAtBottom] = useState(true);

    return (
        <div className="studio-page flex h-full min-h-0 flex-col overflow-hidden">
            <header className="mx-4 flex min-h-[60px] shrink-0 items-center gap-4 border-b border-[var(--studio-line)] text-[11px] sm:mx-6">
                <div className="flex min-w-0 items-center gap-3 uppercase text-[var(--studio-muted)]">
                    <strong className="truncate text-[var(--studio-ink)]">{composer.agentLabel || "Visual Agent"}</strong>
                    <span className="hidden h-px w-10 bg-[var(--studio-line-strong)] sm:block" />
                    <span className="hidden sm:block">Visual System / 01</span>
                </div>
            </header>
            <main className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)]">
                <aside className="hidden min-h-0 overflow-hidden p-3 lg:block">
                    <div className="studio-sidebar-rail h-full overflow-hidden">
                        <CreationConversationSidebar
                            heading={sidebar.heading}
                            items={sidebar.items}
                            managementMode={sidebar.managementMode}
                            hasSelection={sidebar.hasSelection}
                            onCreate={sidebar.onCreate}
                            onToggleManagement={sidebar.onToggleManagement}
                            onToggleSelectAll={sidebar.onToggleSelectAll}
                            onDeleteSelected={sidebar.onDeleteSelected}
                            onSelectConversation={sidebar.onSelectConversation}
                            onToggleConversation={sidebar.onToggleConversation}
                            onRenameConversation={sidebar.onRenameConversation}
                            onDeleteConversation={sidebar.onDeleteConversation}
                        />
                    </div>
                </aside>

                <section className="relative flex min-h-0 min-w-0 flex-col overflow-hidden">
                    <CreationMessageThread {...thread} onAtBottomChange={setThreadAtBottom} />
                    <CreationComposer {...composer} compact={!threadAtBottom} />
                </section>
            </main>

            <CreationSettingsModal open={settings.open} title={settings.title} onClose={settings.onClose}>
                {settings.content}
            </CreationSettingsModal>

            {isMobile ? (
                <>
                    <Drawer title={sidebar.heading} placement="left" open={sidebar.mobileOpen} onClose={sidebar.onCloseMobile}>
                        <CreationConversationSidebar
                            heading={sidebar.heading}
                            items={sidebar.items}
                            managementMode={sidebar.managementMode}
                            hasSelection={sidebar.hasSelection}
                            onCreate={sidebar.onCreate}
                            onToggleManagement={sidebar.onToggleManagement}
                            onToggleSelectAll={sidebar.onToggleSelectAll}
                            onDeleteSelected={sidebar.onDeleteSelected}
                            onSelectConversation={sidebar.onSelectConversation}
                            onToggleConversation={sidebar.onToggleConversation}
                            onRenameConversation={sidebar.onRenameConversation}
                            onDeleteConversation={sidebar.onDeleteConversation}
                            compact
                        />
                    </Drawer>

                    <button
                        type="button"
                        className="fixed bottom-20 left-4 z-20 grid size-10 place-items-center rounded-full border border-[var(--studio-line)] bg-[var(--studio-glass-strong)] text-[var(--studio-ink)] shadow-[var(--studio-shadow)] backdrop-blur lg:hidden"
                        onClick={sidebar.onOpenMobile}
                        aria-label="打开会话列表"
                    >
                        <PanelLeft className="size-4" />
                    </button>
                </>
            ) : null}
        </div>
    );
}

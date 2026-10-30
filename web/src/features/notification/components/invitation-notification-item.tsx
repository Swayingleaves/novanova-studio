"use client";

import { useTranslation } from "@/features/locale/use-translation";
import { switchSpace } from "@/features/team/switch-space";
import { cn } from "@/shared/lib/utils";
import type { TeamInvitation } from "@/services/api/team";

type InvitationNotificationItemProps = {
    invitation: TeamInvitation;
    /** 侧栏浮层更窄，用紧凑内边距。 */
    compact?: boolean;
};

/** 待接受邀请作为站内通知条目，点击离开当前空间并定位到我的团队。 */
export function InvitationNotificationItem({ invitation, compact = false }: InvitationNotificationItemProps) {
    const translate = useTranslation();
    return (
        <button
            type="button"
            className={cn("block w-full border-b border-[var(--studio-line)] bg-[var(--studio-primary-soft)] text-left transition hover:bg-[var(--studio-surface-hover)]", compact ? "px-3 py-2.5" : "px-4 py-3")}
            onClick={() => void switchSpace(`/teams?invitation=${encodeURIComponent(invitation.id)}`)}
        >
            <span className="flex items-start justify-between gap-2">
                <span className={cn("line-clamp-1 font-medium text-[var(--studio-ink)]", compact ? "text-sm" : "studio-title text-sm")}>{translate("appShell.teamInvitationFrom", { name: invitation.name })}</span>
                <span className="mt-1 size-1.5 shrink-0 rounded-full bg-[var(--studio-primary)]" aria-hidden="true" />
            </span>
            <span className={cn("mt-1 block text-xs leading-5 text-[var(--studio-muted)]", !compact && "studio-subtitle")}>{translate("appShell.teamInvitationHint")}</span>
        </button>
    );
}

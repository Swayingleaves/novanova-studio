"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { App, Button, Empty, Skeleton, Tag } from "antd";
import { UsersRound } from "lucide-react";
import { acceptInvitation, listMyInvitations, listMyTeams } from "@/services/api/team";
import { switchSpace } from "@/features/team/switch-space";
import { useUserStore } from "@/features/auth/stores/use-user-store";

/** 平台空间的团队切换与邀请确认，切换前先完成当前编辑保存。 */
export default function TeamsPage() {
    const { message } = App.useApp();
    const [busy, setBusy] = useState(false);
    const user = useUserStore((state) => state.user);
    const teams = useQuery({ queryKey: ["myTeams", user?.id], queryFn: listMyTeams, enabled: Boolean(user) });
    const invitations = useQuery({ queryKey: ["myTeamInvitations", user?.id], queryFn: listMyInvitations, enabled: Boolean(user) });
    const enter = async (path: string) => {
        setBusy(true);
        if (!await switchSpace(path)) setBusy(false);
    };
    return <main className="studio-page h-full overflow-auto"><div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-8">
        <header><h1 className="studio-title text-2xl font-semibold">我的团队</h1><p className="studio-subtitle mt-2">每个团队的配置、创作内容和团队积分独立保存。</p></header>
        <Button className="self-start" loading={busy} onClick={() => void enter("/")}>进入平台空间</Button>
        {teams.error ? <p role="alert">{teams.error.message}</p> : null}
        <section aria-labelledby="joined-teams-title" aria-busy={teams.isLoading}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 id="joined-teams-title" className="studio-title text-lg font-semibold">已加入团队</h2>
                {teams.data ? <p className="studio-subtitle text-sm" aria-live="polite">共 {teams.data.length} 个团队</p> : null}
            </div>
            {teams.isLoading ? <div className="grid gap-4 sm:grid-cols-2" aria-hidden="true">
                {[0, 1].map((index) => <div key={index} className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface)] p-5"><Skeleton avatar paragraph={{ rows: 3 }} /></div>)}
            </div> : teams.data?.length ? <ul role="list" className="grid gap-4 sm:grid-cols-2">
                {teams.data.map((team) => <li key={team.id} className="flex min-w-0 flex-col gap-5 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface)] p-5">
                    <div className="flex min-w-0 items-start gap-4">
                        <div className="grid size-14 shrink-0 place-items-center rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] text-[var(--studio-muted)]">
                            {team.logoUrl ? <img src={team.logoUrl} width={48} height={48} className="size-12 object-contain" alt="" loading="lazy" /> : <UsersRound className="size-7" strokeWidth={1.5} aria-hidden="true" />}
                        </div>
                        <div className="min-w-0 flex-1">
                            <h3 className="studio-title break-all text-base font-semibold">{team.name}</h3>
                            <div className="mt-2 flex flex-wrap gap-1"><Tag>{team.memberRole === "administrator" ? "团队管理员" : "团队成员"}</Tag>{!team.enabled ? <Tag>团队已禁用</Tag> : null}{team.memberStatus === "disabled" ? <Tag>成员已禁用</Tag> : null}</div>
                        </div>
                    </div>
                    {team.introduction ? <p className="studio-subtitle line-clamp-2 break-words text-sm">{team.introduction}</p> : null}
                    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                        <dt className="studio-subtitle">加入账号</dt><dd className="studio-title break-all">{user?.username}</dd>
                        <dt className="studio-subtitle">管理员账号</dt><dd className="studio-title break-all">{team.administratorUsername ?? "未设置"}</dd>
                    </dl>
                    <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-[var(--studio-line)] pt-4">
                        <span className="studio-subtitle min-w-0 break-all text-xs">/team/{team.teamSlug}</span>
                        <Button disabled={!team.enabled || team.memberStatus !== "active"} loading={busy} onClick={() => void enter(`/team/${team.teamSlug}`)}>进入团队</Button>
                    </div>
                </li>)}
            </ul> : !teams.error ? <Empty description="尚未加入团队" /> : null}
        </section>
        <section aria-labelledby="team-invitations-title" aria-busy={invitations.isLoading}>
            <h2 id="team-invitations-title" className="studio-title mb-4 text-lg font-semibold">待接受邀请</h2>
            {invitations.error ? <p role="alert">{invitations.error.message}</p> : null}
            <Skeleton loading={invitations.isLoading} paragraph={{ rows: 1 }}>
                {invitations.data?.length ? <ul role="list" className="divide-y divide-[var(--studio-line)]">
                    {invitations.data.map((invitation) => <li key={invitation.id} className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                            <p className="studio-title break-all">{invitation.name}</p>
                            <p className="studio-subtitle mt-1 text-sm">{invitation.memberRole === "administrator" ? "主管理员" : "成员"}邀请，有效期至 {new Date(invitation.expiresAt).toLocaleString("zh-CN")}</p>
                        </div>
                        <Button className="self-start sm:shrink-0 sm:self-auto" loading={busy} onClick={async () => { setBusy(true); try { await acceptInvitation(invitation.id); await Promise.all([teams.refetch(), invitations.refetch()]); message.success("已加入团队"); } catch (error) { message.error(error instanceof Error ? error.message : "接受失败"); } finally { setBusy(false); } }}>接受邀请</Button>
                    </li>)}
                </ul> : <Empty description="暂无邀请" />}
            </Skeleton>
        </section>
    </div></main>;
}

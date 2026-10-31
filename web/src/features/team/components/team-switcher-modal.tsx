"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Empty, Modal, Skeleton, Tag } from "antd";
import { UsersRound } from "lucide-react";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { listMyTeams, type JoinedTeam } from "@/services/api/team";
import { cn } from "@/shared/lib/utils";
import { useTeamStore } from "../stores/use-team-store";
import { finishLoginSpaceSelection, useTeamSwitcherStore } from "../stores/use-team-switcher-store";
import { switchSpace } from "../switch-space";

/** 复用团队卡片完成登录空间选择与创作期间的手动切换。 */
export function TeamSwitcherModal() {
    const user = useUserStore((state) => state.user);
    const team = useTeamStore((state) => state.team);
    const { loginTarget, switchingTo } = useTeamSwitcherStore();
    const [closing, setClosing] = useState(false);
    const myTeams = useQuery({
        queryKey: loginTarget ? ["myTeams", user?.id, "login"] : ["myTeams", user?.id],
        queryFn: ({ signal }) => listMyTeams({ signal }),
        enabled: Boolean(user && user.role !== "admin"),
        refetchOnMount: "always",
    });
    // 每次打开都获取最新成员关系；旧缓存不能用于决定登录去向或团队权限。
    const loaded = myTeams.isFetchedAfterMount && !myTeams.isFetching && !myTeams.isError;
    const canClose = !loginTarget && !switchingTo;
    useEffect(() => {
        if (loginTarget && loaded && myTeams.data?.length === 0) finishLoginSpaceSelection();
    }, [loaded, loginTarget, myTeams.data]);

    const enterSpace = async (option: JoinedTeam | null) => {
        if (useTeamSwitcherStore.getState().switchingTo) return;
        if (loginTarget) { finishLoginSpaceSelection(option); return; }
        const destination = option ? `/team/${option.teamSlug}` : "/";
        useTeamSwitcherStore.setState({ switchingTo: destination });
        if (!await switchSpace(destination)) useTeamSwitcherStore.setState({ switchingTo: "" });
    };
    const close = () => { if (canClose) setClosing(true); };

    return <Modal title="切换团队" open={!closing && (!loginTarget || myTeams.isError || (loaded && Boolean(myTeams.data?.length)))} width={640}
        destroyOnHidden closable={canClose} keyboard={canClose} mask={{ closable: canClose }} onCancel={close}
        afterClose={() => { if (closing) useTeamSwitcherStore.setState({ open: false }); }} footer={
            <div className="flex flex-wrap items-center justify-between gap-3">
                {loginTarget ? <span className="studio-subtitle text-sm">请选择要进入的空间</span> : <Button disabled={Boolean(switchingTo)} onClick={close}>取消</Button>}
                {loginTarget || team ? <Button loading={Boolean(switchingTo) && (switchingTo === "/" || switchingTo === loginTarget)} disabled={Boolean(switchingTo)} onClick={() => void enterSpace(null)}>进入平台空间</Button> : <span className="studio-subtitle text-sm">当前为平台空间</span>}
            </div>
        }>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm">
            <p className="studio-subtitle">{loginTarget ? "登录成功，请选择空间继续" : `当前空间：${team?.name || "平台空间"}`}</p>
            <span className="studio-subtitle">共 {myTeams.data?.length || 0} 个团队</span>
        </div>
        {myTeams.error ? <div role="alert" className="mb-4 flex items-center justify-between gap-3"><span>{myTeams.error.message}</span><Button onClick={() => void myTeams.refetch()} loading={myTeams.isFetching}>重试</Button></div> : null}
        {!loaded && !myTeams.error ? <Skeleton active paragraph={{ rows: 3 }} /> : myTeams.data?.length ? <ul role="list" className="max-h-[60dvh] space-y-3 overflow-y-auto">
            {myTeams.data.map((option) => {
                const current = !loginTarget && option.id === team?.id;
                const destination = `/team/${option.teamSlug}`;
                return <li key={option.id} className={cn("flex flex-wrap items-center gap-3 rounded-lg border bg-[var(--studio-surface)] p-4", current ? "border-[var(--studio-action)]" : "border-[var(--studio-line)]")}>
                    <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-[var(--studio-surface-soft)] text-[var(--studio-muted)]">
                        {option.logoUrl ? <img src={option.logoUrl} width={40} height={40} className="size-10 object-contain" alt="" /> : <UsersRound className="size-5" aria-hidden="true" />}
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="studio-title break-all font-medium">{option.name}</p>
                        <div className="mt-1 flex flex-wrap gap-1"><Tag>{option.memberRole === "administrator" ? "管理员" : "成员"}</Tag>{!option.enabled ? <Tag>团队已禁用</Tag> : null}{option.memberStatus === "disabled" ? <Tag>成员已禁用</Tag> : null}</div>
                    </div>
                    <Button disabled={current || Boolean(switchingTo) || !option.enabled || option.memberStatus !== "active" || !loaded} loading={switchingTo === destination} onClick={() => void enterSpace(option)}>{current ? "当前团队" : "进入团队"}</Button>
                </li>;
            })}
        </ul> : !myTeams.error ? <Empty description="尚未加入团队" /> : null}
    </Modal>;
}

"use client";

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Spin } from "antd";
import { listConfigurationModes } from "@/services/api/team";
import { useTeamStore } from "@/features/team/stores/use-team-store";

/** 内容继承时提供只读预览，配合服务端禁止修改全局条目。 */
export function TeamContentScope({ moduleName, children }: { moduleName: string; children: ReactNode }) {
    const team = useTeamStore((state) => state.team);
    const modes = useQuery({ queryKey: ["teamModes", team?.id], queryFn: listConfigurationModes, enabled: !!team });
    if (!team) return children;
    if (modes.isLoading) return <Spin />;
    if (modes.error) return <Alert type="error" title={modes.error.message} />;
    const inherited = modes.data?.find((mode) => mode.moduleName === moduleName)?.inheritGlobal !== false;
    return <div className="flex flex-col gap-4">{inherited ? <Alert type="info" title="当前模块继承全局，仅供预览。请在“团队管理 → 内容继承”切换为团队独立配置后编辑。" /> : null}<fieldset disabled={inherited} className="min-w-0 border-0 p-0">{children}</fieldset></div>;
}

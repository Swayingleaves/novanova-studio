"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { useTranslation } from "@/features/locale/use-translation";
import { ResetAccountPasswordModal } from "./reset-account-password-modal";
import { useQuery } from "@tanstack/react-query";
import { Alert, App, Button, Checkbox, Form, Image, Input, InputNumber, Modal, Select, Space, Switch, Table, Tabs, Tag } from "antd";
import { serverGet, serverPost } from "@/services/api/server";
import { listTeams, resendInvitation, getManagedTeam, listMembers, listInvitations, listAvailableResources, listConfigurationModes, listResourcePreferences, listTeamBills, listTeamCreditTransactions, updateMemberRole, type ManagedTeam, type TeamMember } from "@/services/api/team";
import { useConfigStore } from "@/features/settings/stores/use-config-store";
import { useTeamStore } from "@/features/team/stores/use-team-store";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { uploadImage } from "@/features/storage/services/image-storage";
import { creditAmount, creditText } from "@/shared/lib/credit-amounts";

/** 超级管理员的团队清单、开关、人数上限及显式平台资源授权。 */
export function TeamManagement() {
    const translate = useTranslation();
    const { message } = App.useApp();
    const teams = useQuery({ queryKey: ["adminTeams"], queryFn: listTeams });
    const resources = useQuery({ queryKey: ["platformGrantResources"], queryFn: listAvailableResources });
    const modelGroups = [...new Set((resources.data || []).filter((item) => item.resourceType === "model").map((item) => item.channelName || "其他渠道"))].map((channel) => ({ label: channel, options: (resources.data || []).filter((item) => item.resourceType === "model" && (item.channelName || "其他渠道") === channel).map((item) => ({ value: item.resourceId, label: `${item.name} · ${item.modelType}` })) }));
    const [creating, setCreating] = useState(false);
    const [selected, setSelected] = useState<ManagedTeam | null>(null);
    const [busy, setBusy] = useState(false);
    const [form] = Form.useForm();
    const [settings] = Form.useForm();
    const perform = async (action: () => Promise<unknown>) => { setBusy(true); try { await action(); await teams.refetch(); message.success("已保存"); return true; } catch (error) { message.error(error instanceof Error ? error.message : "保存失败"); return false; } finally { setBusy(false); } };
    const edit = async (team: ManagedTeam) => {
        try {
            const grants = await serverGet<{ resourceType: string; resourceId: string }[]>(`/admin/team/listResourceGrants?teamId=${team.id}`);
            settings.setFieldsValue({ ...team, teamId: team.id, modelIds: grants.filter((item) => item.resourceType === "model").map((item) => item.resourceId), objectStorageIds: grants.filter((item) => item.resourceType === "objectStorage").map((item) => item.resourceId) });
            setSelected(team);
        } catch (error) { message.error(error instanceof Error ? error.message : "读取授权失败"); }
    };
    return <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between"><p className="studio-subtitle">管理团队账号、成员名额和平台资源授权。</p><Button type="primary" onClick={() => { form.resetFields(); setCreating(true); }}>创建团队</Button></div>
        {teams.error ? <Alert type="error" title={teams.error.message} /> : null}
        <Table rowKey="id" loading={teams.isLoading} dataSource={teams.data || []} scroll={{ x: 800 }} columns={[
            { title: "团队", render: (_, team: ManagedTeam) => <div><strong>{team.name}</strong><div className="studio-subtitle">/team/{team.teamSlug}</div></div> },
            { title: "管理员", render: (_, team: ManagedTeam) => team.administratorUserId == null ? <Tag>{translate("administration.pendingAdministratorInvitation")}</Tag> : <div>{team.administratorNickname || team.administratorUsername}<div className="studio-subtitle">{team.administratorUsername}</div></div> },
            { title: "子账号", render: (_, team: ManagedTeam) => `${team.memberCount} / ${team.memberLimit}` },
            { title: "状态", render: (_, team: ManagedTeam) => <Tag color={team.enabled ? "success" : "default"}>{team.enabled ? "启用" : "禁用"}</Tag> },
            { title: "操作", render: (_, team: ManagedTeam) => <Button onClick={() => void edit(team)}>设置与授权</Button> },
        ]} />
        <Modal title="创建团队与主管理员" forceRender open={creating} confirmLoading={busy} onCancel={() => setCreating(false)} onOk={async () => { const values = await form.validateFields(); if (await perform(() => serverPost("/admin/team/createTeam", values))) setCreating(false); }}>
            <Alert className="mb-4" type="info" title={translate("administration.newTeamAccountNotice")} />
            <Form form={form} layout="vertical"><Form.Item name="name" label="团队名称" rules={[{ required: true }, { max: 50, message: "团队名称最多 50 字" }]}><Input maxLength={50} showCount /></Form.Item><Form.Item name="teamSlug" label="团队 URL 标识" rules={[{ required: true }, { pattern: /^[a-z0-9][a-z0-9-]{2,63}$/, message: "使用3至64位小写字母、数字或连字符" }]}><Input prefix="/team/" /></Form.Item><Form.Item name="memberLimit" label="最多子账号数量" rules={[{ required: true }]}><InputNumber min={0} precision={0} className="w-full!" /></Form.Item><Form.Item name="account" label={translate("administration.administratorAccount")} extra={translate("auth.usernameRule")} rules={[{ required: true, whitespace: true }]}><Input autoComplete="username" placeholder={translate("auth.enterAccount")} /></Form.Item><Form.Item name="nickname" label="管理员昵称"><Input /></Form.Item><Form.Item name="password" label="新账号登录密码" rules={[{ min: 8, message: "至少8位" }]}><Input.Password autoComplete="new-password" placeholder={translate("administration.existingAccountPasswordHint")} /></Form.Item></Form>
        </Modal>
        <Modal title={`团队设置 · ${selected?.name || ""}`} forceRender open={!!selected} confirmLoading={busy} onCancel={() => setSelected(null)} onOk={async () => { const values = await settings.validateFields(); if (await perform(async () => { await serverPost("/admin/team/updateTeamSettings", { teamId: selected!.id, enabled: values.enabled, memberLimit: values.memberLimit }); await serverPost("/admin/team/updateResourceGrants", { teamId: selected!.id, modelIds: values.modelIds || [], objectStorageIds: values.objectStorageIds || [] }); })) setSelected(null); }}>
            <Form form={settings} layout="vertical"><Form.Item name="enabled" label="启用团队" valuePropName="checked"><Switch /></Form.Item><Form.Item name="memberLimit" label="最多子账号数量" rules={[{ required: true }]}><InputNumber min={selected?.memberCount || 0} precision={0} className="w-full!" /></Form.Item><Form.Item name="modelIds" label="开放平台模型"><Select mode="multiple" optionFilterProp="label" options={modelGroups} /></Form.Item><Form.Item name="objectStorageIds" label="开放平台 OSS"><Select mode="multiple" options={(resources.data || []).filter((item) => item.resourceType === "objectStorage").map((item) => ({ value: item.resourceId, label: item.name }))} /></Form.Item></Form>
        </Modal>
    </div>;
}

/** 团队管理复用现有内容与资源后台，仅新增团队关系、品牌和继承控制。 */
export function CurrentTeamManagement() {
    const translate = useTranslation();
    const { message, modal } = App.useApp();
    const team = useTeamStore((state) => state.team)!;
    const currentUserId = useUserStore((state) => state.user?.id);
    const overview = useQuery({ queryKey: ["managedTeam", team.id], queryFn: getManagedTeam });
    const members = useQuery({ queryKey: ["teamMembers", team.id], queryFn: listMembers });
    const invitations = useQuery({ queryKey: ["teamInvitations", team.id], queryFn: listInvitations });
    const modes = useQuery({ queryKey: ["teamModes", team.id], queryFn: listConfigurationModes });
    const resources = useQuery({ queryKey: ["teamResources", team.id], queryFn: listAvailableResources });
    const preferences = useQuery({ queryKey: ["teamPreferences", team.id], queryFn: listResourcePreferences });
    const transactions = useQuery({ queryKey: ["teamTransactions", team.id], queryFn: listTeamCreditTransactions });
    const bills = useQuery({ queryKey: ["teamStorageBills", team.id], queryFn: listTeamBills });
    const [creating, setCreating] = useState(false);
    const [inviting, setInviting] = useState(false);
    const [target, setTarget] = useState<TeamMember | null>(null);
    const [passwordTarget, setPasswordTarget] = useState<TeamMember | null>(null);
    const [form] = Form.useForm();
    const [inviteForm] = Form.useForm();
    const [creditForm] = Form.useForm();
    const [brandForm] = Form.useForm();
    const logoUrl = Form.useWatch("logoUrl", brandForm);
    const logoInputRef = useRef<HTMLInputElement>(null);
    const [logoUploading, setLogoUploading] = useState(false);
    const [busy, setBusy] = useState(false);
    const perform = async (action: () => Promise<unknown>) => { setBusy(true); try { await action(); await Promise.all([overview.refetch(), members.refetch(), invitations.refetch(), modes.refetch(), preferences.refetch(), transactions.refetch()]); message.success("操作完成"); return true; } catch (error) { message.error(error instanceof Error ? error.message : "操作失败"); return false; } finally { setBusy(false); } };
    const saveResourcePreference = async (input: Record<string, unknown>) => { await serverPost("/team/saveResourcePreference", input); await useConfigStore.getState().refreshModelConfiguration(); };
    const moduleLabels: Record<string, string> = { prompts: "提示词库", notifications: "消息管理", styles: "风格管理", skills: "技能管理", homepage: "首页展示" };
    const total = creditAmount(overview.data?.consumedCredits || "0");
    const roleOptions = [{ value: "administrator", label: translate("administration.teamAdministrator") }, { value: "member", label: translate("administration.teamMember") }];
    const changeMemberRole = (member: TeamMember, memberRole: TeamMember["memberRole"]) => modal.confirm({
        title: translate("administration.changeTeamMemberRole"),
        content: translate(memberRole === "administrator" ? "administration.grantTeamAdministratorNotice" : "administration.revokeTeamAdministratorNotice", { name: member.username }),
        okText: translate("administration.confirmAdjustment"),
        cancelText: translate("administration.cancel"),
        onOk: async () => { if (!await perform(() => updateMemberRole({ userId: member.userId, memberRole }))) throw new Error("身份授权失败"); },
    });
    const uploadLogo = async (file?: File) => {
        if (!file) return;
        if (!file.type.startsWith("image/")) {
            message.error(translate("administration.selectAnImageFile"));
            return;
        }
        if (file.size > 2 * 1024 * 1024) {
            message.error("Logo 图片不能超过 2 MB");
            return;
        }
        setLogoUploading(true);
        try {
            const uploaded = await uploadImage(file);
            brandForm.setFieldValue("logoUrl", uploaded.url);
            message.success("Logo 已上传，保存资料后生效");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Logo 上传失败");
        } finally {
            setLogoUploading(false);
        }
    };
    return <><Tabs items={[
        { key: "members", label: "成员与统计", children: <div className="flex flex-col gap-4"><div className="flex flex-wrap items-center justify-between gap-3"><p>子账号 {(members.data || []).filter((member) => !member.isPrimaryAdministrator).length} 人 · 本团队累计消耗 {creditText(total.toFixed())} 积分</p><Space><Button onClick={() => setInviting(true)}>{translate("administration.inviteAccount")}</Button><Button type="primary" onClick={() => setCreating(true)}>创建子账号</Button></Space></div><Table rowKey="userId" loading={members.isLoading} dataSource={members.data || []} scroll={{ x: 960 }} columns={[
            { title: "成员", render: (_, member: TeamMember) => <div>{member.nickname || member.username}<div className="studio-subtitle">{member.username}</div></div> },
            { title: translate("administration.teamIdentity"), render: (_, member: TeamMember) => member.isPrimaryAdministrator ? <Tag>{translate("administration.primaryTeamAdministrator")}</Tag> : <Select aria-label={translate("administration.teamMemberRoleLabel", { name: member.username })} className="w-32" value={member.memberRole} options={roleOptions} disabled={busy || String(member.userId) === currentUserId} onChange={(value) => changeMemberRole(member, value)} /> },
            { title: "状态", render: (_, member: TeamMember) => member.memberStatus === "active" ? "正常" : "禁用" },
            { title: "团队积分", render: (_, member: TeamMember) => creditText(member.teamCreditBalance) },
            { title: "本团队消耗", render: (_, member: TeamMember) => creditText(member.consumedCredits) },
            { title: "操作", render: (_, member: TeamMember) => member.memberRole === "member" ? <Space wrap>{member.canResetPassword ? <Button size="small" onClick={() => setPasswordTarget(member)}>{translate("administration.resetPassword")}</Button> : null}<Button size="small" onClick={() => { creditForm.resetFields(); setTarget(member); }}>调整积分</Button><Button size="small" onClick={() => void perform(() => serverPost("/team/updateMemberStatus", { userId: member.userId, enabled: member.memberStatus !== "active" }))}>{member.memberStatus === "active" ? "禁用" : "恢复"}</Button><Button size="small" danger onClick={() => modal.confirm({ title: "移除成员并清理本团队创作数据？", content: "清理后不可恢复。历史流水和剩余团队积分保留，其他空间不受影响。", onOk: () => perform(() => serverPost("/team/removeMember", { userId: member.userId })) })}>移除</Button></Space> : <Button size="small" onClick={() => { creditForm.resetFields(); setTarget(member); }}>调整积分</Button> },
        ]} /><Table rowKey="id" size="small" dataSource={invitations.data || []} columns={[{ title: translate("administration.invitedAccount"), dataIndex: "invitedAccount" }, { title: "状态", dataIndex: "invitationStatus" }, { title: "到期时间", dataIndex: "expiresAt" }, { title: "操作", render: (_, invitation) => invitation.invitationStatus !== "accepted" ? <Space><Button onClick={() => void perform(() => resendInvitation(invitation.id))}>重新邀请</Button>{invitation.invitationStatus === "pending" ? <Button onClick={() => void perform(() => serverPost("/team/revokeInvitation", { invitationId: invitation.id }))}>撤销</Button> : null}</Space> : null }]} /></div> },
        { key: "brand", label: "团队资料", forceRender: true, children: <Form form={brandForm} layout="vertical" disabled={busy || logoUploading} initialValues={{ name: team.name, introduction: team.introduction || "", logoUrl: team.logoUrl || "" }} onFinish={(values) => void perform(async () => { await serverPost("/team/updateTeam", values); useTeamStore.getState().setTeam({ ...team, ...values }); })}>
            <Form.Item name="name" label="团队名称" rules={[{ required: true }, { max: 50, message: "团队名称最多 50 字" }]}><Input maxLength={50} showCount /></Form.Item>
            <Form.Item name="introduction" label="团队介绍" rules={[{ max: 200, message: "团队介绍最多 200 字" }]}><Input.TextArea maxLength={200} showCount rows={3} /></Form.Item>
            <Form.Item name="logoUrl" label="Logo 地址"><Input allowClear placeholder="填写图片链接，留空使用平台默认品牌" /></Form.Item>
            <div className="mb-6 flex items-start gap-3">
                {logoUrl ? <Image src={logoUrl} alt="预览团队 Logo" width={64} height={64} classNames={{ root: "shrink-0 overflow-hidden rounded-md border border-[var(--studio-line)]" }} styles={{ image: { objectFit: "contain" } }} /> : null}
                <div className="min-w-0">
                    <input ref={logoInputRef} hidden type="file" accept="image/*" disabled={busy || logoUploading} onChange={(event) => { void uploadLogo(event.target.files?.[0]); event.target.value = ""; }} />
                    <Button icon={<Upload className="size-4" />} loading={logoUploading} onClick={() => logoInputRef.current?.click()}>上传 Logo</Button>
                    <p className="studio-subtitle mt-2">支持不超过 2 MB 的图片，上传后点击“保存资料”生效。</p>
                </div>
            </div>
            <Button type="primary" htmlType="submit" loading={busy}>保存资料</Button>
        </Form> },
        { key: "inheritance", label: "内容继承", children: <div className="flex flex-col gap-5"><Alert type="info" title="每个模块独立选择实时继承全局或使用团队内容。切换模式不会删除原有团队配置。" />{(modes.data || []).map((mode) => <div key={mode.moduleName} className="flex items-center justify-between border-b border-[var(--studio-line)] py-3"><span>{moduleLabels[mode.moduleName]}</span><Select value={mode.inheritGlobal ? "global" : "team"} className="w-44" options={[{ value: "global", label: "继承全局" }, { value: "team", label: "团队独立配置" }]} onChange={(value) => void perform(() => serverPost("/team/updateConfigurationMode", { moduleName: mode.moduleName, inheritGlobal: value === "global" }))} /></div>)}</div> },
        { key: "resources", label: "资源与默认项", children: <Table rowKey="resourceId" dataSource={resources.data || []} columns={[{ title: "资源", render: (_, resource) => `${resource.channelName ? resource.channelName + " / " : ""}${resource.name}` }, { title: "来源", render: (_, resource) => resource.ownerTeamId === 0 ? "平台授权 · 平台积分" : "团队自有 · 团队积分" }, { title: "启用", render: (_, resource) => { const current = preferences.data?.find((item) => item.resourceId === resource.resourceId); return <Switch checked={!!current?.enabled} onChange={(enabled) => void perform(() => saveResourcePreference({ resourceId: resource.resourceId, resourceType: resource.resourceType, enabled, defaultResource: false }))} />; } }, { title: "默认", render: (_, resource) => <Button disabled={preferences.data?.some((item) => item.resourceId === resource.resourceId && item.isDefault)} onClick={() => void perform(() => saveResourcePreference({ resourceId: resource.resourceId, resourceType: resource.resourceType, enabled: true, defaultResource: true }))}>{preferences.data?.some((item) => item.resourceId === resource.resourceId && item.isDefault) ? "当前默认" : "设为默认"}</Button> }]} /> },
        { key: "transactions", label: "积分明细", children: <Table rowKey="id" loading={transactions.isLoading} dataSource={transactions.data || []} scroll={{ x: 700 }} columns={[{ title: "成员", dataIndex: "username" }, { title: "积分变动", render: (_, transaction) => creditText(transaction.changeAmount) }, { title: "钱包", render: (_, transaction) => transaction.walletTeamId === 0 ? "平台积分" : "团队积分" }, { title: "本次收入归属", render: (_, transaction) => transaction.transactionType === "task_charge" || transaction.transactionType === "task_refund" || transaction.transactionType === "storage_charge" ? transaction.beneficiaryTeamId === 0 ? "平台" : "团队" : "—" }, { title: "团队余额", render: (_, transaction) => transaction.balanceAfter === null ? "—" : creditText(transaction.balanceAfter) }, { title: "原因", dataIndex: "reason" }, { title: "时间", dataIndex: "createdAt" }]} /> },
        { key: "storageBills", label: "存储账单", children: <Table rowKey="id" dataSource={bills.data || []} columns={[{ title: "月份", dataIndex: "billingMonth" }, { title: "用户", dataIndex: "userId" }, { title: "归属", render: (_, bill) => bill.ownerTeamId === 0 ? "平台积分" : "团队积分" }, { title: "应付积分", render: (_, bill) => creditText(bill.credits) }, { title: "状态", render: (_, bill) => bill.billStatus === "paid" ? "已支付" : "待补足余额" }]} /> },
    ]} />
        <ResetAccountPasswordModal target={passwordTarget} onClose={() => setPasswordTarget(null)} onReset={() => members.refetch()} />
        <Modal title="创建子账号" open={creating} confirmLoading={busy} onCancel={() => setCreating(false)} onOk={async () => { const values = await form.validateFields(); if (await perform(() => serverPost("/team/createMember", values))) { setCreating(false); form.resetFields(); } }}><Form form={form} layout="vertical"><Form.Item name="account" label={translate("auth.account")} extra={translate("auth.usernameRule")} rules={[{ required: true, whitespace: true }]}><Input autoComplete="username" /></Form.Item><Form.Item name="nickname" label="昵称"><Input maxLength={50} /></Form.Item><Form.Item name="password" label="登录密码" rules={[{ required: true }, { min: 8 }]}><Input.Password autoComplete="new-password" /></Form.Item></Form></Modal>
        <Modal title={translate("administration.inviteAccountTitle")} open={inviting} confirmLoading={busy} onCancel={() => setInviting(false)} onOk={async () => { const values = await inviteForm.validateFields(); if (await perform(() => serverPost("/team/inviteMember", values))) { setInviting(false); inviteForm.resetFields(); } }}><p className="studio-subtitle mb-4">{translate("administration.inviteAcceptanceHint")}</p><Form form={inviteForm} layout="vertical"><Form.Item name="account" label={translate("administration.invitedAccount")} rules={[{ required: true, whitespace: true }]}><Input autoComplete="off" placeholder={translate("auth.enterAccount")} /></Form.Item></Form></Modal>
        <Modal title={`调整团队积分 · ${target?.username || ""}`} forceRender open={!!target} confirmLoading={busy} onCancel={() => setTarget(null)} onOk={async () => { const values = await creditForm.validateFields(); if (await perform(() => serverPost("/team/adjustMemberCredits", { ...values, userId: target!.userId }))) setTarget(null); }}><Form form={creditForm} layout="vertical"><Form.Item name="changeAmount" label="积分变化（正数增加、负数扣减）" rules={[{ required: true }]}><InputNumber<string> stringMode precision={6} className="w-full!" /></Form.Item><Form.Item name="reason" label="调整原因" rules={[{ required: true }]}><Input maxLength={200} /></Form.Item></Form></Modal>
    </>;
}

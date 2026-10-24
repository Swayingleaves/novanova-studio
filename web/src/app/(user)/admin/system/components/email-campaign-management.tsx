"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Descriptions, Drawer, Form, Input, InputNumber, Modal, Radio, Select, Skeleton, Table, Tabs, Tag, type TableProps } from "antd";
import { Copy, MailPlus, RefreshCw, Send } from "lucide-react";
import { useCopyRichText } from "@/shared/hooks/use-copy-rich-text";
import { uploadImage } from "@/features/storage/services/image-storage";
import {
    cancelEmailCampaign, createEmailCampaign, getEmailCampaign, getEmailCampaignDetail, getEmailCampaignSettings,
    listEmailCampaigns, listEmailDeliveries, listEmailRecipientUsers, previewEmailCampaignContent,
    type CreateEmailCampaign, type EmailCampaign, type EmailDelivery, type EmailDeliveryStatus, type EmailRecipientUser,
} from "@/services/api/email-campaigns";

const EmailBodyEditor = dynamic(() => import("./email-body-editor").then(module => module.EmailBodyEditor), {
    ssr: false, loading: () => <Skeleton active paragraph={{ rows: 6 }} />,
});

const deliveryLabels: Record<EmailDeliveryStatus, string> = {
    queued: "待发送", sending: "发送中", sent: "已提交邮件服务器", failed: "发送失败", unknown: "结果不确定", cancelled: "已取消",
};
const campaignLabels: Record<EmailCampaign["status"], string> = { queued: "排队中", running: "发送中", completed: "处理完成", cancelled: "已取消" };
type ComposeValues = Omit<CreateEmailCampaign, "requestId" | "userIds">;

/** 格式化发送记录时间。 */
function formatTime(value: string | null) { return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—"; }

/** 排队、运行或仍有在途邮件时继续刷新状态。 */
function hasPendingMail(campaign: EmailCampaign) { return campaign.status === "queued" || campaign.status === "running" || campaign.sendingCount > 0; }

/** 在受限沙箱内预览邮件，禁止脚本、表单和外部资源中的主动内容。 */
function previewDocument(documentHtml: string) {
    return documentHtml.replace("<head>", "<head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'\">");
}

/** 渲染平台邮件群发、收件人选择与发送记录。 */
export function EmailCampaignManagement() {
    const { message, modal } = App.useApp();
    const copyRichText = useCopyRichText();
    const queryClient = useQueryClient();
    const [form] = Form.useForm<ComposeValues>();
    const [composeOpen, setComposeOpen] = useState(false);
    const [contentTab, setContentTab] = useState("edit");
    const [previewBodyHtml, setPreviewBodyHtml] = useState("");
    const [sending, setSending] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [page, setPage] = useState(1);
    const [recipientPage, setRecipientPage] = useState(1);
    const [keywordInput, setKeywordInput] = useState("");
    const [keyword, setKeyword] = useState("");
    const [selectedUsers, setSelectedUsers] = useState<EmailRecipientUser[]>([]);
    const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);
    const [deliveryPage, setDeliveryPage] = useState(1);
    const [deliveryStatus, setDeliveryStatus] = useState<EmailDeliveryStatus>();
    const requestIdentity = useRef<{ signature: string; requestId: string } | null>(null);
    const recipientMode = Form.useWatch("recipientMode", form);
    const bodyHtml = Form.useWatch("bodyHtml", form) || "";

    const previewQuery = useQuery({
        queryKey: ["email-campaign-preview", previewBodyHtml], queryFn: () => previewEmailCampaignContent(previewBodyHtml),
        enabled: composeOpen && contentTab === "preview", retry: false,
    });

    const settingsQuery = useQuery({ queryKey: ["email-campaign-settings"], queryFn: getEmailCampaignSettings });
    const settings = settingsQuery.data;
    const campaignsQuery = useQuery({
        queryKey: ["email-campaigns", page], queryFn: () => listEmailCampaigns(page),
        refetchInterval: query => query.state.data?.campaigns.some(hasPendingMail) ? 5000 : false,
    });
    const recipientsQuery = useQuery({
        queryKey: ["email-recipients", recipientPage, keyword], queryFn: () => listEmailRecipientUsers(recipientPage, keyword), enabled: composeOpen,
    });
    const allRecipientsQuery = useQuery({
        queryKey: ["email-recipient-total"], queryFn: () => listEmailRecipientUsers(1, ""), enabled: composeOpen,
    });
    const detailQuery = useQuery({
        queryKey: ["email-campaign-detail", selectedCampaignId], queryFn: () => getEmailCampaignDetail(selectedCampaignId!), enabled: selectedCampaignId !== null,
    });
    const summaryQuery = useQuery({
        queryKey: ["email-campaign-summary", selectedCampaignId], queryFn: () => getEmailCampaign(selectedCampaignId!), enabled: selectedCampaignId !== null,
        refetchInterval: query => query.state.data && hasPendingMail(query.state.data) ? 5000 : false,
    });
    const deliveriesQuery = useQuery({
        queryKey: ["email-deliveries", selectedCampaignId, deliveryPage, deliveryStatus],
        queryFn: () => listEmailDeliveries(selectedCampaignId!, deliveryPage, deliveryStatus), enabled: selectedCampaignId !== null,
        refetchInterval: selectedCampaignId !== null && (!summaryQuery.data || hasPendingMail(summaryQuery.data)) ? 5000 : false,
    });

    useEffect(() => {
        const timeout = setTimeout(() => { setKeyword(keywordInput.trim()); setRecipientPage(1); }, 300);
        return () => clearTimeout(timeout);
    }, [keywordInput]);

    useEffect(() => {
        const timeout = setTimeout(() => setPreviewBodyHtml(bodyHtml), 300);
        return () => clearTimeout(timeout);
    }, [bodyHtml]);

    useEffect(() => {
        if (summaryQuery.data && !hasPendingMail(summaryQuery.data)) void queryClient.invalidateQueries({ queryKey: ["email-deliveries", selectedCampaignId] });
    }, [queryClient, selectedCampaignId, summaryQuery.data]);

    /** 刷新列表与打开的详情，保留当前筛选条件。 */
    const refresh = () => {
        void queryClient.invalidateQueries({ queryKey: ["email-campaigns"] });
        void queryClient.invalidateQueries({ queryKey: ["email-campaign-detail"] });
        void queryClient.invalidateQueries({ queryKey: ["email-deliveries"] });
        void queryClient.invalidateQueries({ queryKey: ["email-campaign-summary"] });
    };

    /** 打开图文编辑表单，明确以指定用户为初始收件范围。 */
    const openCompose = () => {
        form.resetFields();
        form.setFieldsValue({ subject: "", bodyHtml: "", recipientMode: "selected", intervalSeconds: settings!.minimumIntervalSeconds });
        setSelectedUsers([]);
        setRecipientPage(1);
        setKeywordInput("");
        requestIdentity.current = null;
        setContentTab("edit");
        setComposeOpen(true);
    };

    /** 提交前确认实际收件范围；内容相同的重试复用请求标识，避免响应丢失后重复发送。 */
    const submit = async (values: ComposeValues) => {
        if (sending || uploading || !settings?.configured) return;
        const document = new DOMParser().parseFromString(values.bodyHtml || "", "text/html");
        if (!document.body.textContent?.trim() && !document.querySelector("img")) {
            form.setFields([{ name: "bodyHtml", errors: ["请输入邮件正文"] }]);
            return;
        }
        const userIds = values.recipientMode === "all" ? [] : selectedUsers.map(user => user.id).sort((left, right) => left - right);
        if (values.recipientMode === "selected" && !userIds.length) { message.warning("请至少选择一名收件用户"); return; }
        if (values.recipientMode === "all" && (!allRecipientsQuery.data || allRecipientsQuery.isError)) { message.error("请先成功加载收件人数"); return; }
        const count = values.recipientMode === "all" ? allRecipientsQuery.data!.total : userIds.length;
        if (!count) { message.warning("当前没有可发送邮件的用户"); return; }
        const images = Array.from(document.querySelectorAll("img"));
        if (images.length > 10) { message.error("单封邮件最多插入10张图片"); return; }
        // Markdown 图片链接在提交确认前导入现有媒体服务，发送时沿用归属校验和附件快照。
        const pendingImages = images.filter(image => !image.getAttribute("data-storage-key"));
        if (pendingImages.length) {
            setUploading(true);
            try {
                for (const image of pendingImages) {
                    const source = image.getAttribute("src") || "";
                    if (!/^https?:\/\//i.test(source)) throw new Error("Markdown 图片请使用完整的HTTP或HTTPS地址，或切换富文本上传");
                    const uploaded = await uploadImage(source);
                    image.setAttribute("src", uploaded.url);
                    image.setAttribute("data-storage-key", uploaded.storageKey);
                    // 每张成功导入的图片立即回填，重试时复用已上传内容。
                    form.setFieldValue("bodyHtml", document.body.innerHTML);
                }
            } catch (error) {
                message.error(error instanceof Error ? error.message : "正文图片导入失败，请检查图片链接后重试");
                return;
            } finally { setUploading(false); }
        }
        const payload = { ...values, bodyHtml: document.body.innerHTML, subject: values.subject.trim(), userIds };
        const signature = JSON.stringify(payload);
        if (requestIdentity.current?.signature !== signature) requestIdentity.current = { signature, requestId: crypto.randomUUID() };
        const request = { ...payload, requestId: requestIdentity.current.requestId };
        modal.confirm({
            title: `确认向${values.recipientMode === "all" ? "全部有邮箱的用户" : "所选用户"}发送邮件？`,
            content: <div className="space-y-2"><p>主题：{payload.subject}</p><p>当前收件人数：{count} 人。全部用户以提交时的实际名单为准。</p><p>提交后进入发送队列，每人单独一封；已发出的邮件无法撤回。</p></div>,
            okText: "确认发送", cancelText: "继续编辑", mask: { closable: false },
            onOk: async () => {
                setSending(true);
                try {
                    await createEmailCampaign(request);
                    message.success("邮件已加入发送队列");
                    setComposeOpen(false);
                    setPage(1);
                    refresh();
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "提交邮件失败");
                    throw error;
                } finally { setSending(false); }
            },
        });
    };

    /** 取消尚未开始发送的收件人，已开始的单封邮件继续记录实际结果。 */
    const cancel = (campaign: EmailCampaign) => modal.confirm({
        title: "取消剩余邮件？", content: "尚未开始发送的邮件将被取消，已开始发送的邮件会继续记录结果。", okText: "取消剩余发送", cancelText: "继续发送",
        onOk: async () => {
            try { await cancelEmailCampaign(campaign.id); message.success("已取消剩余发送"); refresh(); }
            catch (error) { message.error(error instanceof Error ? error.message : "取消发送失败"); throw error; }
        },
    });

    const columns: TableProps<EmailCampaign>["columns"] = [
        { title: "邮件主题", dataIndex: "subject", width: 260, ellipsis: true },
        { title: "收件范围", width: 140, render: (_, campaign) => `${campaign.recipientMode === "all" ? "全部有邮箱用户" : "指定用户"} · ${campaign.recipientCount}人` },
        { title: "状态", width: 110, render: (_, campaign) => <Tag color={campaign.status === "running" ? "processing" : "default"}>{campaignLabels[campaign.status]}</Tag> },
        { title: "发送进度", width: 230, render: (_, campaign) => <div className="space-y-1 text-xs"><p>已提交 {campaign.sentCount} · 失败 {campaign.failedCount} · 待发送 {campaign.queuedCount}</p><p className="text-[var(--studio-muted)]">发送中 {campaign.sendingCount} · 不确定 {campaign.unknownCount} · 已取消 {campaign.cancelledCount}</p></div> },
        { title: "提交时间", width: 175, render: (_, campaign) => formatTime(campaign.createdAt) },
        { title: "操作", width: 180, fixed: "right", render: (_, campaign) => <div className="flex gap-2"><Button size="small" type="link" onClick={() => { setSelectedCampaignId(campaign.id); setDeliveryPage(1); setDeliveryStatus(undefined); }}>查看记录</Button>{["queued", "running"].includes(campaign.status) && <Button size="small" type="link" danger onClick={() => cancel(campaign)}>取消剩余</Button>}</div> },
    ];
    const deliveryColumns: TableProps<EmailDelivery>["columns"] = [
        { title: "收件人", width: 220, render: (_, delivery) => <div className="break-all"><p>{delivery.nickname || `用户 ${delivery.userId}`}</p><p className="text-xs text-[var(--studio-muted)]">{delivery.email}</p></div> },
        { title: "发送状态", width: 155, render: (_, delivery) => <Tag color={delivery.status === "sent" ? "success" : delivery.status === "failed" ? "error" : delivery.status === "unknown" ? "warning" : "default"}>{deliveryLabels[delivery.status]}</Tag> },
        { title: "结果说明", dataIndex: "errorMessage", width: 280, render: value => value || "—" },
        { title: "处理时间", width: 175, render: (_, delivery) => formatTime(delivery.finishedAt || delivery.startedAt) },
    ];
    const detailCampaign = summaryQuery.data || detailQuery.data?.campaign;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-[var(--studio-muted)]">编辑图文邮件，向全体有邮箱用户或指定用户逐封发送。</p>
                <div className="flex gap-2"><Button icon={<RefreshCw size={16} aria-hidden="true" />} onClick={refresh} loading={campaignsQuery.isFetching}>刷新</Button><Button type="primary" icon={<MailPlus size={16} aria-hidden="true" />} disabled={!settings?.configured} onClick={openCompose}>新建邮件</Button></div>
            </div>
            {settingsQuery.isError && <Alert type="error" showIcon title="群发配置加载失败" action={<Button onClick={() => void settingsQuery.refetch()}>重试</Button>} />}
            {settings && <Alert showIcon type={settings.configured ? "info" : "warning"} title={settings.configured ? `发件人：${settings.fromEmail}` : "尚未配置邮件服务器与发件人地址"}
                description={`发送间隔至少${settings.minimumIntervalSeconds}秒，连续一分钟最多${settings.maximumPerMinute}封，连续一小时最多${settings.maximumPerHour}封。额度由所有群发任务共享，达到上限后继续排队。`} />}
            {campaignsQuery.isError && <Alert type="error" showIcon title="发送记录加载失败" action={<Button onClick={() => void campaignsQuery.refetch()}>重试</Button>} />}
            <Table<EmailCampaign> rowKey="id" columns={columns} dataSource={campaignsQuery.data?.campaigns || []} loading={campaignsQuery.isPending} scroll={{ x: 1100 }}
                locale={{ emptyText: "暂无邮件发送记录" }} pagination={{ current: page, pageSize: 20, total: campaignsQuery.data?.total || 0, showSizeChanger: false, onChange: setPage }} />
            <p className="text-xs text-[var(--studio-muted)]">“已提交邮件服务器”表示邮件服务已接收发送请求，实际投递与阅读情况以邮件服务商记录为准。发送失败或结果不确定的邮件不会自动重发。</p>

            <Modal title="新建群发邮件" open={composeOpen} width={960} onCancel={() => { if (!sending && !uploading) setComposeOpen(false); }}
                mask={{ closable: false }} keyboard={!sending && !uploading} closable={!sending && !uploading} footer={null} styles={{ body: { maxHeight: "75vh", overflowY: "auto", paddingRight: 8 } }}>
                <Form<ComposeValues> form={form} layout="vertical" onFinish={submit} disabled={sending} initialValues={{ recipientMode: "selected" }}>
                    <Form.Item name="subject" label="邮件主题" rules={[{ required: true, whitespace: true, message: "请输入邮件主题" }, { pattern: /^[^\r\n]+$/, message: "主题不能包含换行" }]}>
                        <Input placeholder="输入邮件主题" maxLength={200} showCount />
                    </Form.Item>
                    <Form.Item name="recipientMode" label="收件范围" rules={[{ required: true }]}>
                        <Radio.Group options={[{ value: "selected", label: `指定用户（已选${selectedUsers.length}人）` }, { value: "all", label: `全部有邮箱用户（${allRecipientsQuery.data?.total ?? "加载中"}人）` }]} />
                    </Form.Item>
                    {recipientMode === "selected" && <div className="mb-5 space-y-3">
                        <div className="flex flex-wrap items-center gap-3"><Input.Search className="max-w-sm" placeholder="搜索昵称、用户名或邮箱" value={keywordInput} onChange={event => setKeywordInput(event.target.value)} allowClear aria-label="搜索收件用户" /><span className="text-sm text-[var(--studio-muted)]">已选择 {selectedUsers.length} 人</span><Button type="link" disabled={!selectedUsers.length || sending} onClick={() => setSelectedUsers([])}>清空选择</Button></div>
                        {recipientsQuery.isError && <Alert type="error" title="收件用户加载失败" action={<Button onClick={() => void recipientsQuery.refetch()}>重试</Button>} />}
                        <Table<EmailRecipientUser> size="small" rowKey="id" dataSource={recipientsQuery.data?.users || []} loading={recipientsQuery.isFetching} scroll={{ y: 220 }}
                            tableLayout="fixed" columns={[{ title: "用户", dataIndex: "nickname", render: (nickname, user) => <span className="break-all">{nickname || `用户 ${user.id}`}</span> }, { title: "邮箱", dataIndex: "email", render: email => <span className="break-all">{email}</span> }]}
                            rowSelection={{ preserveSelectedRowKeys: true, selectedRowKeys: selectedUsers.map(user => user.id), onChange: (_, users) => setSelectedUsers(users), getCheckboxProps: () => ({ disabled: sending }) }}
                            pagination={{ current: recipientPage, pageSize: 20, total: recipientsQuery.data?.total || 0, showSizeChanger: false, onChange: setRecipientPage }} />
                    </div>}
                    {recipientMode === "all" && allRecipientsQuery.isError && <Alert type="error" title="收件人数加载失败" action={<Button onClick={() => void allRecipientsQuery.refetch()}>重试</Button>} />}
                    <Form.Item name="intervalSeconds" label="发送间隔" rules={[{ required: true, message: "请输入发送间隔" }]} extra="后台按此间隔逐封发送，同时遵守全局每分钟和每小时限额。">
                        <InputNumber min={settings?.minimumIntervalSeconds} max={3600} precision={0} suffix="秒 / 封" className="w-56!" />
                    </Form.Item>
                    <Tabs activeKey={contentTab} onChange={setContentTab} items={[
                        { key: "edit", label: "编辑正文", forceRender: true, children: <Form.Item name="bodyHtml" rules={[{ required: true, message: "请输入邮件正文" }]}><EmailBodyEditor onUploadingChange={setUploading} disabled={sending || uploading} /></Form.Item> },
                        { key: "preview", label: "预览邮件", children: previewBodyHtml !== bodyHtml || previewQuery.isPending || previewQuery.isFetching ? <Skeleton active paragraph={{ rows: 8 }} />
                            : previewQuery.isError ? <Alert type="error" title="邮件预览生成失败" description="请确认服务端已更新并启动，再重试预览。" action={<Button onClick={() => void previewQuery.refetch()}>重试</Button>} />
                            : <iframe title="邮件预览" sandbox="" className="h-[500px] w-full rounded-lg border border-[var(--studio-line)]" srcDoc={previewDocument(previewQuery.data.documentHtml)} /> },
                    ]} />
                    <div className="mt-4 flex justify-end gap-2"><Button disabled={sending || uploading} onClick={() => setComposeOpen(false)}>取消</Button><Button type="primary" htmlType="submit" icon={<Send size={16} aria-hidden="true" />} loading={sending} disabled={uploading || !settings?.configured}>发送邮件</Button></div>
                </Form>
            </Modal>

            <Drawer title="邮件发送记录" open={selectedCampaignId !== null} onClose={() => setSelectedCampaignId(null)} size={960}>
                {detailQuery.isPending ? <Skeleton active /> : detailQuery.isError ? <Alert type="error" title="邮件详情加载失败" action={<Button onClick={() => void detailQuery.refetch()}>重试</Button>} /> : detailCampaign && <div className="space-y-5">
                    {summaryQuery.isError && <Alert type="error" title="当前发送状态加载失败" action={<Button onClick={() => void summaryQuery.refetch()}>重试</Button>} />}
                    <Descriptions column={{ xs: 1, sm: 2 }} items={[
                        { key: "subject", label: "主题", children: detailCampaign.subject, span: 2 },
                        { key: "sender", label: "发件人", children: detailQuery.data?.fromEmail },
                        { key: "status", label: "任务状态", children: campaignLabels[detailCampaign.status] },
                        { key: "recipients", label: "收件人数", children: detailCampaign.recipientCount },
                        { key: "interval", label: "发送间隔", children: `${detailCampaign.intervalSeconds}秒 / 封` },
                        { key: "creator", label: "创建人", children: detailCampaign.createdByName },
                        { key: "created", label: "提交时间", children: formatTime(detailCampaign.createdAt) },
                    ]} />
                    <Tabs items={[
                        { key: "records", label: "收件人状态", children: <div className="space-y-4">
                            <div className="flex flex-wrap items-center justify-between gap-3"><Select allowClear placeholder="全部发送状态" aria-label="筛选发送状态" className="w-48" value={deliveryStatus} options={Object.entries(deliveryLabels).map(([value, label]) => ({ value, label }))} onChange={value => { setDeliveryStatus(value); setDeliveryPage(1); }} /><Button icon={<RefreshCw size={16} aria-hidden="true" />} onClick={refresh}>刷新</Button></div>
                            {deliveriesQuery.isError && <Alert type="error" title="收件人记录加载失败" action={<Button onClick={() => void deliveriesQuery.refetch()}>重试</Button>} />}
                            <Table<EmailDelivery> rowKey="id" size="small" tableLayout="fixed" columns={deliveryColumns} dataSource={deliveriesQuery.data?.deliveries || []} loading={deliveriesQuery.isPending} scroll={{ x: 820 }} pagination={{ current: deliveryPage, pageSize: 20, total: deliveriesQuery.data?.total || 0, showSizeChanger: false, onChange: setDeliveryPage }} />
                        </div> },
                        { key: "content", label: "邮件内容", children: <div className="space-y-3">
                            <div className="flex justify-end"><Button icon={<Copy size={16} aria-hidden="true" />} disabled={!detailQuery.data?.bodyHtml}
                                onClick={() => detailQuery.data && void copyRichText(detailQuery.data.bodyHtml)}>复制邮件内容</Button></div>
                            <iframe title="已发送邮件内容" sandbox="" className="h-[500px] w-full rounded-lg border border-[var(--studio-line)]" srcDoc={previewDocument(detailQuery.data.documentHtml)} />
                        </div> },
                    ]} />
                </div>}
            </Drawer>
        </div>
    );
}

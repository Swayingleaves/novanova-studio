import { serverGet, serverPost } from "./server";

export type EmailCampaignSettings = {
    configured: boolean;
    fromEmail: string;
    minimumIntervalSeconds: number;
    maximumPerMinute: number;
    maximumPerHour: number;
    maximumActiveCampaigns: number;
};

export type EmailRecipientUser = { id: number; nickname: string; email: string };
export type EmailDeliveryStatus = "queued" | "sending" | "sent" | "failed" | "unknown" | "cancelled";
export type EmailCampaign = {
    id: number;
    subject: string;
    recipientMode: "all" | "selected";
    intervalSeconds: number;
    status: "queued" | "running" | "completed" | "cancelled";
    recipientCount: number;
    queuedCount: number;
    sendingCount: number;
    sentCount: number;
    failedCount: number;
    unknownCount: number;
    cancelledCount: number;
    createdByName: string;
    createdAt: string;
    finishedAt: string | null;
};
export type EmailDelivery = {
    id: number;
    userId: number;
    nickname: string;
    email: string;
    status: EmailDeliveryStatus;
    errorMessage: string | null;
    startedAt: string | null;
    finishedAt: string | null;
};
export type CreateEmailCampaign = {
    requestId: string;
    subject: string;
    bodyHtml: string;
    recipientMode: "all" | "selected";
    userIds: number[];
    intervalSeconds: number;
};

/** 读取群发限制与邮件配置状态。 */
export const getEmailCampaignSettings = () => serverGet<EmailCampaignSettings>("/admin/email/getSettings");

/** 使用服务端的安全清理及最终发送排版预览邮件。 */
export const previewEmailCampaignContent = (bodyHtml: string) => serverPost<{ documentHtml: string }>("/admin/email/previewContent", { bodyHtml });

/** 搜索有邮箱的收件用户。 */
export function listEmailRecipientUsers(page: number, keyword: string) {
    const query = new URLSearchParams({ page: String(page), pageSize: "20", keyword });
    return serverGet<{ users: EmailRecipientUser[]; total: number }>(`/admin/email/listRecipientUsers?${query}`);
}

/** 创建持久化群发任务，重复的请求标识不会创建第二个任务。 */
export const createEmailCampaign = (request: CreateEmailCampaign) => serverPost<EmailCampaign>("/admin/email/createCampaign", request);

/** 分页读取群发汇总记录。 */
export const listEmailCampaigns = (page: number) => serverGet<{ campaigns: EmailCampaign[]; total: number }>(`/admin/email/listCampaigns?page=${page}&pageSize=20`);

/** 读取正文与图片预览快照。 */
export const getEmailCampaignDetail = (campaignId: number) => serverGet<{ campaign: EmailCampaign; bodyHtml: string; fromEmail: string; documentHtml: string }>(`/admin/email/getCampaignDetail?campaignId=${campaignId}`);

/** 轮询轻量任务汇总，不重复加载邮件图片。 */
export const getEmailCampaign = (campaignId: number) => serverGet<EmailCampaign>(`/admin/email/getCampaign?campaignId=${campaignId}`);

/** 分页读取逐收件人发送状态。 */
export function listEmailDeliveries(campaignId: number, page: number, status?: EmailDeliveryStatus) {
    const query = new URLSearchParams({ campaignId: String(campaignId), page: String(page), pageSize: "20" });
    if (status) query.set("status", status);
    return serverGet<{ deliveries: EmailDelivery[]; total: number }>(`/admin/email/listDeliveries?${query}`);
}

/** 取消还未派发的邮件。 */
export const cancelEmailCampaign = (campaignId: number) => serverPost("/admin/email/cancelCampaign", { campaignId });

"use client";

import type { ObjectStorageConfig, ObjectStorageFile } from "@/shared/types/object-storage";
import { getAuthToken, useUserStore, type ServerUserProfile } from "@/features/auth/stores/use-user-store";
import type { ApiCallFormat, ModelCreditUnit } from "@/features/settings/stores/use-config-store";

type ApiResponse<T> = {
    code: number;
    data: T;
    msg: string;
};

export type ServerMediaInput = {
    kind: string;
    storageKey?: string;
    sourceUrl?: string;
    mimeType?: string;
    bytes?: number;
    width?: number;
    height?: number;
    durationMs?: number;
    metadata?: unknown;
};

export type ServerMediaInfo = {
    storageKey: string;
    url: string;
    bytes: number;
    mimeType: string;
    width?: number;
    height?: number;
    durationMs?: number;
    objectStorage?: ObjectStorageFile;
};

export type ServerAiTaskType = "image" | "video" | "text";
export type ServerAiTaskStatus = "pending" | "running" | "success" | "failed" | "canceled";
export type ServerGenerationSource = "imagePage" | "videoPage" | "canvas" | "storyboard";

export type ServerRuntimeConfig = {
    aiTaskPollingIntervalSeconds: number;
};

export type ServerAiTaskMediaReference = {
    id?: string;
    name?: string;
    mimeType?: string;
    storageKey?: string;
    url?: string;
};

export type ServerAiTask = {
    id: string;
    taskType: ServerAiTaskType;
    model: string;
    provider: string;
    status: ServerAiTaskStatus;
    progress: number;
    requestData: unknown;
    resultData?: unknown;
    errorMessage?: string;
    startedAt?: string;
    completedAt?: string;
    createdAt: string;
    updatedAt: string;
};

export type AiTaskErrorDetails = {
    source: string;
    category: string;
    stage: string;
    httpStatus?: number;
    code?: string;
    type?: string;
    parameter?: string;
    message: string;
    requestAccepted: boolean | null;
    safeToRetry: boolean;
};

export class AiTaskFailureError extends Error {
    readonly details: AiTaskErrorDetails;

    constructor(message: string, details: AiTaskErrorDetails) {
        super(message);
        this.name = "AiTaskFailureError";
        this.details = details;
    }
}

export type ServerAiTaskCreateInput = {
    taskType: ServerAiTaskType;
    prompt: string;
    model?: string;
    parameters?: Record<string, unknown>;
    references?: ServerAiTaskMediaReference[];
    videoReferences?: ServerAiTaskMediaReference[];
    generationSource?: ServerGenerationSource;
    generationStyleIds?: number[];
    generationStyleSnapshots?: GenerationStyleSnapshot[];
};

export type PromptOptimizationType = "image" | "video";

export type GenerationStyleType = "image" | "video";

export type GenerationStyleSnapshot = {
    id: number;
    name: string;
    generationType: GenerationStyleType;
    stylePrompt: string;
};

export type GenerationStyleOption = {
    id: number;
    name: string;
    generationType: GenerationStyleType;
    coverUrl: string;
    category: string;
};

export type ServerGenerationStyle = GenerationStyleSnapshot & {
    coverUrl: string;
    category: string;
    status: number;
    sortOrder: number;
    createdAt: string;
    updatedAt: string;
};

export type GenerationStyleListResponse = {
    styles: ServerGenerationStyle[];
    total: number;
};

export type GenerationStyleOptionListResponse = {
    styles: GenerationStyleOption[];
};

export type ServerAiModelList = {
    models: Array<{ value: string; label: string; capability: string; provider: string; apiFormat: ApiCallFormat; defaultModel: boolean; creditCost: number; creditUnit: ModelCreditUnit }>;
    imageModels: string[];
    videoModels: string[];
    textModels: string[];
};

export type AuthResponse = {
    token: string;
    tokenType: string;
    expiresAt: string;
    user: ServerUserProfile;
};

export type OAuth2ProviderInfo = {
    providerId: string;
    displayName: string;
    authorizationPath: string;
};

export type OAuth2ProviderListResponse = {
    providers: OAuth2ProviderInfo[];
};

export type UserListResponse = {
    users: ServerUserProfile[];
    total: number;
};

export type UserStatisticsResponse = {
    totalUsers: number;
    monthlyNewUsers: number;
    dailyNewUsers: number;
};

/** 后端渠道配置，对齐 AiChannelConfig record */
export type ServerChannel = {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    models: string[];
};

/** 渠道列表响应 */
export type ServerChannelList = {
    channels: ServerChannel[];
};

export type ServerChannelModelList = {
    models: string[];
};

export type ServerModelConfig = {
    id: string;
    channelId: string;
    modelName: string;
    modelType: "image" | "video" | "text";
    capabilities: string[];
    defaultModel: boolean;
    sortOrder: number;
    creditCost: number;
    creditUnit: ModelCreditUnit;
    thinkingEnabled: boolean;
    reasoningEffort: "high" | "max";
    requestConcurrency: number;
};

export type CreditSettings = {
    initialCredits: number;
};

export type CreditBalance = {
    userId: number;
    creditBalance: number;
};

export type ServerCreditDistributionItem = {
    name: string;
    consumedCredits: number;
};

export type ServerCreditTrendItem = {
    period: string;
    consumedCredits: number;
};

export type ServerCreditOverview = {
    generationTypeDistribution: ServerCreditDistributionItem[];
    modelDistribution: ServerCreditDistributionItem[];
    trend: ServerCreditTrendItem[];
};

export type ServerCreditTransaction = {
    id: number;
    generationType: Exclude<ServerAiTaskType, "text">;
    model: string;
    generationSource: ServerGenerationSource | null;
    consumedCredits: number;
    createdAt: string;
};

export type ServerCreditTransactionList = {
    transactions: ServerCreditTransaction[];
    total: number;
};

export type ServerAdminCreditTransaction = ServerCreditTransaction & {
    userId: number;
    username: string;
    nickname: string | null;
    email: string;
};

export type ServerAdminCreditTransactionList = {
    transactions: ServerAdminCreditTransaction[];
    total: number;
};

export type ServerRedeemCreditsResponse = {
    cardId: number;
    cardMasked: string;
    credits: number;
    creditBalance: number;
    redeemedAt: string;
};

export type ServerRedemptionRecord = {
    id: number;
    transactionId: number;
    cardCode: string;
    cardMasked: string;
    cardSuffix: string;
    credits: number;
    balanceAfter: number;
    redeemedAt: string;
};

export type ServerRedemptionRecordList = {
    records: ServerRedemptionRecord[];
    total: number;
};

export type ServerCreditCardBatch = {
    id: number;
    quantity: number;
    creditsPerCard: number;
    redeemedCount: number;
    availableCount: number;
    createdByUserId: number;
    createdByName: string;
    createdByEmail: string;
    createdAt: string;
};

export type ServerCreditCardBatchList = {
    batches: ServerCreditCardBatch[];
    total: number;
};

export type ServerCreditCard = {
    id: number;
    batchId: number;
    code: string | null;
    codeMasked: string;
    codeSuffix: string;
    credits: number;
    status: "available" | "redeemed";
    redeemedByUserId: number | null;
    redeemedByUsername: string | null;
    redeemedByNickname: string | null;
    redeemedByEmail: string | null;
    redeemedAt: string;
    createdAt: string;
    transactionId: number | null;
    balanceAfter: number | null;
};

export type ServerCreditCardList = {
    cards: ServerCreditCard[];
    total: number;
};

/** 对象存储列表响应，复用 ObjectStorageConfig 类型 */
export type ServerObjectStorageList = {
    objectStorages: ObjectStorageConfig[];
};

const serverApiPrefix = "/api/v1";
const defaultServerUrl = "http://127.0.0.1:8080";

export function sendEmailCode(email: string) {
    return serverPost("/auth/sendEmailCode", { email }, { auth: false });
}

export function registerByEmail(input: { email: string; code: string; password: string; nickname?: string }) {
    return serverPost<AuthResponse>("/auth/register", input, { auth: false });
}

export function loginByEmail(input: { email: string; password: string }) {
    return serverPost<AuthResponse>("/auth/login", input, { auth: false });
}

export function listOAuth2Providers() {
    return serverGet<OAuth2ProviderListResponse>("/auth/oauth/listProviders", { auth: false });
}

export function exchangeOAuth2LoginCode(loginCode: string) {
    return serverPost<AuthResponse>("/auth/oauth/exchangeLoginCode", { loginCode }, { auth: false });
}

export function logoutCurrentUser() {
    return serverPost("/auth/logout", {});
}

export function acknowledgeWelcome() {
    return serverPost("/auth/acknowledgeWelcome", {});
}

export function getCurrentUserInfo() {
    return serverGet<ServerUserProfile>("/auth/userInfo");
}

export function updateCurrentUserProfile(input: Pick<ServerUserProfile, "username" | "nickname" | "avatar">) {
    return serverPost<ServerUserProfile>("/auth/updateUserProfile", input);
}

export function changeCurrentUserPassword(input: { currentPassword: string; newPassword: string }) {
    return serverPost("/auth/changePassword", input);
}

export function listServerUsers(params: { page: number; pageSize: number; keyword?: string; userId?: string; role?: string; status?: number; createdAfter?: string; createdBefore?: string }) {
    const query = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
    if (params.keyword) query.set("keyword", params.keyword);
    if (params.userId) query.set("userId", params.userId);
    if (params.role) query.set("role", params.role);
    if (params.status !== undefined) query.set("status", String(params.status));
    if (params.createdAfter) query.set("createdAfter", params.createdAfter);
    if (params.createdBefore) query.set("createdBefore", params.createdBefore);
    return serverGet<UserListResponse>(`/admin/user/listUsers?${query}`);
}

export function getServerUserStatistics() {
    return serverGet<UserStatisticsResponse>("/admin/user/getUserStatistics");
}

export function updateServerUserStatus(userId: number, status: number) {
    return serverPost("/admin/user/updateUserStatus", { userId, status });
}

export function updateServerUserRole(userId: number, role: "user" | "admin") {
    return serverPost("/admin/user/updateUserRole", { userId, role });
}

export function adminCreateUser(input: { email: string; password: string; nickname?: string; role?: string }) {
    return serverPost("/admin/user/createUser", input);
}

export function adjustServerUserCredits(input: { userId: number; changeAmount: number; reason: string }) {
    return serverPost<CreditBalance>("/admin/user/adjustUserCredits", input);
}

export function unlockServerUserPassword(userId: number) {
    return serverPost("/admin/user/unlockUserPassword", { userId });
}

// ---- 系统公告 ----

export type SystemNotification = {
    id: number;
    title: string;
    content: string;
    priority: "normal" | "high";
    status: number;
    publishedAt?: string;
    read: boolean;
    createdAt: string;
};

// ---- 首页精选内容 ----

export type HomepageShowcase = {
    id: number;
    title: string;
    description: string;
    category: string;
    creatorName: string;
    mediaType: "image" | "video";
    mediaUrl: string;
    thumbnailUrl: string;
    targetType: "image" | "video" | "canvas" | "asset";
    targetPath: string;
    promptContent: string;
    sortOrder: number;
    status: number;
    createdAt?: string;
    updatedAt?: string;
};

export type HomepageShowcaseInput = {
    title: string;
    description?: string;
    category: string;
    creatorName: string;
    mediaType: HomepageShowcase["mediaType"];
    mediaUrl: string;
    thumbnailUrl?: string;
    targetType: HomepageShowcase["targetType"];
    targetPath?: string;
    promptContent?: string;
    sortOrder?: number;
    status?: number;
};

export function listHomepageShowcases(limit = 24) {
    return serverGet<{ items: HomepageShowcase[]; total: number }>(`/homepage/listShowcases?limit=${limit}`, { auth: false });
}

export function listAdminHomepageShowcases() {
    return serverGet<{ items: HomepageShowcase[]; total: number }>("/admin/homepage/listShowcases");
}

export function createAdminHomepageShowcase(input: HomepageShowcaseInput) {
    return serverPost("/admin/homepage/createShowcase", input);
}

export function updateAdminHomepageShowcase(input: HomepageShowcaseInput & { id: number }) {
    return serverPost("/admin/homepage/updateShowcase", input);
}

export function updateAdminHomepageShowcaseStatus(id: number, status: number) {
    return serverPost("/admin/homepage/updateShowcaseStatus", { id, status });
}

export function deleteAdminHomepageShowcases(ids: number[]) {
    return serverPost("/admin/homepage/deleteShowcases", { ids });
}

// ---- 提示词库 ----

export type ServerPrompt = {
    id: number;
    title: string;
    coverUrl: string;
    prompt: string;
    tags: string[];
    category: string;
    githubUrl: string;
    preview: string;
    status?: number;
    sortOrder?: number;
    createdAt: string;
    updatedAt: string;
};

export type ServerPromptListResponse = {
    items: ServerPrompt[];
    tags: string[];
    categories: string[];
    total: number;
};

export type ServerPromptListParams = {
    keyword?: string;
    tag?: string[];
    category?: string;
    status?: number;
    page?: number;
    pageSize?: number;
};

export type ServerPromptInput = {
    id?: number;
    title: string;
    prompt: string;
    category: string;
    tags?: string[];
    coverUrl?: string;
    preview?: string;
    sourceUrl?: string;
    status?: number;
    sortOrder?: number;
};

export function listServerPrompts(params: ServerPromptListParams = {}) {
    return serverGet<ServerPromptListResponse>(`/prompt/listPrompts${promptQuery(params)}`, { auth: false });
}

export function listAdminPrompts(params: ServerPromptListParams = {}) {
    return serverGet<ServerPromptListResponse>(`/admin/prompt/listPrompts${promptQuery(params)}`);
}

export function createAdminPrompt(input: ServerPromptInput) {
    return serverPost("/admin/prompt/createPrompt", input);
}

export function updateAdminPrompt(input: ServerPromptInput & { id: number }) {
    return serverPost("/admin/prompt/updatePrompt", input);
}

export function updateAdminPromptStatus(id: number, status: number) {
    return serverPost("/admin/prompt/updatePromptStatus", { id, status });
}

export function deleteAdminPrompts(ids: number[]) {
    return serverPost("/admin/prompt/deletePrompts", { ids });
}

// ---- 图片和视频生成风格 ----

export function listGenerationStyles(generationType: GenerationStyleType) {
    return serverGet<GenerationStyleOptionListResponse>(`/style/listStyles?generationType=${encodeURIComponent(generationType)}`);
}

export type ServerGenerationStyleListParams = {
    keyword?: string;
    generationType?: "all" | GenerationStyleType;
    status?: number;
    page?: number;
    pageSize?: number;
};

function generationStyleQuery(params: ServerGenerationStyleListParams = {}) {
    const query = new URLSearchParams({ page: String(params.page || 1), pageSize: String(params.pageSize || 20) });
    if (params.keyword) query.set("keyword", params.keyword);
    if (params.generationType) query.set("generationType", params.generationType);
    if (params.status !== undefined) query.set("status", String(params.status));
    return `?${query.toString()}`;
}

export function listAdminGenerationStyles(params: ServerGenerationStyleListParams = {}) {
    return serverGet<GenerationStyleListResponse>(`/admin/style/listStyles${generationStyleQuery(params)}`);
}

export type ServerGenerationStyleInput = {
    id?: number;
    generationType: GenerationStyleType;
    name: string;
    stylePrompt: string;
    coverUrl: string;
    category: string;
    status?: number;
    sortOrder?: number;
};

export function createAdminGenerationStyle(input: Omit<ServerGenerationStyleInput, "id">) {
    return serverPost("/admin/style/createStyle", input);
}

export function updateAdminGenerationStyle(input: ServerGenerationStyleInput & { id: number }) {
    return serverPost("/admin/style/updateStyle", input);
}

export function updateAdminGenerationStyleStatus(id: number, status: number) {
    return serverPost("/admin/style/updateStyleStatus", { id, status });
}

export function deleteAdminGenerationStyles(ids: number[]) {
    return serverPost("/admin/style/deleteStyles", { ids });
}

export function listAdminNotifications() {
    return serverGet<{ notifications: SystemNotification[] }>("/admin/notification/list");
}

export function createAdminNotification(input: { title: string; content?: string; priority?: string }) {
    return serverPost("/admin/notification/create", input);
}

export function publishAdminNotification(id: number) {
    return serverPost(`/admin/notification/publish?id=${id}`, {});
}

export function updateAdminNotification(input: { id: number; title: string; content?: string }) {
    return serverPost("/admin/notification/update", input);
}

export function listMyNotifications() {
    return serverGet<{ notifications: SystemNotification[] }>("/notification/list");
}

export function markNotificationRead(notificationId: number) {
    return serverPost("/notification/read", { notificationId });
}

export function markAllNotificationsRead() {
    return serverPost("/notification/markAllRead", {});
}

export async function listCanvasProjects<T>() {
    const data = await serverGet<{ projects: T[] }>("/canvas/listProjects");
    return data.projects || [];
}

export async function getCanvasProject<T>(id: string) {
    const data = await serverPost<{ project: T }>("/canvas/getProject", { id });
    return data.project;
}

export function saveCanvasProject(project: unknown) {
    return serverPost("/canvas/saveProject", { project });
}

export function deleteCanvasProjects(ids: string[]) {
    return serverPost("/canvas/deleteProjects", { ids });
}

export async function listAssets<T>() {
    const data = await serverGet<{ assets: T[] }>("/assets/listAssets");
    return data.assets || [];
}

export function saveAsset(asset: unknown) {
    return serverPost("/assets/saveAsset", { asset });
}

export function deleteAsset(ids: string[]) {
    return serverPost("/assets/deleteAsset", { ids });
}

export async function listGenerationLogs<T>(logType: "image" | "video") {
    const data = await serverGet<{ logs: T[] }>(`/generationLogs/listGenerationLogs?logType=${encodeURIComponent(logType)}`);
    return data.logs || [];
}

export function saveGenerationLog(logType: "image" | "video", log: unknown) {
    return serverPost("/generationLogs/saveGenerationLog", { logType, log });
}

export function renameGenerationLogTitle(id: string, title: string) {
    return serverPost("/generationLogs/renameGenerationLogTitle", { id, title });
}

export function deleteGenerationLogs(ids: string[]) {
    return serverPost("/generationLogs/deleteGenerationLogs", { ids });
}

export function markGenerationLogViewed(id: string) {
    return serverPost("/generationLogs/markGenerationLogViewed", { id });
}

export function registerRemoteMedia(input: ServerMediaInput) {
    return serverPost<ServerMediaInfo>("/media/registerRemoteMedia", input);
}

export function getServerMediaInfo(storageKey: string) {
    return serverPost<ServerMediaInfo>("/media/getMediaInfo", { storageKey });
}

export async function downloadServerMedia(storageKey: string) {
    const response = await requestServer("/media/downloadMedia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storageKey }),
    });
    if (response.status === 404) {
        return null;
    }
    if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as ApiResponse<never> | null;
        throw new Error(payload?.msg || `下载请求失败：${response.status}`);
    }
    return response.blob();
}

export function uploadRemoteMediaToObjectStorage(storageKey: string) {
    return serverPost<ServerMediaInfo>("/media/uploadRemoteMediaToObjectStorage", { storageKey });
}

export function deleteServerMedia(storageKeys: string[]) {
    return serverPost("/media/deleteMedia", { storageKeys });
}

export function uploadServerMedia(file: Blob, input: ServerMediaInput, fileName = "file") {
    const formData = new FormData();
    formData.set("file", file, fileName);
    formData.set("kind", input.kind);
    appendFormValue(formData, "storageKey", input.storageKey);
    appendFormValue(formData, "mimeType", input.mimeType);
    appendFormValue(formData, "width", input.width);
    appendFormValue(formData, "height", input.height);
    appendFormValue(formData, "durationMs", input.durationMs);
    if (input.metadata !== undefined) formData.set("metadata", JSON.stringify(input.metadata));
    return serverFetch<ServerMediaInfo>("/media/uploadMedia", { method: "POST", body: formData });
}

export function createAiTask(input: ServerAiTaskCreateInput) {
    return serverPost<ServerAiTask>("/ai/task/createTask", input);
}

export function createPromptOptimizationTask(input: { generationType: PromptOptimizationType; prompt: string; generationStyleIds?: number[] }) {
    return serverPost<ServerAiTask>("/ai/prompt/optimizePrompt", input);
}

export async function listAiTasks(statuses?: ServerAiTaskStatus[]) {
    const query = statuses?.length ? `?status=${encodeURIComponent(statuses.join(","))}` : "";
    const data = await serverGet<{ tasks: ServerAiTask[] }>(`/ai/task/listTasks${query}`);
    return data.tasks || [];
}

export function getAiTaskInfo(taskId: string) {
    return serverGet<ServerAiTask>(`/ai/task/getTaskInfo?taskId=${encodeURIComponent(taskId)}`);
}

let runtimeConfigPromise: Promise<ServerRuntimeConfig> | null = null;

/**
 * 读取服务端统一运行时配置。
 *
 * @return Promise<ServerRuntimeConfig> 服务端运行时配置
 */
export function getRuntimeConfig(): Promise<ServerRuntimeConfig> {
    if (!runtimeConfigPromise) {
        runtimeConfigPromise = serverGet<ServerRuntimeConfig>("/config/getRuntimeConfig", { auth: false }).catch((error) => {
            runtimeConfigPromise = null;
            throw error;
        });
    }
    return runtimeConfigPromise;
}

/**
 * 获取统一的AI异步任务状态轮询间隔毫秒数。
 *
 * @return Promise<number> 轮询间隔毫秒数
 */
export async function getAiTaskPollingIntervalMilliseconds(): Promise<number> {
    const seconds = (await getRuntimeConfig()).aiTaskPollingIntervalSeconds;
    if (!Number.isInteger(seconds) || seconds <= 0) {
        throw new Error("服务端返回的AI任务轮询间隔无效");
    }
    return seconds * 1000;
}

export function cancelAiTask(taskId: string) {
    return serverPost<ServerAiTask>("/ai/task/cancelTask", { taskId });
}

export function listServerAiModels() {
    return serverGet<ServerAiModelList>("/ai/model/listModels");
}

export function listChannels() {
    return serverGet<ServerChannelList>("/config/channel/listChannels");
}

export function listObjectStorages() {
    return serverGet<ServerObjectStorageList>("/config/objectStorage/listObjectStorages");
}

export function createChannel(channel: ServerChannel) {
    return serverPost<ServerChannel>("/config/channel/createChannel", channel);
}

export function updateChannel(channel: ServerChannel) {
    return serverPost<ServerChannel>("/config/channel/updateChannel", channel);
}

export function refreshChannelModels(channel: Pick<ServerChannel, "baseUrl" | "apiKey" | "apiFormat">) {
    return serverPost<ServerChannelModelList>("/config/channel/refreshChannelModels", {
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        apiFormat: channel.apiFormat,
    });
}

export function deleteChannel(channelId: string) {
    return serverPost("/config/channel/deleteChannel", { channelId });
}

export function listModelConfigs() {
    return serverGet<{ modelConfigs: ServerModelConfig[] }>("/config/model/listModelConfigs");
}

export function createModelConfig(config: Omit<ServerModelConfig, "id" | "defaultModel">) {
    return serverPost<ServerModelConfig>("/config/model/createModelConfig", config);
}

export function updateModelConfig(config: Pick<ServerModelConfig, "id" | "modelType" | "capabilities" | "sortOrder" | "creditCost" | "creditUnit" | "thinkingEnabled" | "reasoningEffort" | "requestConcurrency">) {
    return serverPost<ServerModelConfig>("/config/model/updateModelConfig", config);
}

export function getCreditSettings() {
    return serverGet<CreditSettings>("/config/credit/getCreditSettings");
}

export function updateCreditSettings(initialCredits: number) {
    return serverPost<CreditSettings>("/config/credit/updateCreditSettings", { initialCredits });
}

export function getCreditOverview(params: { startDate: string; endDate: string; generationType?: "image" | "video"; trendUnit: "day" | "month" }) {
    const query = new URLSearchParams({ startDate: params.startDate, endDate: params.endDate, trendUnit: params.trendUnit });
    if (params.generationType) query.set("generationType", params.generationType);
    return serverGet<ServerCreditOverview>(`/credit/getCreditOverview?${query}`);
}

export function listCreditTransactions(params: { startDate: string; endDate: string; generationType?: "image" | "video"; page: number; pageSize: number }) {
    const query = new URLSearchParams({
        startDate: params.startDate,
        endDate: params.endDate,
        page: String(params.page),
        pageSize: String(params.pageSize),
    });
    if (params.generationType) query.set("generationType", params.generationType);
    return serverGet<ServerCreditTransactionList>(`/credit/listCreditTransactions?${query}`);
}

export function redeemCredits(cardCode: string) {
    return serverPost<ServerRedeemCreditsResponse>("/credit/redeemCredits", { cardCode });
}

export function listRedemptionRecords(params: { startDate?: string; endDate?: string; cardCode?: string; page: number; pageSize: number }) {
    const query = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
    if (params.startDate) query.set("startDate", params.startDate);
    if (params.endDate) query.set("endDate", params.endDate);
    if (params.cardCode?.trim()) query.set("cardCode", params.cardCode.trim());
    return serverGet<ServerRedemptionRecordList>(`/credit/listRedemptionRecords?${query}`);
}

export function getAdminCreditOverview(params: { userId?: number; startDate: string; endDate: string; generationType?: "image" | "video"; trendUnit: "day" | "month" }) {
    const query = new URLSearchParams({ startDate: params.startDate, endDate: params.endDate, trendUnit: params.trendUnit });
    if (params.userId !== undefined) query.set("userId", String(params.userId));
    if (params.generationType) query.set("generationType", params.generationType);
    return serverGet<ServerCreditOverview>(`/admin/credit/getCreditOverview?${query}`);
}

export function listAdminCreditTransactions(params: { userId?: number; startDate: string; endDate: string; generationType?: "image" | "video"; page: number; pageSize: number }) {
    const query = new URLSearchParams({
        startDate: params.startDate,
        endDate: params.endDate,
        page: String(params.page),
        pageSize: String(params.pageSize),
    });
    if (params.userId !== undefined) query.set("userId", String(params.userId));
    if (params.generationType) query.set("generationType", params.generationType);
    return serverGet<ServerAdminCreditTransactionList>(`/admin/credit/listCreditTransactions?${query}`);
}

export function generateCreditCards(input: { quantity?: number; creditsPerCard: number }) {
    return serverPost<{ batchId: number; quantity: number; creditsPerCard: number; cardCodes: string[]; createdAt: string }>("/admin/credit/generateCreditCards", input);
}

export function listCreditCardBatches(params: { page: number; pageSize: number }) {
    const query = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
    return serverGet<ServerCreditCardBatchList>(`/admin/credit/listCreditCardBatches?${query}`);
}

export function listCreditCards(params: { batchId?: number; status?: "available" | "redeemed"; cardCode?: string; redeemedUserKeyword?: string; includeCode?: boolean; page: number; pageSize: number }) {
    const query = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize), includeCode: String(params.includeCode === true) });
    if (params.batchId !== undefined) query.set("batchId", String(params.batchId));
    if (params.status) query.set("status", params.status);
    if (params.cardCode?.trim()) query.set("cardCode", params.cardCode.trim());
    if (params.redeemedUserKeyword?.trim()) query.set("redeemedUserKeyword", params.redeemedUserKeyword.trim());
    return serverGet<ServerCreditCardList>(`/admin/credit/listCreditCards?${query}`);
}

export function deleteModelConfig(id: string) {
    return serverPost("/config/model/deleteModelConfig", { id });
}

export function setDefaultModel(id: string, modelType: ServerModelConfig["modelType"]) {
    return serverPost("/config/model/setDefaultModel", { id, modelType });
}

export function createObjectStorage(objectStorage: ObjectStorageConfig) {
    return serverPost<ObjectStorageConfig>("/config/objectStorage/createObjectStorage", objectStorage);
}

export function updateObjectStorage(objectStorage: ObjectStorageConfig) {
    return serverPost<ObjectStorageConfig>("/config/objectStorage/updateObjectStorage", objectStorage);
}

export function testObjectStorage(objectStorage: ObjectStorageConfig) {
    return serverPost<ObjectStorageFile>("/config/objectStorage/testObjectStorage", objectStorage);
}

export function deleteObjectStorage(storageId: string) {
    return serverPost("/config/objectStorage/deleteObjectStorage", { storageId });
}

export function setDefaultObjectStorage(storageId: string) {
    return serverPost("/config/objectStorage/setDefaultObjectStorage", { storageId });
}

export async function waitAiTask(taskId: string, options: { signal?: AbortSignal; onProgress?: (task: ServerAiTask) => void } = {}) {
    if (options.signal?.aborted) {
        void cancelAiTask(taskId).catch(() => {});
        throw new DOMException("Aborted", "AbortError");
    }
    const initial = await getAiTaskInfo(taskId);
    if (options.signal?.aborted) {
        void cancelAiTask(taskId).catch(() => {});
        throw new DOMException("Aborted", "AbortError");
    }
    if (isFinalAiTaskStatus(initial.status)) return completedAiTask(initial);
    const pollingIntervalMilliseconds = await getAiTaskPollingIntervalMilliseconds();
    return new Promise<ServerAiTask>((resolve, reject) => {
        let settled = false;
        const cleanupFns: Array<() => void> = [];
        const finish = (callback: () => void) => {
            if (settled) return;
            settled = true;
            cleanupFns.forEach((cleanup) => cleanup());
            callback();
        };
        const onTask = (task: ServerAiTask) => {
            if (task.id !== taskId) return;
            if (!isFinalAiTaskStatus(task.status)) {
                options.onProgress?.(task);
                return;
            }
            finish(() => {
                try {
                    resolve(completedAiTask(task));
                } catch (error) {
                    reject(error);
                }
            });
        };
        cleanupFns.push(subscribeAiTaskEvents(onTask));
        const pollTimer = window.setInterval(() => {
            void getAiTaskInfo(taskId)
                .then(onTask)
                .catch((error) => finish(() => reject(error)));
        }, pollingIntervalMilliseconds);
        cleanupFns.push(() => window.clearInterval(pollTimer));
        if (options.signal) {
            const onAbort = () => {
                void cancelAiTask(taskId).catch(() => {});
                finish(() => reject(new DOMException("Aborted", "AbortError")));
            };
            if (options.signal.aborted) {
                onAbort();
            } else {
                options.signal.addEventListener("abort", onAbort, { once: true });
                cleanupFns.push(() => options.signal?.removeEventListener("abort", onAbort));
            }
        }
    });
}

export function readAiTaskError(error: unknown): AiTaskErrorDetails {
    if (error instanceof AiTaskFailureError) return error.details;
    if (error instanceof DOMException && error.name === "AbortError") {
        return { source: "canvas", category: "canceled", stage: "frontend_tool", message: "已停止生成", requestAccepted: true, safeToRetry: false };
    }
    return {
        source: "canvas",
        category: "unknown",
        stage: "frontend_tool",
        message: error instanceof Error ? error.message : "生成失败",
        requestAccepted: true,
        safeToRetry: false,
    };
}

function completedAiTask(task: ServerAiTask): ServerAiTask {
    if (task.status === "success") return task;
    const rawResult = task.resultData && typeof task.resultData === "object" ? (task.resultData as Record<string, unknown>) : undefined;
    const rawError = rawResult?.error && typeof rawResult.error === "object" ? (rawResult.error as Record<string, unknown>) : undefined;
    const message = readOptionalText(rawError?.message) || task.errorMessage || (task.status === "canceled" ? "任务已取消" : "生成失败");
    throw new AiTaskFailureError(message, {
        source: readOptionalText(rawError?.source) || "task",
        category: readOptionalText(rawError?.category) || (task.status === "canceled" ? "canceled" : "unknown"),
        stage: readOptionalText(rawError?.stage) || "execution",
        httpStatus: typeof rawError?.httpStatus === "number" ? rawError.httpStatus : undefined,
        code: readOptionalText(rawError?.code),
        type: readOptionalText(rawError?.type),
        parameter: readOptionalText(rawError?.parameter),
        message,
        requestAccepted: rawError?.requestAccepted === true ? true : rawError?.requestAccepted === false ? false : null,
        safeToRetry: rawError?.safeToRetry === true,
    });
}

function readOptionalText(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function serverGet<T>(path: string, options?: { auth?: boolean }) {
    return serverFetch<T>(path, { method: "GET" }, options);
}

export async function serverPost<T = string>(path: string, body: unknown, options?: { auth?: boolean }) {
    return serverFetch<T>(
        path,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        },
        options,
    );
}

async function serverFetch<T>(path: string, init: RequestInit, options: { auth?: boolean } = {}) {
    const response = await requestServer(path, init, options);
    const payload = (await response.json().catch(() => null)) as ApiResponse<T> | null;
    if (!response.ok || !payload) {
        throw new Error(payload?.msg || `服务端请求失败：${response.status}`);
    }
    if (payload.code !== 0) {
        throw new Error(payload.msg || "服务端请求失败");
    }
    return payload.data;
}

async function requestServer(path: string, init: RequestInit, options: { auth?: boolean } = {}) {
    const headers = new Headers(init.headers);
    if (options.auth !== false) {
        const token = getAuthToken();
        if (token) headers.set("Authorization", `Bearer ${token}`);
    }
    const response = await fetch(`${serverBaseUrl()}${path}`, {
        ...init,
        headers,
        cache: "no-store",
    });
    if (response.status === 401) {
        const store = useUserStore.getState();
        store.clearSession();
        store.openAuthModal();
    }
    return response;
}

export function serverBaseUrl() {
    const configured = process.env.NEXT_PUBLIC_SERVER_URL?.trim().replace(/\/+$/, "");
    if (configured) return withServerApiPrefix(configured);
    if (typeof window !== "undefined") return withServerApiPrefix(window.location.origin);
    return withServerApiPrefix(defaultServerUrl);
}

type AiTaskListener = (task: ServerAiTask) => void;
type AiTaskDeltaListener = (taskId: string, delta: string) => void;
type CreditBalanceListener = (creditBalance: number) => void;

const aiTaskListeners = new Set<AiTaskListener>();
const aiTaskDeltaListeners = new Set<AiTaskDeltaListener>();
const creditBalanceListeners = new Set<CreditBalanceListener>();
let aiTaskEventSource: EventSource | null = null;
let aiTaskReconnectTimer: number | null = null;

export function subscribeAiTaskEvents(listener: AiTaskListener) {
    aiTaskListeners.add(listener);
    ensureAiTaskEventSource();
    return () => {
        aiTaskListeners.delete(listener);
        if (!hasAiTaskEventListeners()) closeAiTaskEventSource();
    };
}

export function subscribeAiTaskDeltas(listener: AiTaskDeltaListener) {
    aiTaskDeltaListeners.add(listener);
    ensureAiTaskEventSource();
    return () => {
        aiTaskDeltaListeners.delete(listener);
        if (!hasAiTaskEventListeners()) closeAiTaskEventSource();
    };
}

export function subscribeCreditBalanceEvents(listener: CreditBalanceListener) {
    creditBalanceListeners.add(listener);
    ensureAiTaskEventSource();
    return () => {
        creditBalanceListeners.delete(listener);
        if (!hasAiTaskEventListeners()) closeAiTaskEventSource();
    };
}

function ensureAiTaskEventSource() {
    if (aiTaskEventSource || typeof window === "undefined") return;
    const token = getAuthToken();
    if (!token) return;
    const source = new EventSource(`${serverBaseUrl()}/ai/task/subscribe?token=${encodeURIComponent(token)}`);
    aiTaskEventSource = source;
    source.addEventListener("task", (event) => {
        const payload = parseAiTaskEventData((event as MessageEvent).data);
        if (!payload.task) return;
        aiTaskListeners.forEach((listener) => listener(payload.task as ServerAiTask));
    });
    source.addEventListener("text-delta", (event) => {
        const payload = parseAiTaskEventData((event as MessageEvent).data);
        if (!payload.task || typeof payload.delta !== "string") return;
        aiTaskDeltaListeners.forEach((listener) => listener(payload.task!.id, payload.delta as string));
    });
    source.addEventListener("credit-balance", (event) => {
        const payload = parseAiTaskEventData((event as MessageEvent).data);
        const creditBalance = payload.creditBalance;
        if (typeof creditBalance !== "number" || !Number.isInteger(creditBalance) || creditBalance < 0) return;
        creditBalanceListeners.forEach((listener) => listener(creditBalance));
    });
    source.onerror = () => {
        closeAiTaskEventSource();
        if (!hasAiTaskEventListeners()) return;
        aiTaskReconnectTimer = window.setTimeout(() => {
            aiTaskReconnectTimer = null;
            ensureAiTaskEventSource();
        }, 2000);
    };
}

function closeAiTaskEventSource() {
    if (aiTaskReconnectTimer) {
        window.clearTimeout(aiTaskReconnectTimer);
        aiTaskReconnectTimer = null;
    }
    aiTaskEventSource?.close();
    aiTaskEventSource = null;
}

function hasAiTaskEventListeners() {
    return Boolean(aiTaskListeners.size || aiTaskDeltaListeners.size || creditBalanceListeners.size);
}

function isFinalAiTaskStatus(status: ServerAiTaskStatus) {
    return status === "success" || status === "failed" || status === "canceled";
}

function parseAiTaskEventData(data: string): { task?: ServerAiTask; delta?: string; creditBalance?: number } {
    const payload = JSON.parse(data) as { task?: ServerAiTask; delta?: string; creditBalance?: number } | string;
    return typeof payload === "string" ? (JSON.parse(payload) as { task?: ServerAiTask; delta?: string; creditBalance?: number }) : payload;
}

function withServerApiPrefix(baseUrl: string) {
    return baseUrl.endsWith(serverApiPrefix) ? baseUrl : `${baseUrl}${serverApiPrefix}`;
}

function appendFormValue(formData: FormData, key: string, value: string | number | undefined) {
    if (value === undefined || value === "") return;
    formData.set(key, String(value));
}

function promptQuery(params: ServerPromptListParams) {
    const query = new URLSearchParams();
    if (params.keyword) query.set("keyword", params.keyword);
    params.tag?.forEach((tag) => query.append("tag", tag));
    if (params.category) query.set("category", params.category);
    if (params.status !== undefined) query.set("status", String(params.status));
    if (params.page) query.set("page", String(params.page));
    if (params.pageSize) query.set("pageSize", String(params.pageSize));
    return query.size ? `?${query}` : "";
}

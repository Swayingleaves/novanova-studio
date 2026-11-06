import { serverGet, serverPost } from "./server";
import type { CanvasDocument } from "@/features/canvas/types";
import { useUserStore } from "@/features/auth/stores/use-user-store";

export type SharedWorkType = "image" | "video" | "canvas";
export type SharedWorkSource = { sourceType: "generation" | "canvas"; sourceId: string; workType: SharedWorkType; roundId?: string; resultId?: string; nodeId?: string };
export type SharedWorkStatus = "preparing" | "failed" | "pending" | "published" | "rejected" | "withdrawn" | "takenDown";
export type SharedMedia = { source: string; mimeType?: string; width?: number; height?: number };
export type SharedSnapshot = { kind: SharedWorkType; media?: SharedMedia; generation?: Record<string, string | number | boolean>; scene?: CanvasDocument["scene"]; preferences?: CanvasDocument["preferences"] };
export type SharedWork = { shareCode: string; title: string; description: string; category: string; creatorName: string; workType: SharedWorkType; status: SharedWorkStatus; reviewReason: string; createdAt: string; publishedAt: string | null; previewUrl?: string };
export type SharedWorkDetail = { work: SharedWork; snapshot: SharedSnapshot };
export type SharedWorkPage = { items: SharedWork[]; total: number; page: number; pageSize: number };
export type ShareForm = SharedWorkSource & { title: string; description: string; category: string; includeGenerationInformation: boolean; requestId: string; sourceVersion?: string };
export type FantasticWork = { id: string; source: "official" | "user"; shareCode: string; title: string; description: string; category: string; creatorName: string; workType: SharedWorkType; mediaUrl: string; thumbnailUrl: string; targetPath: string; promptContent: string; likeCount: number; liked: boolean };
export type FantasticLikeResult = { likeCount: number; liked: boolean };

export const sharedWorkStatusNames: Record<SharedWorkStatus, string> = { preparing: "准备中", failed: "准备失败", pending: "待审核", published: "已发布", rejected: "已驳回", withdrawn: "已撤回", takenDown: "已下架" };
export const sharedWorkTypeNames: Record<SharedWorkType, string> = { image: "图片", video: "视频", canvas: "画布" };
export const previewSharedWork = (form: ShareForm, signal?: AbortSignal) => serverPost<{ snapshot: SharedSnapshot; sourceVersion: string }>("/sharedWork/previewWork", form, { signal });
export const submitSharedWork = (form: ShareForm) => serverPost<SharedWork>("/sharedWork/submitWork", form);
export const getSharedWork = (shareCode: string, publicAccess = true, signal?: AbortSignal) => serverGet<SharedWorkDetail>(`/sharedWork/${publicAccess ? "getPublicWork" : "getWorkDetail"}?shareCode=${encodeURIComponent(shareCode)}`, publicAccess ? { auth: false, scope: "platform", signal } : { signal });
export const listSharedWorks = (review: boolean, page: number, status: string, signal?: AbortSignal) => serverGet<SharedWorkPage>(`/${review ? "admin/sharedWork/listReviews" : "sharedWork/listMyWorks"}?page=${page}&status=${encodeURIComponent(status)}`, { signal });
export const withdrawSharedWork = (shareCode: string) => serverPost<void>("/sharedWork/withdrawWork", { shareCode });
export const reviewSharedWork = (shareCode: string, action: "approve" | "reject" | "takeDown", reason: string) => serverPost<void>(`/admin/sharedWork/${action === "takeDown" ? "takeDownWork" : "reviewWork"}`, { shareCode, action, reason });
export const copySharedCanvas = (shareCode: string) => serverPost<{ documentId: string }>("/sharedWork/copyCanvas", { shareCode }, { scope: "platform" });
export const listFantasticWorks = (type: string, category: string, keyword: string, page: number, signal?: AbortSignal) => serverGet<{ items: FantasticWork[]; total: number; page: number; pageSize: number }>(`/homepage/listFantasticWorks?${new URLSearchParams({ workType: type, category, keyword, page: String(page) })}`, { auth: Boolean(useUserStore.getState().token), scope: "platform", signal });
export const toggleFantasticLike = (targetKey: string) => serverPost<FantasticLikeResult>("/homepage/toggleFantasticLike", { targetKey }, { scope: "platform" });

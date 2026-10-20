import { serverGet, serverPost } from "./server";

/** 容量以十进制字节字符串传输，避免大整数精度损失。 */
export type StorageFileCategory = "image" | "video" | "audio" | "document" | "other";
export type StorageCategoryUsage = { category: StorageFileCategory; fileCount: number; usedBytes: string };
export type StorageCapacity = { freeBytes: string; purchasedBytes: string; totalBytes: string; usedBytes: string; reservedBytes: string; pendingDeletionBytes: string; categories: StorageCategoryUsage[] };
export type StorageFile = {
    objectId: string;
    fileName: string;
    category: StorageFileCategory;
    mimeType: string;
    sourceType: "upload" | "generated" | "remoteImport" | "sourceImport" | "unrecorded";
    fileBytes: string;
    storedAt: string;
    status: "available" | "pendingDeletion" | "deletionFailed";
};
export type StorageFileQuery = { page: number; pageSize: number; keyword: string; category: StorageFileCategory | ""; sort: "newest" | "oldest" | "largest" | "smallest" };
export type StorageFilePage = { items: StorageFile[]; total: number; page: number; pageSize: number };
export type StorageCapacityPackage = { id: string; teamId: number; name: string; capacityGigabytes: number; credits: string; enabled: boolean; revision: number };
export type StorageCapacitySettings = { freeGigabytes: number; packages: StorageCapacityPackage[] };
export type CapacityPurchaseRequest = { packageId: string; revision: number; clientRequestId: string };
export type CapacityPurchaseResult = { purchaseId: string; walletTeamId: number; creditBalance: string; capacity: StorageCapacity };

export const getStorageCapacity = () => serverGet<StorageCapacity>("/storage/getCapacity");
export const listStorageCapacityPackages = () => serverGet<{ walletTeamId: number; packages: StorageCapacityPackage[] }>("/storage/listCapacityPackages");
export const purchaseStorageCapacity = (request: CapacityPurchaseRequest) => serverPost<CapacityPurchaseResult>("/storage/purchaseCapacity", request);
export const getStorageCapacitySettings = () => serverGet<StorageCapacitySettings>("/storage/getCapacitySettings");
export const saveStorageCapacitySettings = (freeGigabytes: number) => serverPost("/storage/saveCapacitySettings", { freeGigabytes });
export const saveStorageCapacityPackage = (request: Omit<StorageCapacityPackage, "id" | "teamId" | "revision"> & { id?: string; revision?: number }) => serverPost("/storage/saveCapacityPackage", request);

export const listStorageFiles = (query: StorageFileQuery) => serverGet<StorageFilePage>(`/storage/listFiles?${new URLSearchParams({ ...query, page: String(query.page), pageSize: String(query.pageSize) })}`);
export const getStorageFileAccess = (objectId: string, purpose: "preview" | "download") => serverGet<{ url: string; expiresAt: string }>(`/storage/getFileAccess?${new URLSearchParams({ objectId, purpose })}`);
export const deleteStorageFile = (objectId: string) => serverPost<{ objectId: string; status: "pendingDeletion" | "deleted" }>("/storage/deleteFile", { objectId });

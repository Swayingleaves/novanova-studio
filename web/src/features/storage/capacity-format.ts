import Decimal from "decimal.js";
import type { StorageCapacity } from "@/services/api/storage";

export const storageFileCategories = ["image", "video", "audio", "document", "other"] as const;

/** 将真实字节转换成最多两位小数的G，非零微小用量不会显示为零。 */
export function formatStorageGigabytes(bytes: string) {
    const gigabytes = new Decimal(bytes).div(1_000_000_000);
    if (gigabytes.gt(0) && gigabytes.lt(0.01)) return "<0.01";
    return gigabytes.toDecimalPlaces(2).toString();
}

/** 文件明细使用十进制单位，与容量的一G十亿字节保持一致。 */
export function formatStorageFileBytes(bytes: string) {
    const value = new Decimal(bytes);
    const units = ["B", "KB", "MB", "G"];
    const index = value.gte(1_000_000_000) ? 3 : value.gte(1_000_000) ? 2 : value.gte(1_000) ? 1 : 0;
    return `${value.div(new Decimal(1000).pow(index)).toDecimalPlaces(2).toString()} ${units[index]}`;
}

/** 分段比例使用真实字节计算，预占单独显示，超额及零额度不会导致条形溢出。 */
export function storageUsageSegments(capacity: StorageCapacity) {
    const occupied = new Decimal(capacity.usedBytes).plus(capacity.reservedBytes);
    const total = new Decimal(capacity.totalBytes);
    const scale = Decimal.max(total, occupied);
    const percentage = (bytes: string) => (scale.isZero() ? 0 : new Decimal(bytes).div(scale).mul(100).toNumber());
    return {
        categories: storageFileCategories.map((category) => {
            const usage = capacity.categories.find((item) => item.category === category);
            return { category, fileCount: usage?.fileCount ?? 0, usedBytes: usage?.usedBytes ?? "0", percentage: percentage(usage?.usedBytes ?? "0") };
        }),
        reservedPercentage: percentage(capacity.reservedBytes),
        availableBytes: Decimal.max(total.minus(occupied), 0).toFixed(0),
        exceededBytes: Decimal.max(occupied.minus(total), 0).toFixed(0),
    };
}

import assert from "node:assert/strict";
import test from "node:test";
import { formatStorageGigabytes, formatStorageFileBytes, storageUsageSegments } from "./capacity-format.ts";
import type { StorageCapacity } from "@/services/api/storage";

test("云存储统一使用G，微小占用不显示零，去除尾零并最多两位小数", () => {
    assert.equal(formatStorageGigabytes("0"), "0");
    assert.equal(formatStorageGigabytes("1"), "<0.01");
    assert.equal(formatStorageGigabytes("10000000"), "0.01");
    assert.equal(formatStorageGigabytes("1000000000"), "1");
    assert.equal(formatStorageGigabytes("1234567890"), "1.23");
    assert.equal(formatStorageGigabytes("3149999999"), "3.15");
    assert.equal(formatStorageGigabytes("9223372036854775807"), "9223372036.85");
});

test("云文件大小使用十进制单位，边界与总容量单位一致", () => {
    assert.equal(formatStorageFileBytes("0"), "0 B");
    assert.equal(formatStorageFileBytes("999"), "999 B");
    assert.equal(formatStorageFileBytes("1000"), "1 KB");
    assert.equal(formatStorageFileBytes("1000000"), "1 MB");
    assert.equal(formatStorageFileBytes("1234567890"), "1.23 G");
});

const capacity = (overrides: Partial<StorageCapacity> = {}): StorageCapacity => ({
    freeBytes: "3000000000",
    purchasedBytes: "0",
    totalBytes: "3000000000",
    usedBytes: "1000000000",
    reservedBytes: "500000000",
    pendingDeletionBytes: "200000000",
    categories: [{ category: "image", usedBytes: "1000000000", fileCount: 2 }],
    ...overrides,
});

test("预占独立占用可用量，待删除字节作为已用子集不重复计算", () => {
    const usage = storageUsageSegments(capacity());
    assert.equal(usage.availableBytes, "1500000000");
    assert.equal(usage.exceededBytes, "0");
    assert.equal(usage.categories[0].fileCount, 2);
    assert.equal(usage.categories[1].usedBytes, "0");
    assert.equal(
        usage.categories.reduce((total, item) => total + item.percentage, usage.reservedPercentage),
        50,
    );
});

test("降低免费额度或零额度不会使条形超宽或出现无效比例", () => {
    const exceeded = storageUsageSegments(capacity({ totalBytes: "1000000000" }));
    assert.equal(exceeded.availableBytes, "0");
    assert.equal(exceeded.exceededBytes, "500000000");
    assert.equal(
        exceeded.categories.reduce((total, item) => total + item.percentage, exceeded.reservedPercentage),
        100,
    );
    const empty = storageUsageSegments(capacity({ totalBytes: "0", usedBytes: "0", reservedBytes: "0", categories: [] }));
    assert.equal(empty.reservedPercentage, 0);
    assert.ok(empty.categories.every((item) => item.percentage === 0));
});

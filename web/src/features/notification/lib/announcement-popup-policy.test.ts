import assert from "node:assert/strict";
import test from "node:test";

import { selectPopupAnnouncements } from "./announcement-popup-policy";

test("未读公告按发布时间倒序返回，已读/会话关闭/今日不再提示均被过滤", () => {
    const notifications = [
        { id: 1, title: "旧公告", content: "正文1", imageUrl: null, priority: "normal" as const, status: 1, publishedAt: "2026-11-23T08:00:00Z", read: false, createdAt: "2026-11-23T08:00:00Z" },
        { id: 2, title: "", content: "", imageUrl: "https://cdn.example.com/banner.png", priority: "normal" as const, status: 1, publishedAt: "2026-11-24T09:00:00Z", read: false, createdAt: "2026-11-24T09:00:00Z" },
        { id: 3, title: "已读公告", content: "正文3", imageUrl: null, priority: "normal" as const, status: 1, publishedAt: "2026-11-24T10:00:00Z", read: true, createdAt: "2026-11-24T10:00:00Z" },
        { id: 4, title: "今日静默", content: "正文4", imageUrl: null, priority: "normal" as const, status: 1, publishedAt: "2026-11-24T10:30:00Z", read: false, createdAt: "2026-11-24T10:30:00Z" },
        { id: 5, title: "会话关闭", content: "正文5", imageUrl: null, priority: "normal" as const, status: 1, publishedAt: "2026-11-24T11:00:00Z", read: false, createdAt: "2026-11-24T11:00:00Z" },
    ];

    const popup = selectPopupAnnouncements(notifications, {
        todayKey: "2026-11-24",
        sessionDismissedIds: new Set([5]),
        dailySuppressedMap: { "4": "2026-11-24", "1": "2026-11-23" },
    });

    assert.deepEqual(
        popup.map((item) => item.id),
        [2, 1],
    );
});

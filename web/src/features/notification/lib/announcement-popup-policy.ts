import type { SystemNotification } from "@/services/api/server";

const SESSION_DISMISSED_KEY_PREFIX = "novanova:announcement:session-dismissed:";
const DAILY_SUPPRESSED_KEY_PREFIX = "novanova:announcement:daily-suppressed:";

/** 格式化本地自然日键（YYYY-MM-DD）。 */
export function formatLocalDayKey(date: Date = new Date()): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

/** 筛选当前应当居中弹窗展示的未读公告列表（按发布时间倒序）。 */
export function selectPopupAnnouncements(
    notifications: readonly SystemNotification[],
    options: {
        todayKey: string;
        sessionDismissedIds: ReadonlySet<number>;
        dailySuppressedMap: Readonly<Record<string, string>>;
    },
): SystemNotification[] {
    return notifications
        .filter((item) => {
            if (item.read) return false;
            if (options.sessionDismissedIds.has(item.id)) return false;
            if (options.dailySuppressedMap[String(item.id)] === options.todayKey) return false;
            return Boolean(item.title?.trim() || item.content?.trim() || item.imageUrl?.trim());
        })
        .sort((first, second) => {
            const firstTime = Date.parse(first.publishedAt || first.createdAt || "") || 0;
            const secondTime = Date.parse(second.publishedAt || second.createdAt || "") || 0;
            return secondTime - firstTime || second.id - first.id;
        });
}

/** 读取当前登录会话内点右上角关闭的公告 ID 集合。 */
export function readSessionDismissedIds(userId: string): Set<number> {
    if (typeof window === "undefined" || !userId) return new Set();
    try {
        const raw = window.sessionStorage.getItem(`${SESSION_DISMISSED_KEY_PREFIX}${userId}`);
        if (!raw) return new Set();
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return new Set();
        return new Set(parsed.filter((id): id is number => typeof id === "number"));
    } catch {
        return new Set();
    }
}

/** 记录某条公告在本次会话已关闭（F5 刷新不再弹，重新登录会重新弹）。 */
export function markAnnouncementSessionDismissed(userId: string, notificationIds: readonly number[]): void {
    if (typeof window === "undefined" || !userId || !notificationIds.length) return;
    try {
        const current = readSessionDismissedIds(userId);
        for (const id of notificationIds) current.add(id);
        window.sessionStorage.setItem(`${SESSION_DISMISSED_KEY_PREFIX}${userId}`, JSON.stringify([...current]));
    } catch {
        // 忽略受限环境写入异常
    }
}

/** 登录/登出时清理所有会话级公告关闭记录，确保重新登录后未读公告能正常弹出。 */
export function clearSessionDismissedAnnouncements(): void {
    if (typeof window === "undefined") return;
    try {
        const keysToRemove: string[] = [];
        for (let index = 0; index < window.sessionStorage.length; index += 1) {
            const key = window.sessionStorage.key(index);
            if (key?.startsWith(SESSION_DISMISSED_KEY_PREFIX)) {
                keysToRemove.push(key);
            }
        }
        for (const key of keysToRemove) {
            window.sessionStorage.removeItem(key);
        }
    } catch {
        // 忽略受限环境异常
    }
}

/** 读取“今日不再提示”映射并自动剔除过期日期条目。 */
export function readDailySuppressedMap(userId: string, todayKey: string = formatLocalDayKey()): Record<string, string> {
    if (typeof window === "undefined" || !userId) return {};
    try {
        const key = `${DAILY_SUPPRESSED_KEY_PREFIX}${userId}`;
        const raw = window.localStorage.getItem(key);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const active: Record<string, string> = {};
        let pruned = false;
        for (const [id, day] of Object.entries(parsed as Record<string, unknown>)) {
            if (day === todayKey) {
                active[id] = todayKey;
            } else {
                pruned = true;
            }
        }
        if (pruned) {
            window.localStorage.setItem(key, JSON.stringify(active));
        }
        return active;
    } catch {
        return {};
    }
}

/** 标记指定公告在今天内不再弹窗。 */
export function markAnnouncementSuppressedToday(
    userId: string,
    notificationIds: readonly number[],
    todayKey: string = formatLocalDayKey(),
): void {
    if (typeof window === "undefined" || !userId || !notificationIds.length) return;
    try {
        const current = readDailySuppressedMap(userId, todayKey);
        for (const id of notificationIds) {
            current[String(id)] = todayKey;
        }
        window.localStorage.setItem(`${DAILY_SUPPRESSED_KEY_PREFIX}${userId}`, JSON.stringify(current));
    } catch {
        // 忽略受限环境写入异常
    }
}

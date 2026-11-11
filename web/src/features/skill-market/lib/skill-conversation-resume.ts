import type { SkillOption } from "@/services/api/server";

export type SkillConversationTarget = "image" | "video";

/** 离开创作页时保留的技能会话，回来后继续同一场引导。 */
export type ResumedSkillConversation = {
    sessionId: string;
    skill: SkillOption;
};

const STORAGE_KEY_PREFIX = "novanova:skill-conversation:";

function storageKey(target: SkillConversationTarget) {
    return `${STORAGE_KEY_PREFIX}${target}`;
}

function readStorage(): Storage | null {
    try {
        return typeof sessionStorage === "undefined" ? null : sessionStorage;
    } catch {
        return null;
    }
}

function isSkill(value: unknown, target: SkillConversationTarget): value is SkillOption {
    if (!value || typeof value !== "object") return false;
    const skill = value as SkillOption;
    return typeof skill.id === "number" && typeof skill.name === "string" && skill.targetType === target;
}

export function parseResumedSkillConversation(value: unknown, target: SkillConversationTarget): ResumedSkillConversation | null {
    if (!value || typeof value !== "object") return null;
    const record = value as ResumedSkillConversation;
    if (typeof record.sessionId !== "string" || !record.sessionId.trim()) return null;
    if (!isSkill(record.skill, target)) return null;
    return { sessionId: record.sessionId, skill: record.skill };
}

export function readResumedSkillConversation(target: SkillConversationTarget): ResumedSkillConversation | null {
    const stored = readStorage()?.getItem(storageKey(target));
    if (!stored) return null;
    try {
        return parseResumedSkillConversation(JSON.parse(stored), target);
    } catch {
        return null;
    }
}

export function writeResumedSkillConversation(target: SkillConversationTarget, conversation: ResumedSkillConversation): void {
    const storage = readStorage();
    if (!storage || !parseResumedSkillConversation(conversation, target)) return;
    try {
        storage.setItem(storageKey(target), JSON.stringify(conversation));
    } catch {
        // 存储不可用时下次进入页面会重新选择会话，不阻断当前创作。
    }
}

export function clearResumedSkillConversation(target: SkillConversationTarget): void {
    try {
        readStorage()?.removeItem(storageKey(target));
    } catch {
        // 清理失败只影响下次自动恢复。
    }
}

/** 用技能列表补全会话里保存的技能快照；列表还没加载时先用快照本身。 */
export function skillOptionFromSnapshot(
    skill: { id: number; name: string; targetType: string; description?: string; coverUrl?: string; workflowType?: string | null; aspectRatio?: string } | null | undefined,
    options: SkillOption[] = [],
): SkillOption | null {
    if (!skill || typeof skill.id !== "number" || (skill.targetType !== "image" && skill.targetType !== "video")) return null;
    return options.find((item) => item.id === skill.id) ?? {
        id: skill.id,
        name: skill.name,
        description: skill.description ?? "",
        targetType: skill.targetType,
        coverUrl: skill.coverUrl ?? "",
        workflowType: skill.workflowType,
        aspectRatio: skill.aspectRatio,
    };
}

import type { SkillOption } from "@/services/api/server";

export type SkillCreationTarget = "image" | "video";

/** 进入创作页后自动发给 Agent 的第一句。左侧任务标题取这句，所以带上技能名。 */
export function skillMarketKickoff(skillName: string): string {
    const name = skillName.trim();
    return name ? `开始使用【${name}】技能` : "开始使用这个技能";
}

export type SkillCreationHandoff = {
    target: SkillCreationTarget;
    skill: SkillOption;
};

const STORAGE_KEY = "novanova:skill-market-handoff";

function readStorage(): Storage | null {
    try {
        return typeof sessionStorage === "undefined" ? null : sessionStorage;
    } catch {
        return null;
    }
}

function isSkill(value: unknown): value is SkillOption {
    if (!value || typeof value !== "object") return false;
    const skill = value as SkillOption;
    return typeof skill.id === "number" && typeof skill.name === "string" && (skill.targetType === "image" || skill.targetType === "video");
}

export function parseSkillCreationHandoff(value: unknown): SkillCreationHandoff | null {
    if (!value || typeof value !== "object") return null;
    const record = value as SkillCreationHandoff;
    if (record.target !== "image" && record.target !== "video") return null;
    if (!isSkill(record.skill) || record.skill.targetType !== record.target) return null;
    return { target: record.target, skill: record.skill };
}

function readHandoff(): SkillCreationHandoff | null {
    const stored = readStorage()?.getItem(STORAGE_KEY);
    if (!stored) return null;
    try {
        return parseSkillCreationHandoff(JSON.parse(stored));
    } catch {
        return null;
    }
}

/** 只读取对应创作页的交接，刷新前重复挂载不会丢掉。 */
export function peekSkillCreationHandoff(target: SkillCreationTarget): SkillCreationHandoff | null {
    const handoff = readHandoff();
    return handoff?.target === target ? handoff : null;
}

/** 确认开始工作流后删除交接，避免刷新再次发送。 */
export function consumeSkillCreationHandoff(target: SkillCreationTarget): SkillCreationHandoff | null {
    const handoff = peekSkillCreationHandoff(target);
    if (!handoff) return null;
    readStorage()?.removeItem(STORAGE_KEY);
    return handoff;
}

export function storeSkillCreationHandoff(handoff: SkillCreationHandoff): boolean {
    const storage = readStorage();
    if (!storage || !parseSkillCreationHandoff(handoff)) return false;
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(handoff));
        return true;
    } catch {
        return false;
    }
}

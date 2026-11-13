"use client";

import { useEffect, useState } from "react";

import { peekSkillCreationHandoff, type SkillCreationHandoff, type SkillCreationTarget } from "@/features/skill-market/lib/skill-creation-handoff";

/** 读取技能市场交给当前创作页的技能，刷新前重复挂载仍能读到。 */
export function useSkillCreationHandoff(target: SkillCreationTarget) {
    const [handoff, setHandoff] = useState<SkillCreationHandoff | null>(null);
    useEffect(() => {
        setHandoff(peekSkillCreationHandoff(target));
    }, [target]);
    return handoff;
}

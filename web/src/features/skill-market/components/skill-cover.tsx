"use client";

import { useEffect, useState } from "react";

import { loadSkillCover } from "@/features/skill-market/lib/skill-cover-cache";

/**
 * 技能封面。
 * <p>
 * 按对象路径缓存到本地，命中后不再请求；读取失败时回退到原始地址，不影响展示。
 */
export function SkillCover({ src, alt, className }: { src?: string; alt?: string; className?: string }) {
    const [resolved, setResolved] = useState<string>();
    useEffect(() => {
        const url = src?.trim();
        if (!url) {
            setResolved(undefined);
            return;
        }
        let active = true;
        let objectUrl = "";
        void loadSkillCover(url).then((blob) => {
            if (!active) return;
            if (!blob) {
                setResolved(url);
                return;
            }
            objectUrl = URL.createObjectURL(blob);
            setResolved(objectUrl);
        });
        return () => {
            active = false;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [src]);
    return <img src={resolved} alt={alt || ""} loading="lazy" className={className} />;
}

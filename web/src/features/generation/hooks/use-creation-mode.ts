"use client";

import { useCallback, useEffect, useState } from "react";

import { readCreationMode, writeCreationMode, type CreationMode, type CreationModeTarget } from "@/features/generation/lib/creation-mode-preference";

/**
 * 管理创作页的 Agent / Chat 模式选择。
 * <p>
 * 初始值固定为 agent，保证服务端首帧与客户端水合一致；挂载后再读取本地存储恢复上次选择。
 *
 * @param target 图片页或视频页
 * @return 当前模式与切换方法
 */
export function useCreationMode(target: CreationModeTarget) {
    const [mode, setMode] = useState<CreationMode>("agent");

    useEffect(() => {
        setMode(readCreationMode(target));
    }, [target]);

    const changeMode = useCallback(
        (next: CreationMode) => {
            setMode(next);
            writeCreationMode(target, next);
        },
        [target],
    );

    return { mode, changeMode };
}

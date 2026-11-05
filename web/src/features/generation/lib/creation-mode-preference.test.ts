import assert from "node:assert/strict";
import test from "node:test";

const { normalizeCreationMode, readCreationMode, writeCreationMode } = await import(new URL("./creation-mode-preference.ts", import.meta.url).href);

type StorageLike = {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
};

/**
 * 用内存 storage 替换 window.localStorage，返回恢复函数。
 *
 * @param storage 假 storage
 * @return 恢复原 window 的函数
 */
function useWindow(storage: StorageLike) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage } });
    return () => {
        if (previous) Object.defineProperty(globalThis, "window", previous);
        else delete (globalThis as { window?: unknown }).window;
    };
}

/** 创建内存 localStorage。 */
function memoryStorage(): StorageLike {
    const values = new Map<string, string>();
    return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
            values.set(key, value);
        },
        removeItem: (key: string) => {
            values.delete(key);
        },
    };
}

test("未设置或脏值时默认 Agent 模式", () => {
    const restore = useWindow(memoryStorage());
    try {
        assert.equal(readCreationMode("image"), "agent");
        assert.equal(normalizeCreationMode("unknown"), "agent");
        assert.equal(normalizeCreationMode(null), "agent");
        assert.equal(normalizeCreationMode("chat"), "chat");
    } finally {
        restore();
    }
});

test("图片页与视频页分别记忆模式", () => {
    const restore = useWindow(memoryStorage());
    try {
        writeCreationMode("video", "chat");
        assert.equal(readCreationMode("video"), "chat");
        assert.equal(readCreationMode("image"), "agent");

        writeCreationMode("image", "chat");
        assert.equal(readCreationMode("image"), "chat");
        writeCreationMode("image", "agent");
        assert.equal(readCreationMode("image"), "agent");
        assert.equal(readCreationMode("video"), "chat");
    } finally {
        restore();
    }
});

test("存储不可用时读取回落 Agent 且写入不抛错", () => {
    const restore = useWindow({
        getItem: () => {
            throw new Error("blocked");
        },
        setItem: () => {
            throw new Error("blocked");
        },
        removeItem: () => {
            throw new Error("blocked");
        },
    });
    try {
        assert.equal(readCreationMode("image"), "agent");
        assert.doesNotThrow(() => writeCreationMode("image", "chat"));
    } finally {
        restore();
    }
});

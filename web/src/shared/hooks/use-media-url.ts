"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { resolveImageUrl } from "@/features/storage/services/image-storage";
import { resolveMediaUrl } from "@/features/storage/services/file-storage";
import type { ObjectStorageFile } from "@/shared/types/object-storage";

type MediaUrlInput = {
    /** 业务媒体存储键，优先于已保存的地址 */
    storageKey?: string;
    /** 对象存储信息，用于在没有存储键时提供初始展示地址 */
    objectStorage?: ObjectStorageFile;
    /** 初始展示地址 */
    url?: string;
    /** 图片使用图片缓存，其余使用媒体缓存 */
    kind?: "image" | "media";
};

/**
 * 统一解析私有存储桶的临时媒体地址。
 * <p>
 * 有业务存储键时总是通过接口换取当前可用地址；地址失效后允许在渲染错误时强制续签一次，避免页面长期停留后图片和视频裂开。
 *
 * @param input 媒体存储键、对象存储信息和初始地址
 * @return 当前地址、失败状态、手动刷新与错误回调
 */
export function useMediaUrl(input: MediaUrlInput) {
    const initialUrl = input.url || input.objectStorage?.url || "";
    const [url, setUrl] = useState(initialUrl);
    const [failed, setFailed] = useState(false);
    const urlRef = useRef(initialUrl);
    urlRef.current = url;
    const retryCount = useRef(0);
    const storageKey = input.storageKey?.trim() || "";
    const kind = input.kind || "media";

    const resolve = useCallback(
        async (forceRefresh: boolean) => {
            if (!storageKey) return input.url || "";
            return kind === "image"
                ? resolveImageUrl(storageKey, input.url || "", forceRefresh)
                : resolveMediaUrl(storageKey, input.url || "", forceRefresh);
        },
        [input.url, kind, storageKey],
    );

    useEffect(() => {
        let cancelled = false;
        retryCount.current = 0;
        setFailed(false);
        if (!storageKey) {
            setUrl(input.url || "");
            return;
        }
        void resolve(false)
            .then((next) => {
                if (!cancelled && next) {
                    setUrl(next);
                    setFailed(false);
                }
            })
            .catch(() => {
                if (!cancelled && !urlRef.current) {
                    setFailed(true);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [input.url, resolve, storageKey]);

    const refresh = useCallback(async () => {
        if (!storageKey) {
            setFailed(true);
            return;
        }
        try {
            const next = await resolve(true);
            // 续签返回空地址或与已失败地址完全相同时，浏览器不会再次触发 onError，必须立即进入失败态以展示默认图标。
            if (next && next !== urlRef.current) {
                setUrl(next);
                setFailed(false);
            } else {
                setFailed(true);
            }
        } catch {
            setFailed(true);
        }
    }, [resolve, storageKey]);

    const onError = useCallback(() => {
        // 每个 storageKey 只自动续签一次：服务端每次续签都会返回新地址，按地址去重会无限重试。
        if (!storageKey || retryCount.current >= 1) {
            setFailed(true);
            return;
        }
        retryCount.current += 1;
        void refresh();
    }, [refresh, storageKey]);

    return { url, failed, refresh, onError };
}

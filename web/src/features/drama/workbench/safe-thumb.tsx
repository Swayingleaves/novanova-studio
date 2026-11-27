"use client";

import { Image as ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";

/** 带加载失败自动回退的缩略图/预览图组件：加载异常时展示默认占位，不显示浏览器原生破图图标。 */
export function SafeThumbImage({
    src,
    alt = "",
    fallbackLabel,
    className = "size-full object-cover",
}: {
    src?: string;
    alt?: string;
    fallbackLabel?: string;
    className?: string;
}) {
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        setFailed(false);
    }, [src]);

    if (!src || failed) {
        return (
            <span className="flex size-full flex-col items-center justify-center gap-0.5 bg-[var(--studio-surface-raised)] text-[var(--studio-faint)]">
                <ImageIcon className="size-3.5 opacity-75" aria-hidden="true" />
                {fallbackLabel ? (
                    <span className="text-[9px] font-medium leading-none tabular-nums opacity-80">{fallbackLabel}</span>
                ) : null}
            </span>
        );
    }

    return (
        <img
            src={src}
            alt={alt}
            loading="lazy"
            className={className}
            onError={() => setFailed(true)}
        />
    );
}

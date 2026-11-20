"use client";

import { useEffect, useRef } from "react";

/** 三个点的静止位置。点宽 5px，间距 11px，整体在 64×40 的胶囊里居中。 */
const REST_X = [18.5, 29.5, 40.5];

/** 合并时三点重叠的位置。 */
const MERGED_X = 29.5;

/** 点在胶囊里的纵向基准位置。 */
const DOT_TOP = 17.5;

/** 跳动弹簧：k 控制回弹速度，c 控制阻尼。 */
const HOP_STIFFNESS = 420;
const HOP_DAMPING = 14;

/**
 * 等待模型时的三个点：靠 SVG goo 滤镜让相邻的点在靠近时黏成水滴。
 * leaving 为真时三点收拢、放大并淡出，让位给下面的回复。
 * <p>模糊半径必须跟着点径走：5px 的点用 3.2 时中心 alpha 会掉到 0.3 以下，
 * 被 feColorMatrix 的 alpha*20-8 阈值整个抹掉，看起来就是空的胶囊。</p>
 */
export function GooThinking({ leaving = false }: { leaving?: boolean }) {
    const dotRefs = useRef<Array<HTMLSpanElement | null>>([]);
    const leavingRef = useRef(leaving);
    leavingRef.current = leaving;

    useEffect(() => {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const dots = REST_X.map((x, index) => ({ x, y: 0, v: 0, index }));
        let frame = 0;
        let last = performance.now();
        let hop = 0.3;
        let turn = 0;
        let scale = 1;
        const loop = (now: number) => {
            const dt = Math.min((now - last) / 1000, 1 / 30);
            last = now;
            if (leavingRef.current) {
                for (const dot of dots) dot.x += (MERGED_X - dot.x) * Math.min(1, dt * 14);
                scale += (1.8 - scale) * Math.min(1, dt * 12);
            } else if (!reduce && (hop -= dt) <= 0) {
                dots[turn % 3].v = -95;
                turn += 1;
                hop = turn % 3 ? 0.16 : 0.46;
            }
            for (const dot of dots) {
                dot.v += (-HOP_STIFFNESS * dot.y - HOP_DAMPING * dot.v) * dt;
                dot.y += dot.v * dt;
                const element = dotRefs.current[dot.index];
                if (element) {
                    element.style.transform = `translate(${dot.x.toFixed(2)}px,${(DOT_TOP + dot.y).toFixed(2)}px) scale(${scale.toFixed(3)})`;
                }
            }
            frame = requestAnimationFrame(loop);
        };
        frame = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(frame);
    }, []);

    return (
        <div className={`h-10 overflow-hidden transition-all duration-200 ease-out ${leaving ? "w-0 opacity-0" : "w-16 opacity-100"}`}>
            <div className="relative overflow-hidden rounded-[20px] bg-[color-mix(in_srgb,var(--studio-ink)_8%,transparent)]" style={{ width: 64, height: 40 }}>
                <svg aria-hidden="true" className="absolute size-0">
                    <filter id="drama-goo" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
                        <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8" />
                    </filter>
                </svg>
                <div className="absolute inset-0" style={{ filter: "url(#drama-goo)" }}>
                    {REST_X.map((_, index) => (
                        <span
                            key={index}
                            ref={(element) => { dotRefs.current[index] = element; }}
                            className="absolute left-0 top-0 block size-[5px] rounded-full bg-[var(--studio-text)]"
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}

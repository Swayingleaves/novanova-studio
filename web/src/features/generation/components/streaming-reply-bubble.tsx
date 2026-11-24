"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Spring = {
    x: number;
    v: number;
    t: number;
    k: number;
    c: number;
};

type TokenPiece = {
    kind: "word" | "space" | "break";
    value: string;
};

type AnimatedToken = {
    id: number;
    kind: "word" | "space" | "break";
    value: string;
    spring: Spring;
    revealed: boolean;
};

type StreamingReplyBubbleProps = {
    /** 当前展示的对话文本（支持实时流式增长）。 */
    text: string;
    /** 是否处于思考中阶段（无正文时展示扫光「思考中」胶囊）。 */
    thinking?: boolean;
    /** 思考胶囊文案，默认“思考中”。 */
    thinkingLabel?: string;
    /** 已有正文但后续步骤仍在执行时，在气泡文字末尾显示旋转加载指示器。 */
    loading?: boolean;
    /** 是否启用实时流式弹簧动效；历史轮次传 false 直接静态渲染。 */
    animated?: boolean;
    /** 气泡高度增长时的回调，便于外层保持滚动贴底。 */
    onHeightChange?: () => void;
    /** 可选：自定义气泡背景色（供画布主题透传）。 */
    bubbleBackground?: string;
    /** 可选：自定义正文颜色（供画布主题透传）。 */
    bubbleTextColor?: string;
    /** 可选：自定义边框色（供画布主题透传）。 */
    bubbleBorderColor?: string;
};

const PAD_X = 16;
const PAD_Y = 10;
const MIN_BUBBLE_HEIGHT = 44;
const SPRING_SETTLE_EPSILON = 0.002;
const SPRING_VELOCITY_EPSILON = 0.01;
const REVEAL_INTERVAL_NORMAL = 0.022;
const REVEAL_INTERVAL_FAST = 0.01;
const SUB_STEPS = 4;

/** 将流式文本切分为适合逐片显影的中英文词片与换行标记。 */
export function tokenizeStreamingText(input: string): TokenPiece[] {
    if (!input) {
        return [];
    }
    const pieces: TokenPiece[] = [];
    const pattern = /(\n)|([ \t]+)|([A-Za-z0-9_./:-]+)|([\u4e00-\u9fff]{1,2})|(.)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(input)) !== null) {
        if (match[1]) {
            pieces.push({ kind: "break", value: "\n" });
        } else if (match[2]) {
            pieces.push({ kind: "space", value: match[2] });
        } else {
            pieces.push({ kind: "word", value: match[0] });
        }
    }
    return pieces;
}

function createSpring(initial: number, k: number, c: number, reducedMotion: boolean): Spring {
    return {
        x: initial,
        v: 0,
        t: initial,
        k,
        c: reducedMotion ? 2 * Math.sqrt(k) : c,
    };
}

function stepSpring(spring: Spring, dt: number): void {
    const accel = -spring.k * (spring.x - spring.t) - spring.c * spring.v;
    spring.v += accel * dt;
    spring.x += spring.v * dt;
}

function isSettled(spring: Spring): boolean {
    return Math.abs(spring.x - spring.t) < SPRING_SETTLE_EPSILON && Math.abs(spring.v) < SPRING_VELOCITY_EPSILON;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

/**
 * 创作流式对话气泡：
 * - 思考阶段展示紧凑的扫光「思考中」胶囊；
 * - 正文流入时，气泡宽高按二阶弹簧平滑展开，新词片逐片模糊上浮显影；
 * - 历史轮次（animated=false）以同款气泡静态呈现 Markdown，避免刷新闪烁。
 */
export function StreamingReplyBubble({
    text,
    thinking = false,
    thinkingLabel = "思考中",
    loading = false,
    animated = false,
    onHeightChange,
    bubbleBackground,
    bubbleTextColor,
    bubbleBorderColor,
}: StreamingReplyBubbleProps) {
    const surfaceStyle = bubbleBackground || bubbleTextColor || bubbleBorderColor
        ? {
            ...(bubbleBackground ? { background: bubbleBackground } : {}),
            ...(bubbleTextColor ? { color: bubbleTextColor } : {}),
            ...(bubbleBorderColor ? { border: `1px solid ${bubbleBorderColor}` } : {}),
        }
        : undefined;

    if (!animated) {
        if (!text && !thinking) {
            return null;
        }
        const markdownText = text.replace(/\r\n/g, "\n").replace(/\n/g, "  \n");
        return (
            <div
                className="inline-block max-w-[min(100%,48rem)] rounded-[20px] bg-[color-mix(in_srgb,var(--studio-ink)_6%,var(--studio-panel-solid))] px-4 py-2.5 text-sm leading-6 text-[var(--studio-ink)]"
                style={surfaceStyle}
            >
                {text ? (
                    <div
                        className="prose prose-sm max-w-none break-words text-sm leading-6 text-[var(--studio-ink)] dark:prose-invert [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-1.5"
                        style={bubbleTextColor ? { color: bubbleTextColor } : undefined}
                    >
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdownText}</ReactMarkdown>
                    </div>
                ) : (
                    <span className="streaming-reply-think-shine font-medium">{thinkingLabel}</span>
                )}
            </div>
        );
    }

    return (
        <AnimatedStreamingReplyBubble
            text={text}
            thinking={thinking}
            thinkingLabel={thinkingLabel}
            loading={loading}
            onHeightChange={onHeightChange}
            surfaceStyle={surfaceStyle}
        />
    );
}

function AnimatedStreamingReplyBubble({
    text,
    thinking,
    thinkingLabel,
    loading,
    onHeightChange,
    surfaceStyle,
}: Required<Pick<StreamingReplyBubbleProps, "text" | "thinking" | "thinkingLabel" | "loading">> & {
    onHeightChange?: () => void;
    surfaceStyle?: React.CSSProperties;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const bubbleRef = useRef<HTMLDivElement>(null);
    const thinkRef = useRef<HTMLSpanElement>(null);
    const textLayerRef = useRef<HTMLDivElement>(null);
    const loadingRef = useRef<HTMLSpanElement>(null);
    const tokenElMapRef = useRef<Map<number, HTMLSpanElement>>(new Map());
    const onHeightChangeRef = useRef(onHeightChange);
    onHeightChangeRef.current = onHeightChange;

    const reducedMotionRef = useRef(
        typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );

    const [tokens, setTokens] = useState<AnimatedToken[]>(() => {
        if (!text) return [];
        const reduced = reducedMotionRef.current;
        return tokenizeStreamingText(text).map((piece, index) => ({
            id: index,
            ...piece,
            spring: createSpring(0, 340, 26, reduced),
            revealed: false,
        }));
    });
    const tokensRef = useRef<AnimatedToken[]>(tokens);
    tokensRef.current = tokens;
    const prevTextRef = useRef(text);
    const nextTokenIdRef = useRef(tokens.length);

    // 核心弹簧：气泡入场、宽高、思考文案透明度
    const springsRef = useRef<{
        entrance: Spring;
        width: Spring;
        height: Spring;
        thinkOpacity: Spring;
        initialized: boolean;
    }>({
        entrance: createSpring(0, 300, 22, reducedMotionRef.current),
        width: createSpring(88, 260, 26, reducedMotionRef.current),
        height: createSpring(MIN_BUBBLE_HEIGHT, 260, 26, reducedMotionRef.current),
        thinkOpacity: createSpring(text ? 0 : 1, 300, 30, reducedMotionRef.current),
        initialized: false,
    });

    const revealCooldownRef = useRef(0);
    const rafIdRef = useRef<number | null>(null);
    const lastFrameRef = useRef(0);
    const lastNotifiedHeightRef = useRef(MIN_BUBBLE_HEIGHT);
    const [layoutWidth, setLayoutWidth] = useState(640);
    const layoutWidthRef = useRef(layoutWidth);
    layoutWidthRef.current = layoutWidth;

    const getMaxBubbleWidth = () => {
        const containerWidth = containerRef.current?.clientWidth || 640;
        return Math.max(160, Math.min(containerWidth, 720));
    };

    const getThinkPillSize = () => {
        const thinkWidth = thinkRef.current?.offsetWidth || 48;
        const thinkHeight = thinkRef.current?.offsetHeight || 24;
        return {
            width: thinkWidth + PAD_X * 2,
            height: Math.max(MIN_BUBBLE_HEIGHT, thinkHeight + PAD_Y * 2),
        };
    };

    const updateTargetDimensions = () => {
        const s = springsRef.current;
        const currentTokens = tokensRef.current;
        const hasText = currentTokens.length > 0;
        if (!hasText) {
            const pill = getThinkPillSize();
            s.width.t = pill.width;
            s.height.t = pill.height;
            s.thinkOpacity.t = thinking ? 1 : 0;
            return;
        }
        s.thinkOpacity.t = 0;
        const maxWidth = getMaxBubbleWidth();
        let maxRight = 0;
        let maxBottom = 0;
        for (const token of currentTokens) {
            if (token.kind !== "word" || !token.revealed) {
                continue;
            }
            const el = tokenElMapRef.current.get(token.id);
            if (!el) continue;
            maxRight = Math.max(maxRight, el.offsetLeft + el.offsetWidth);
            maxBottom = Math.max(maxBottom, el.offsetTop + el.offsetHeight);
        }
        // 正文尾部附带加载指示器时，将其尺寸一并计入气泡目标宽高，避免贴边截断
        const loader = loading ? loadingRef.current : null;
        if (loader && maxRight > 0) {
            maxRight = Math.max(maxRight, loader.offsetLeft + loader.offsetWidth);
            maxBottom = Math.max(maxBottom, loader.offsetTop + loader.offsetHeight);
        }
        const pill = getThinkPillSize();
        const targetWidth = maxRight > 0 ? Math.min(maxWidth, Math.max(pill.width, maxRight + PAD_X * 2 + 2)) : maxWidth;
        const targetHeight = maxBottom > 0 ? Math.max(MIN_BUBBLE_HEIGHT, maxBottom + PAD_Y * 2) : pill.height;
        s.width.t = targetWidth;
        s.height.t = targetHeight;
    };

    const scheduleLoop = () => {
        if (rafIdRef.current !== null) {
            return;
        }
        lastFrameRef.current = performance.now();
        const tick = (now: number) => {
            const dt = Math.min((now - lastFrameRef.current) / 1000, 1 / 30);
            lastFrameRef.current = now;

            const s = springsRef.current;
            const currentTokens = tokensRef.current;

            // 按柔和节拍依次激活未显影词片；积压较多时自动提速，避免长文本滞后
            const pendingCount = currentTokens.reduce((count, token) => (token.kind === "word" && !token.revealed ? count + 1 : count), 0);
            if (pendingCount > 0) {
                revealCooldownRef.current -= dt;
                if (revealCooldownRef.current <= 0) {
                    const batchSize = pendingCount > 30 ? 3 : pendingCount > 15 ? 2 : 1;
                    let revealedAny = false;
                    for (let i = 0; i < batchSize; i++) {
                        const nextToken = currentTokens.find((token) => token.kind === "word" && !token.revealed);
                        if (!nextToken) break;
                        nextToken.revealed = true;
                        nextToken.spring.t = 1;
                        revealedAny = true;
                    }
                    if (revealedAny) {
                        updateTargetDimensions();
                    }
                    revealCooldownRef.current = pendingCount > 10 ? REVEAL_INTERVAL_FAST : REVEAL_INTERVAL_NORMAL;
                }
            }

            // 物理子步推进
            const subDt = dt / SUB_STEPS;
            for (let stepIndex = 0; stepIndex < SUB_STEPS; stepIndex++) {
                stepSpring(s.entrance, subDt);
                stepSpring(s.width, subDt);
                stepSpring(s.height, subDt);
                stepSpring(s.thinkOpacity, subDt);
                for (const token of currentTokens) {
                    if (token.kind === "word" && token.revealed) {
                        stepSpring(token.spring, subDt);
                    }
                }
            }

            // 直接写 DOM 样式，避免每帧触发 React 重渲染
            const bubbleEl = bubbleRef.current;
            if (bubbleEl) {
                bubbleEl.style.opacity = clamp(s.entrance.x, 0, 1).toFixed(3);
                bubbleEl.style.transform = `translateY(${((1 - s.entrance.x) * 14).toFixed(2)}px)`;
                bubbleEl.style.width = `${Math.max(40, s.width.x).toFixed(2)}px`;
                bubbleEl.style.height = `${Math.max(MIN_BUBBLE_HEIGHT, s.height.x).toFixed(2)}px`;
            }
            const thinkEl = thinkRef.current;
            if (thinkEl) {
                thinkEl.style.opacity = clamp(s.thinkOpacity.x, 0, 1).toFixed(3);
            }
            let anyTokenActive = pendingCount > 0;
            for (const token of currentTokens) {
                if (token.kind !== "word" || !token.revealed) {
                    continue;
                }
                const el = tokenElMapRef.current.get(token.id);
                if (el) {
                    const v = clamp(token.spring.x, 0, 1.2);
                    el.style.opacity = clamp(v, 0, 1).toFixed(3);
                    el.style.transform = `translateY(${((1 - token.spring.x) * 6).toFixed(2)}px)`;
                    el.style.filter = v < 0.98 ? `blur(${((1 - clamp(v, 0, 1)) * 4).toFixed(2)}px)` : "none";
                }
                if (!isSettled(token.spring)) {
                    anyTokenActive = true;
                }
            }

            if (Math.abs(s.height.x - lastNotifiedHeightRef.current) > 8) {
                lastNotifiedHeightRef.current = s.height.x;
                onHeightChangeRef.current?.();
            }

            const stillRunning = anyTokenActive
                || !isSettled(s.entrance)
                || !isSettled(s.width)
                || !isSettled(s.height)
                || !isSettled(s.thinkOpacity);

            if (stillRunning) {
                rafIdRef.current = requestAnimationFrame(tick);
            } else {
                rafIdRef.current = null;
                onHeightChangeRef.current?.();
            }
        };
        rafIdRef.current = requestAnimationFrame(tick);
    };

    // 监听外层宽度变化，保持内部文本排版宽度与容器同步
    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const syncWidth = () => {
            const nextWidth = Math.max(160, Math.min(container.clientWidth || 640, 720));
            if (nextWidth !== layoutWidthRef.current) {
                setLayoutWidth(nextWidth);
            }
            updateTargetDimensions();
            scheduleLoop();
        };
        syncWidth();
        const observer = new ResizeObserver(syncWidth);
        observer.observe(container);
        return () => observer.disconnect();
    }, []);

    // 首次挂载时按“思考中”胶囊尺寸初始化，并启动入场弹簧
    useLayoutEffect(() => {
        const s = springsRef.current;
        if (!s.initialized) {
            const pill = getThinkPillSize();
            s.width.x = s.width.t = pill.width;
            s.height.x = s.height.t = pill.height;
            s.entrance.x = 0;
            s.entrance.t = 1;
            s.initialized = true;
        }
        updateTargetDimensions();
        scheduleLoop();
    }, [thinking, thinkingLabel]);

    // 流式文本增量追加词片，避免已有词片重播动效
    useEffect(() => {
        const prev = prevTextRef.current;
        if (text === prev) {
            updateTargetDimensions();
            scheduleLoop();
            return;
        }
        prevTextRef.current = text;
        const reduced = reducedMotionRef.current;
        if (text.startsWith(prev)) {
            const delta = text.slice(prev.length);
            const appended = tokenizeStreamingText(delta).map((piece) => ({
                id: nextTokenIdRef.current++,
                ...piece,
                spring: createSpring(0, 340, 26, reduced),
                revealed: false,
            }));
            if (appended.length) {
                setTokens((current) => [...current, ...appended]);
            }
        } else {
            // 文本被整体替换时重新构建词片（如切换轮次）
            const rebuilt = tokenizeStreamingText(text).map((piece) => ({
                id: nextTokenIdRef.current++,
                ...piece,
                spring: createSpring(0, 340, 26, reduced),
                revealed: false,
            }));
            setTokens(rebuilt);
        }
    }, [text]);

    // tokens 更新后刷新目标尺寸并唤醒动画循环
    useLayoutEffect(() => {
        updateTargetDimensions();
        scheduleLoop();
    }, [tokens, layoutWidth, loading]);

    useEffect(() => () => {
        if (rafIdRef.current !== null) {
            cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = null;
        }
    }, []);

    return (
        <div ref={containerRef} className="w-full max-w-3xl" aria-live="polite">
            <div
                ref={bubbleRef}
                className="relative overflow-hidden rounded-[20px] bg-[color-mix(in_srgb,var(--studio-ink)_6%,var(--studio-panel-solid))] text-sm leading-6 text-[var(--studio-ink)] will-change-[transform,opacity]"
                style={{ minHeight: MIN_BUBBLE_HEIGHT, ...surfaceStyle }}
            >
                <span
                    ref={thinkRef}
                    className="streaming-reply-think-shine pointer-events-none absolute whitespace-nowrap font-medium"
                    style={{ left: PAD_X, top: PAD_Y }}
                >
                    {thinkingLabel}
                </span>
                <div
                    ref={textLayerRef}
                    className="absolute break-words"
                    style={{
                        left: PAD_X,
                        top: PAD_Y,
                        width: Math.max(120, layoutWidth - PAD_X * 2),
                    }}
                >
                    {tokens.map((token) => {
                        if (token.kind === "break") {
                            return <br key={token.id} />;
                        }
                        if (token.kind === "space") {
                            return <span key={token.id}>{token.value}</span>;
                        }
                        return (
                            <span
                                key={token.id}
                                ref={(el) => {
                                    if (el) tokenElMapRef.current.set(token.id, el);
                                    else tokenElMapRef.current.delete(token.id);
                                }}
                                className="inline-block will-change-[transform,opacity,filter]"
                                style={{ opacity: 0 }}
                            >
                                {token.value}
                            </span>
                        );
                    })}
                    {loading && tokens.length > 0 ? (
                        <span
                            ref={loadingRef}
                            role="status"
                            aria-label="加载中"
                            className="ml-1.5 inline-flex align-middle text-[var(--studio-muted)]"
                        >
                            <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                        </span>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

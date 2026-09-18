"use client";

import { useServerInsertedHTML } from "next/navigation";

import { buildThemeBootstrapScript, type ThemePreference } from "@/shared/lib/theme-preference";

/**
 * 在 SSR 流中注入首屏主题脚本。
 * <p>
 * 必须用 `useServerInsertedHTML` 注入到 React 组件树之外：React 19 会警告并拒绝执行由组件渲染的 `<script>`，
 * 无论是 `next/script`（含 `beforeInteractive`）还是 layout 里的原生 `<script>` 都会触发
 * 「Encountered a script tag while rendering React component」。注入到 SSR 流后脚本仍在首屏 HTML 中、
 * 仍在 hydration 前执行，因此防闪烁效果不变。
 *
 * @param props preference 服务端从 Cookie 读出的主题偏好
 * @return null 不产生任何客户端 DOM
 */
export function ThemeScript({ preference }: { preference: ThemePreference }) {
    useServerInsertedHTML(() => (
        <script id="theme-script" dangerouslySetInnerHTML={{ __html: buildThemeBootstrapScript(preference) }} />
    ));

    return null;
}

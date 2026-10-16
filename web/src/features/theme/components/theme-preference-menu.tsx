"use client";
import { translateMessage as translate } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";


import type { MenuProps } from "antd";
import { Dropdown } from "antd";
import { Check, SunMoon } from "lucide-react";

import { useThemeStore } from "@/features/theme/stores/use-theme-store";
import { cn } from "@/shared/lib/utils";
import { THEME_PREFERENCES, type ThemePreference } from "@/shared/lib/theme-preference";

type ThemePreferenceMenuProps = {
    variant?: "icon" | "drawer" | "toolbar";
    className?: string;
    onAfterSelect?: () => void;
};

const createThemeLabels = (translator: typeof translate = translate): Record<ThemePreference, string> => ({
    get system() { return translator("theme.system"); },
    get light() { return translator("theme.lightMode"); },
    get dark() { return translator("theme.darkMode"); },
    get purple() { return translator("theme.purpleMode"); },
});

const createResolvedThemeLabels = (translator: typeof translate = translate) => ({
    get light() { return translator("theme.light"); },
    get dark() { return translator("theme.dark"); },
    get purple() { return translator("theme.purple"); },
} as const);

/**
 * 全局主题偏好切换菜单。
 *
 * @param props ThemePreferenceMenuProps 渲染形态与回调
 * @return JSX.Element
 */
export function ThemePreferenceMenu({ variant = "icon", className, onAfterSelect }: ThemePreferenceMenuProps) {
    const translate = useTranslation();
    const preference = useThemeStore((state) => state.preference);
    const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
    const setThemePreference = useThemeStore((state) => state.setThemePreference);

    const items: MenuProps["items"] = THEME_PREFERENCES.map((item) => ({
        key: item,
        icon: preference === item ? <Check className="size-4" /> : <span className="block size-4" aria-hidden="true" />,
        label: (
            <div className="flex min-w-40 items-center justify-between gap-3">
                <span>{createThemeLabels(translate)[item]}</span>
                {item === "system" && preference === "system" ? <span className="text-xs text-[var(--studio-faint)]">{translate("theme.current")}{createResolvedThemeLabels(translate)[resolvedTheme]}</span> : null}
            </div>
        ),
    }));

    return (
        <Dropdown
            trigger={["click"]}
            placement={variant === "icon" ? "topLeft" : "bottomRight"}
            arrow={false}
            menu={{
                items,
                onClick: ({ key }) => {
                    setThemePreference(key as ThemePreference);
                    onAfterSelect?.();
                },
            }}
        >
            {variant === "drawer" ? (
                <button
                    type="button"
                    className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel)] px-3 py-3 text-left transition hover:bg-[var(--studio-glass-strong)]",
                        className,
                    )}
                    aria-label={translate("theme.changeTheme")}
                    title={translate("theme.changeTheme")}
                >
                    <span className="flex items-center gap-3">
                        <span className="inline-flex size-9 items-center justify-center rounded-lg bg-[var(--studio-primary-soft)] text-[var(--studio-ink)]">
                            <SunMoon className="size-4.5" />
                        </span>
                        <span>
                            <span className="block text-sm font-medium text-[var(--studio-ink)]">{translate("theme.theme")}</span>
                            <span className="block text-xs text-[var(--studio-faint)]">
                                {preference === "system" ? translate("theme.systemCurrently", { value0: createResolvedThemeLabels(translate)[resolvedTheme] }) : createThemeLabels(translate)[preference]}
                            </span>
                        </span>
                    </span>
                    <span className="text-xs text-[var(--studio-muted)]">{translate("theme.switch")}</span>
                </button>
            ) : (
                <button
                    type="button"
                    className={cn(
                        variant === "toolbar"
                            ? "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-[var(--studio-ink)] transition-colors hover:bg-[var(--studio-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--studio-action)] motion-reduce:transition-none [&_svg]:size-4"
                            : "sidebar-rail-action sidebar-rail-action-emphasis",
                        className,
                    )}
                    aria-label={translate("theme.changeTheme")}
                    title={translate("theme.changeTheme")}
                >
                    <SunMoon className="size-4.5" />
                </button>
            )}
        </Dropdown>
    );
}

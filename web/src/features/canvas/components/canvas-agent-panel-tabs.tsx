import type { ReactNode } from "react";

import { canvasThemes } from "@/shared/lib/canvas-theme";

type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];

export function AgentPanelTabs<T extends string>({ value, items, theme, right, onChange }: { value: T; items: { value: T; label: string; icon?: ReactNode; count?: number }[]; theme: CanvasTheme; right?: ReactNode; onChange: (value: T) => void }) {
    return (
        <header className="flex min-h-11 items-center gap-3 border-b px-3" style={{ borderColor: theme.node.stroke }}>
            <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto" role="tablist" aria-label="Agent 面板">
                {items.map((item) => {
                    const selected = item.value === value;
                    return <button key={item.value} type="button" role="tab" aria-selected={selected} className="inline-flex h-11 shrink-0 items-center gap-1.5 border-b-2 px-2 text-sm" style={{ borderColor: selected ? theme.node.text : "transparent", color: selected ? theme.node.text : theme.node.muted }} onClick={() => onChange(item.value)}>{item.icon}<span>{item.label}</span>{item.count ? <span>{item.count}</span> : null}</button>;
                })}
            </div>
            {right ? <div className="shrink-0">{right}</div> : null}
        </header>
    );
}

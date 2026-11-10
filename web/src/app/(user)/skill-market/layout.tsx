import type { ReactNode } from "react";

export default function SkillMarketLayout({ children }: { children: ReactNode }) {
    return <div className="studio-page h-full min-h-0 overflow-y-auto">{children}</div>;
}

import { readReferenceInstructions } from "../lib/prompt-references";
import type { ComicDramaPromptVersion } from "../types";

/** 展示系统图片说明，正文编辑与系统编号分离。 */
export function PromptReferenceInstructions({ version }: { version?: ComicDramaPromptVersion | null }) {
    const instructions = readReferenceInstructions(version);
    if (!instructions) return null;
    return (
        <section aria-label="参考图片说明（系统维护，只读）" className="mt-3 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface)] p-3 text-sm text-[var(--studio-text)]">
            <p className="mb-2 text-xs text-[var(--studio-muted)]">系统维护，只读；参考图片变化后请重新生成最终提示词。</p>
            <p className="whitespace-pre-wrap break-words">{instructions}</p>
        </section>
    );
}

"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function DocsCopyButton({ code }: { code: string }) {
    const [copied, setCopied] = useState(false);
    return <button type="button" className="docs-copy-button" aria-label="复制代码" onClick={() => void navigator.clipboard.writeText(code).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); })}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />}</button>;
}

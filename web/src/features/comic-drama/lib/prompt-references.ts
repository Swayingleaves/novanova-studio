import type { ComicDramaPromptVersion } from "../types";

/** 读取可编辑正文，旧版本保留原有文本。 */
export function readPromptBody(version?: ComicDramaPromptVersion | null): string {
    const body = version?.sourceSnapshot?.promptBody;
    return typeof body === "string" ? body : version?.prompt || "";
}

/** 读取由系统维护的参考图片说明。 */
export function readReferenceInstructions(version?: ComicDramaPromptVersion | null): string {
    const instructions = version?.sourceSnapshot?.referenceInstructions;
    return typeof instructions === "string" ? instructions : "";
}

/** 复制时合并当前正文与来源版本的系统说明。 */
export function fullPromptWithBody(body: string, version?: ComicDramaPromptVersion | null): string {
    const instructions = readReferenceInstructions(version);
    return body.trim() + (instructions ? `\n\n${instructions}` : "");
}

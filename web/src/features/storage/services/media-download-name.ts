export type DownloadableMediaKind = "img" | "video";

export function createMediaDownloadFileName(kind: DownloadableMediaKind, extension?: string, date = new Date()): string {
    const timestamp = [
        date.getFullYear().toString().padStart(4, "0"),
        (date.getMonth() + 1).toString().padStart(2, "0"),
        date.getDate().toString().padStart(2, "0"),
        date.getHours().toString().padStart(2, "0"),
        date.getMinutes().toString().padStart(2, "0"),
        date.getSeconds().toString().padStart(2, "0"),
    ].join("");
    const suffix = extension ? `.${extension.replace(/^\./, "")}` : "";
    return `novanovastudio-${kind}-${timestamp}${suffix}`;
}

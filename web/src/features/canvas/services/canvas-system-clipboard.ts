type ClipboardItemReader = {
    types: readonly string[];
    getType(type: string): Promise<Blob>;
};

type CanvasClipboardReader = {
    read(): Promise<readonly ClipboardItemReader[]>;
    readText(): Promise<string>;
};

export type CanvasSystemClipboardContent =
    | { kind: "image"; file: File }
    | { kind: "text"; text: string };

export async function readCanvasSystemClipboard(reader: CanvasClipboardReader): Promise<CanvasSystemClipboardContent> {
    const clipboardItems = await reader.read();
    for (const item of clipboardItems) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType) continue;
        const imageBlob = await item.getType(imageType);
        return { kind: "image", file: new File([imageBlob], "clipboard-image.png", { type: imageType }) };
    }
    return { kind: "text", text: await reader.readText() };
}

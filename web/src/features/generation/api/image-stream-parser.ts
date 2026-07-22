type StreamResult = {
    content: string;
    payload?: Record<string, unknown>;
};

export type ResponseEventStreamParser = {
    push: (chunk: string) => void;
    finish: () => StreamResult;
};

export function createResponseEventStreamParser(onDelta?: (text: string) => void): ResponseEventStreamParser {
    let buffer = "";
    let content = "";
    let payload: Record<string, unknown> | undefined;
    let errorMessage = "";

    const consumeBlock = (block: string) => {
        const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n").trim();
        if (!data || data === "[DONE]") return;
        const event = JSON.parse(data) as Record<string, unknown>;
        const error = readEventError(event);
        if (error) errorMessage = error;
        if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
            content += event.delta;
            onDelta?.(content);
        } else if (event.type === "response.output_text.done" && !content && typeof event.text === "string") {
            content = event.text;
            onDelta?.(content);
        }
        if (event.type === "response.completed" && isRecord(event.response)) payload = event.response;
        else if (Array.isArray(event.output)) payload = event;
    };
    const consumeAvailableBlocks = (flush: boolean) => {
        for (;;) {
            const boundary = buffer.match(/\r?\n\r?\n/);
            if (!boundary?.index && boundary?.index !== 0) break;
            consumeBlock(buffer.slice(0, boundary.index));
            buffer = buffer.slice(boundary.index + boundary[0].length);
        }
        if (flush && buffer.trim()) {
            consumeBlock(buffer);
            buffer = "";
        }
        if (errorMessage) throw new Error(errorMessage);
    };
    return {
        push(chunk) {
            buffer += chunk;
            consumeAvailableBlocks(false);
        },
        finish() {
            consumeAvailableBlocks(true);
            return { content, payload };
        },
    };
}

function readEventError(event: Record<string, unknown>): string {
    if (typeof event.msg === "string") return event.msg;
    if (isRecord(event.error) && typeof event.error.message === "string") return event.error.message;
    return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

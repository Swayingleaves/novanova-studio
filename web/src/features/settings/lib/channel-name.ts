const DEFAULT_CHANNEL_NAME = "未命名渠道";

export function normalizeChannelName(name: string | undefined): string {
    return name === undefined ? DEFAULT_CHANNEL_NAME : name.trim();
}

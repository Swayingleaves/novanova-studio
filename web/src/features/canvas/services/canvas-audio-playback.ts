let playingMedia: HTMLMediaElement | null = null;

/** 切换当前播放器，保证节点与引用预览不会同时播放。 */
export function activateCanvasAudio(audio: HTMLMediaElement): void {
    if (playingMedia && playingMedia !== audio) playingMedia.pause();
    playingMedia = audio;
}

/** 停止当前播放器，切换画布时调用。 */
export function stopCanvasAudio(): void {
    playingMedia?.pause();
    playingMedia = null;
}

/** 释放节点持有的播放器引用。 */
export function releaseCanvasAudio(audio: HTMLMediaElement): void {
    audio.pause();
    if (playingMedia === audio) playingMedia = null;
}

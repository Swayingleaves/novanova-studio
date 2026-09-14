let playingAudio: HTMLAudioElement | null = null;

/** 切换当前播放的音频，保证节点与引用预览不会同时发声。 */
export function activateCanvasAudio(audio: HTMLAudioElement): void {
    if (playingAudio && playingAudio !== audio) playingAudio.pause();
    playingAudio = audio;
}

/** 停止当前音频，切换画布时调用。 */
export function stopCanvasAudio(): void {
    playingAudio?.pause();
    playingAudio = null;
}

/** 释放节点持有的播放器引用。 */
export function releaseCanvasAudio(audio: HTMLAudioElement): void {
    audio.pause();
    if (playingAudio === audio) playingAudio = null;
}

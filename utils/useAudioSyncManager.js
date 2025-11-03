import { useRef } from "react";

export function useAudioSyncManager() {
  const audioElementsRef = useRef(new Map());
  const syncTolerance = 0.1;

  const createAudioElement = (clipId, url) => {
    const audioElements = audioElementsRef.current;
    if (audioElements.has(clipId)) return audioElements.get(clipId);

    const audio = new Audio();
    audio.preload = "auto";
    audio.crossOrigin = "anonymous";
    audio.src = url;

    const elementData = {
      audio,
      clipId,
      url,
      isActive: false,
      lastSyncTime: 0,
      syncOffset: 0,
    };

    audioElements.set(clipId, elementData);
    return elementData;
  };

  const syncAudio = (clipId, timelineTime, isPlaying, clipStartTime, clipTrimStart) => {
    const audioElements = audioElementsRef.current;
    const elementData = audioElements.get(clipId);
    if (!elementData) return;

    const { audio } = elementData;
    const relativeTime = Math.max(0, timelineTime - clipStartTime + clipTrimStart);
    const isActive = timelineTime >= clipStartTime && timelineTime < clipStartTime + audio.duration;

    elementData.isActive = isActive;

    if (isActive) {
      const desiredTime = relativeTime;
      const currentTime = audio.currentTime;
      const timeDiff = Math.abs(desiredTime - currentTime);

      if (timeDiff > syncTolerance) {
        audio.currentTime = Math.max(0, Math.min(desiredTime, audio.duration - 0.1));
        elementData.lastSyncTime = timelineTime;
      }

      if (isPlaying && audio.paused) {
        audio.play().catch((e) => console.warn(`Audio play failed for clip ${clipId}:`, e));
      } else if (!isPlaying && !audio.paused) {
        audio.pause();
      }
    } else {
      if (!audio.paused) audio.pause();
    }
  };

  const cleanupClips = (activeClipIds) => {
    const audioElements = audioElementsRef.current;
    for (const [clipId, elementData] of audioElements.entries()) {
      if (!activeClipIds.has(clipId)) {
        elementData.audio.pause();
        elementData.audio.src = "";
        audioElements.delete(clipId);
      }
    }
  };

  const getActiveAudioClips = (clips, timelineTime) => {
    return clips.filter(
      (clip) =>
        clip.type === "audio" &&
        timelineTime >= clip.startTime &&
        timelineTime < clip.endTime
    );
  };

  const stopAll = () => {
    const audioElements = audioElementsRef.current;
    audioElements.forEach(({ audio }) => {
      if (!audio.paused) audio.pause();
    });
  };

  return {
    createAudioElement,
    syncAudio,
    cleanupClips,
    getActiveAudioClips,
    stopAll,
  };
}

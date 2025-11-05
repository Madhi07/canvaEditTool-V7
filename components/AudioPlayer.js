// components/AudioPlayer.js
import React, { useEffect, useRef, forwardRef, useImperativeHandle } from "react";

const SYNC_TOLERANCE = 0.05;               // For discrete seek corrections
const DRIFT_CORRECT_WHILE_PLAYING = 0.25;  // Correct only if >= 250ms during continuous play

function computeVisibleLen(clip) {
  const dur = Math.max(0, Number(clip.duration) || 0);
  const ts = Math.max(0, Number(clip.trimStart) || 0);
  const te = Math.max(0, Number(clip.trimEnd) || 0);
  return Math.max(0, dur - ts - te);
}

function isInsideWindow(clip, t) {
  const visibleLen = computeVisibleLen(clip);
  const end = (clip.endTime ?? (clip.startTime + visibleLen));
  return t >= clip.startTime && t < end && visibleLen > 0;
}

function desiredAssetOffset(clip, timelineTime) {
  // offset inside the asset = trimStart + (timeline - clip.start)
  const visibleLen = computeVisibleLen(clip);
  const local = timelineTime - clip.startTime;
  const target = (clip.trimStart || 0) + local;
  // clamp to last frame inside trimmed region
  return Math.max(0, Math.min(target, (clip.trimStart || 0) + visibleLen - 0.001));
}

const AudioPlayer = forwardRef(function AudioPlayer(
  {
    clips,                 // full list of clips
    currentTime,           // global timeline time (sec)
    isPlaying,             // transport play/pause
    seekAudio,             // bump when user performs a discrete seek/jump
    masterVolume = 1,      // optional
    activeVisualType,      // 'image' | 'video' | undefined  <-- NEW
  },
  ref
) {
  const audioMapRef = useRef(new Map()); // id -> { audio }
  const lastSeekAudioRef = useRef(seekAudio);
  const prevInsideMapRef = useRef(new Map()); // clipId -> wasInside(Boolean)
  const lastBigCorrectionAtRef = useRef(0);

  // Expose imperative controls
  useImperativeHandle(ref, () => ({
    stopAll() {
      const map = audioMapRef.current;
      for (const { audio } of map.values()) {
        try { audio.pause(); } catch {}
      }
    },
    setMasterVolume(v) {
      const vol = Math.max(0, Math.min(1, v));
      const map = audioMapRef.current;
      for (const { audio } of map.values()) {
        audio.volume = vol * (audio.__clipGain ?? 1);
      }
    }
  }), []);

  // Ensure audio elements exist for every audio clip and keep them updated
  useEffect(() => {
    if (!clips?.length) return;
    const map = audioMapRef.current;

    for (const clip of clips) {
      if (clip.type !== "audio") continue;

      const clipGain = (clip.gain != null ? clip.gain : 1);

      if (!map.has(clip.id)) {
        const el = new Audio();
        el.preload = "auto";
        el.crossOrigin = "anonymous";
        el.src = clip.url;
        el.__clipGain = clipGain;
        el.volume = clipGain * masterVolume;
        map.set(clip.id, { audio: el });
      } else {
        const entry = map.get(clip.id);
        const el = entry.audio;
        el.__clipGain = clipGain;
        el.volume = clipGain * masterVolume;
        if (el.src !== clip.url) {
          try { el.pause(); } catch {}
          el.src = clip.url;
        }
      }
    }

    // remove elements for deleted audio clips
    for (const [id, entry] of map.entries()) {
      const stillExists = clips.some(c => c.type === "audio" && c.id === id);
      if (!stillExists) {
        try { entry.audio.pause(); } catch {}
        entry.audio.src = "";
        map.delete(id);
        prevInsideMapRef.current.delete(id);
      }
    }
  }, [clips, masterVolume]);

  // Core sync: on play/pause/seek/time change, align every audio element
  useEffect(() => {
    const map = audioMapRef.current;
    if (!clips) return;

    const isDiscreteSeek = lastSeekAudioRef.current !== seekAudio;
    if (isDiscreteSeek) lastSeekAudioRef.current = seekAudio;

    // During image playback, avoid continuous drift corrections (step-wise timer)
    const allowContinuousCorrection = isPlaying && activeVisualType !== 'image';

    const audioClips = clips.filter(c => c.type === "audio");

    for (const clip of audioClips) {
      const entry = map.get(clip.id);
      if (!entry) continue;
      const el = entry.audio;

      const inside = isInsideWindow(clip, currentTime);
      const wasInside = prevInsideMapRef.current.get(clip.id) === true;

      if (!inside) {
        if (!el.paused) el.pause();
        prevInsideMapRef.current.set(clip.id, false);
        continue;
      }

      // Compute desired offset for this time
      const target = desiredAssetOffset(clip, currentTime);
      const drift = Math.abs((el.currentTime || 0) - target);

      const doSeekAndMaybePlay = () => {
        const now = performance.now();
        const entering = !wasInside && inside; // just entered this clip window
        const bigDrift = allowContinuousCorrection &&
                         drift >= DRIFT_CORRECT_WHILE_PLAYING &&
                         (now - lastBigCorrectionAtRef.current > 200);

        // Only hard-seek when it really matters to avoid crackle:
        //  - explicit user seek (seekAudio bump)
        //  - entering the clip window
        //  - large drift during continuous playback (when visual is NOT an image)
        if (isDiscreteSeek || entering || bigDrift) {
          const safeTarget = Math.max(
            0,
            Math.min(target, Math.max(0, (el.duration || target) - 0.001))
          );
          el.currentTime = safeTarget;
          if (bigDrift) lastBigCorrectionAtRef.current = now;
        }

        if (isPlaying) {
          if (el.paused) {
            el.play().catch(() => {});
          }
        } else {
          if (!el.paused) el.pause();
        }
      };

      if (el.readyState >= 1 && Number.isFinite(el.duration || 0)) {
        doSeekAndMaybePlay();
      } else {
        const onLoaded = () => {
          el.removeEventListener("loadedmetadata", onLoaded);
          doSeekAndMaybePlay();
        };
        el.addEventListener("loadedmetadata", onLoaded, { once: true });
      }

      prevInsideMapRef.current.set(clip.id, true);
    }

    // Safety: pause any non-window clip that might still be playing
    for (const [id, entry] of map.entries()) {
      const clip = audioClips.find(c => c.id === id);
      if (!clip) continue;
      if (!isInsideWindow(clip, currentTime) && !entry.audio.paused) {
        entry.audio.pause();
      }
    }
  }, [clips, currentTime, isPlaying, seekAudio, activeVisualType]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const map = audioMapRef.current;
      for (const { audio } of map.values()) {
        try { audio.pause(); } catch {}
        audio.src = "";
      }
      map.clear();
      prevInsideMapRef.current.clear();
    };
  }, []);

  return null; // headless controller (no UI)
});

export default AudioPlayer;

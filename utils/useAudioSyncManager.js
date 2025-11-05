import { useRef } from "react";

export function useAudioSyncManager() {
  const audioElementsRef = useRef(new Map());
  const syncTolerance = 0.05; // tighter seek on jumps

  function ensureElement(clipId, url) {
    const map = audioElementsRef.current;
    if (map.has(clipId)) return map.get(clipId);

    const audio = new Audio();
    audio.preload = "auto";
    audio.crossOrigin = "anonymous";
    audio.src = url;

    const entry = {
      audio,
      clipId,
      url,
      isActive: false,
      lastSyncTimeline: 0
    };

    map.set(clipId, entry);
    return entry;
  }

  /**
   * Sync a single audio clip to the global playhead.
   * @param {object} params
   *  - clipId         : string
   *  - url            : string
   *  - timelineTime   : number (sec)
   *  - isPlaying      : boolean
   *  - clipStartTime  : number (sec on timeline)
   *  - clipEndTime    : number (sec on timeline)  <-- REQUIRED
   *  - trimStart      : number (sec inside asset)
   *  - trimEnd        : number (sec inside asset)
   *  - assetDuration  : number (sec of the media file)
   */
  const syncAudio = (params) => {
    const {
      clipId,
      url,
      timelineTime,
      isPlaying,
      clipStartTime,
      clipEndTime,
      trimStart = 0,
      trimEnd = 0,
      assetDuration
    } = params;

    // create or fetch element
    const entry = ensureElement(clipId, url);
    const { audio } = entry;

    // visible length of this clip on timeline
    const safeAssetDur = Number.isFinite(assetDuration) ? assetDuration : audio.duration || 0;
    const visibleLen = Math.max(0, safeAssetDur - Math.max(0, trimStart) - Math.max(0, trimEnd));
    const clipWindowStart = clipStartTime;
    const clipWindowEnd = Math.min(clipEndTime ?? (clipStartTime + visibleLen), Infinity);

    // Is the playhead inside this clip's timeline window?
    const inside =
      timelineTime >= clipWindowStart &&
      timelineTime < clipWindowEnd &&
      visibleLen > 0;

    entry.isActive = inside;

    if (!inside) {
      // Outside this clip → make sure it's paused
      if (!audio.paused) audio.pause();
      return;
    }

    // Compute where we should be inside the asset
    const local = timelineTime - clipWindowStart;               // seconds inside this clip window
    const desiredOffset = Math.min(trimStart + local, trimStart + visibleLen - 0.001);
    const clampedOffset = Math.max(0, Math.min(desiredOffset, Math.max(0, safeAssetDur - 0.001)));

    // Seek if drifted
    const drift = Math.abs((audio.currentTime || 0) - clampedOffset);
    if (drift > syncTolerance) {
      // Some browsers reject seeks beyond duration if metadata not loaded yet.
      // Guard by waiting for readyState when needed.
      const seekNow = () => {
        audio.currentTime = clampedOffset;
      };
      if (audio.readyState < 1) {
        const onLoaded = () => {
          audio.removeEventListener("loadedmetadata", onLoaded);
          seekNow();
          if (isPlaying) audio.play().catch(() => {});
        };
        audio.addEventListener("loadedmetadata", onLoaded);
      } else {
        seekNow();
      }
    }

    // Play / pause according to transport
    if (isPlaying) {
      if (audio.paused) {
        audio.play().catch((e) => {
          // eslint-disable-next-line no-console
          console.warn(`Audio play failed for clip ${clipId}:`, e);
        });
      }
    } else {
      if (!audio.paused) audio.pause();
    }

    // If we happen to run past this clip's window (e.g., continuous timeupdate),
    // stop it immediately. Caller should call syncAudio on every tick/seek.
    if (audio.currentTime > trimStart + visibleLen) {
      audio.pause();
    }

    entry.lastSyncTimeline = timelineTime;
  };

  /**
   * Optional helper: run sync for a set of clips and ensure only the active one plays.
   * @param {Array} clips - list of audio clips with fields:
   *   { id, url, startTime, endTime, trimStart, trimEnd, duration }
   * @param {number} timelineTime
   * @param {boolean} isPlaying
   */
  const syncAll = (clips, timelineTime, isPlaying) => {
    const activeSet = new Set();

    // Determine which audio clip (if any) should be audible now.
    // If you allow overlaps, pick the top-most/selected one here.
    const activeClip =
      clips
        .filter(c => {
          const safeDur = c.duration ?? 0;
          const visLen = Math.max(0, safeDur - (c.trimStart || 0) - (c.trimEnd || 0));
          const endTime = (c.endTime != null) ? c.endTime : (c.startTime + visLen);
          return timelineTime >= c.startTime && timelineTime < endTime;
        })
        // if multiple overlap, choose one (e.g., last / highest z-index)
        .slice(-1)[0] || null;

    if (activeClip) {
      activeSet.add(activeClip.id);
      syncAudio({
        clipId: activeClip.id,
        url: activeClip.url,
        timelineTime,
        isPlaying,
        clipStartTime: activeClip.startTime,
        clipEndTime: activeClip.endTime ?? (activeClip.startTime + Math.max(0, (activeClip.duration ?? 0) - (activeClip.trimStart || 0) - (activeClip.trimEnd || 0))),
        trimStart: activeClip.trimStart || 0,
        trimEnd: activeClip.trimEnd || 0,
        assetDuration: activeClip.duration
      });
    }

    // Pause everything else
    const map = audioElementsRef.current;
    for (const [clipId, entry] of map.entries()) {
      if (!activeSet.has(clipId)) {
        if (!entry.audio.paused) entry.audio.pause();
      }
    }
  };

  const cleanupClips = (activeClipIds) => {
    const map = audioElementsRef.current;
    for (const [clipId, entry] of map.entries()) {
      if (!activeClipIds.has(clipId)) {
        entry.audio.pause();
        entry.audio.src = "";
        map.delete(clipId);
      }
    }
  };

  const stopAll = () => {
    audioElementsRef.current.forEach(({ audio }) => {
      if (!audio.paused) audio.pause();
    });
  };

  return {
    // fine-grained single-clip sync
    syncAudio,
    // convenience multi-clip sync (ensures only one plays)
    syncAll,
    // lifecycle helpers
    cleanupClips,
    stopAll
  };
}

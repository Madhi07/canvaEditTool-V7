// components/AudioPlayer.js
import { useEffect, useRef, forwardRef, useImperativeHandle } from "react";

/** Tunables */
const FADE_SEC = 0.006; // 6ms clickless fade

/** Single shared context + master */
let AC = null;
let MASTER = null;

function getAC() {
  if (!AC) {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    MASTER = AC.createGain();
    MASTER.gain.setValueAtTime(1, AC.currentTime);
    MASTER.connect(AC.destination);
  }
  return AC;
}

/** Buffer cache: url -> Promise<AudioBuffer> */
const cache = new Map();
async function getBuffer(url) {
  // If already cached, return it
  if (cache.has(url)) return cache.get(url);

  const ac = getAC();

  // Fetch audio data via your Next.js API
  const response = await fetch(`/api/audio?url=${encodeURIComponent(url)}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch audio: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();

  // Decode the audio data using AudioContext
  const decoded = await new Promise((resolve, reject) => {
    ac.decodeAudioData(arrayBuffer, resolve, reject);
  });

  cache.set(url, decoded); // cache it
  return decoded;
}
//  function getBuffer(url) {
//   if (cache.has(url)) return cache.get(url);
//   const ac = getAC();
//   fetch(`/api/audio?url=${encodeURIComponent(url)}`)
//     // const p = fetch(url)
//     const arrayBuffer = await response.arrayBuffer();
//     .then((r) => r.arrayBuffer())
//     .then(
//       (ab) =>
//         new Promise((res, rej) => {
//           ac.decodeAudioData(ab, res, rej);
//         })
//     );
//   cache.set(url, p);
//   return p;
// }

function visLen(c) {
  const d = Math.max(0, Number(c.duration) || 0);
  const ts = Math.max(0, Number(c.trimStart) || 0);
  const te = Math.max(0, Number(c.trimEnd) || 0);
  return Math.max(0, d - ts - te);
}
function clipEnd(c) {
  return c.endTime ?? c.startTime + visLen(c);
}
function inWindow(c, t) {
  const len = visLen(c);
  return len > 0 && t >= c.startTime && t < clipEnd(c);
}
function bufferOffsetFor(c, timelineT) {
  const off = (c.trimStart || 0) + (timelineT - c.startTime);
  const max = (c.trimStart || 0) + visLen(c) - 0.001;
  return Math.max(0, Math.min(off, max));
}

/** Active sources: id -> { source, gain, startedAtCtx, endsAtTimeline, clipSnapshot, teardownTimerId, onendedHandler } */
const active = new Map();

function fade(gainNode, tStart, from, to, dur) {
  const g = gainNode.gain;
  g.cancelScheduledValues(tStart);
  g.setValueAtTime(from, tStart);
  g.linearRampToValueAtTime(to, tStart + Math.max(0.001, dur));
}

/** Aggressive teardown for a clip's active source */
function stopClip(id, fast = false) {
  const e = active.get(id);
  if (!e) return;
  try {
    // cancel any pending cleanup timer
    if (e.teardownTimerId != null) {
      clearTimeout(e.teardownTimerId);
      e.teardownTimerId = null;
    }

    // remove onended handler to avoid double-cleanup races
    try {
      if (e.onendedHandler && e.source) {
        e.source.onended = null;
      }
    } catch {}

    // cancel scheduled gain ramps at once, then stop
    try {
      const now = AC.currentTime;
      e.gain.gain.cancelScheduledValues(now);
      e.gain.gain.setValueAtTime(0.0001, now);
    } catch {}

    try {
      e.source.stop(0);
    } catch (err) {
      // ignore if already stopped/ended
    }

    // disconnect nodes
    try {
      e.source.disconnect();
    } catch {}
    try {
      e.gain.disconnect();
    } catch {}
  } catch (err) {
    // swallow errors — we still want to remove the entry
  }
  active.delete(id);
}

/** Stop and clear all playing/scheduled pieces */
function stopAll() {
  for (const id of Array.from(active.keys())) {
    stopClip(id);
  }
}

/** Create and schedule a single continuous BufferSource for a clip */
function startClip(
  ac,
  clip,
  timelineNow,
  masterVol,
  sessionAtStart,
  isPlayingRef,
  sessionRef
) {
  if (active.has(clip.id)) return;

  const startTL = Math.max(timelineNow, clip.startTime);
  const endTL = clipEnd(clip);
  if (endTL <= startTL) return;

  return getBuffer(clip.url)
    .then((buffer) => {
      // Guard: if session changed or we are no longer playing, bail out
      if (
        !buffer ||
        !isPlayingRef.current ||
        sessionRef.current !== sessionAtStart
      )
        return;

      const when = ac.currentTime + (startTL - timelineNow);
      const offset = bufferOffsetFor(clip, startTL);
      const maxPlayable = Math.max(0, buffer.duration - offset);
      const dur = Math.min(endTL - startTL, maxPlayable);
      if (dur <= 0) return;

      const src = ac.createBufferSource();
      src.buffer = buffer;
      const g = ac.createGain();

      const perClip = clip.gain != null ? clip.gain : 1;
      const targetGain =
        Math.max(0, Math.min(1, perClip)) * Math.max(0, Math.min(1, masterVol));

      // Final guard just before scheduling (race between decode and user actions)
      if (!isPlayingRef.current || sessionRef.current !== sessionAtStart) {
        try {
          src.disconnect();
          g.disconnect();
        } catch {}
        return;
      }

      // ramp/gain setup
      g.gain.setValueAtTime(0.0001, when);
      fade(g, when, 0.0001, targetGain, FADE_SEC);

      src.connect(g).connect(MASTER);

      try {
        src.start(when, offset, dur);
      } catch (err) {
        try {
          src.disconnect();
        } catch {}
        try {
          g.disconnect();
        } catch {}
        return;
      }

      // schedule fade-out at end
      const outStart = when + dur - FADE_SEC;
      if (outStart > ac.currentTime) {
        fade(g, outStart, targetGain, 0.0001, FADE_SEC);
      }

      // define onended handler for extra safety
      const onendedHandler = () => {
        if (active.has(clip.id)) {
          try {
            src.onended = null;
          } catch {}
          active.delete(clip.id);
        }
      };
      try {
        src.onended = onendedHandler;
      } catch {}

      // track entry and a teardown timer that removes the entry after it's done
      const endsAtCtx = when + dur;
      const entry = {
        source: src,
        gain: g,
        startedAtCtx: when,
        endsAtTimeline: startTL + dur,
        clipSnapshot: {
          startTime: clip.startTime,
          endTime: clip.endTime,
          trimStart: clip.trimStart,
          trimEnd: clip.trimEnd,
          url: clip.url,
          gain: clip.gain,
        },
        teardownTimerId: null,
        onendedHandler,
      };
      active.set(clip.id, entry);

      // cleanup timer (ensures we delete entry even if onended doesn't fire)
      const teardown = () => {
        const cur = active.get(clip.id);
        if (!cur) return;
        if (AC.currentTime >= endsAtCtx - 0.01) {
          try {
            cur.source.onended = null;
          } catch {}
          try {
            cur.source.disconnect();
          } catch {}
          try {
            cur.gain.disconnect();
          } catch {}
          active.delete(clip.id);
        } else {
          entry.teardownTimerId = setTimeout(teardown, 50);
        }
      };
      entry.teardownTimerId = setTimeout(teardown, (dur + 0.1) * 1000);
    })
    .catch(() => {
      // decode failed — nada
    });
}

/** The React component */
const AudioPlayer = forwardRef(function AudioPlayer(
  {
    activeAudioClips,
    isPlaying,
    currentTime,
    seekAudio,
    clips, // now used for prefetch
    activeVisualType, // used to tune scheduling behavior
    masterVolume = 1,
  },
  ref
) {
  const lastSeekRef = useRef(seekAudio);
  const masterVolRef = useRef(masterVolume);

  // session token to invalidate late decodes
  const sessionRef = useRef(0);
  const isPlayingRef = useRef(false);

  useImperativeHandle(
    ref,
    () => ({
      stopAll() {
        sessionRef.current += 1;
        stopAll();
      },
      setMasterVolume(v) {
        masterVolRef.current = Math.max(0, Math.min(1, v));
        const ac = getAC();
        MASTER.gain.setValueAtTime(masterVolRef.current, ac.currentTime);
      },
    }),
    []
  );

  // Prefetch audio buffers for all audio clips when `clips` changes.
  // This reduces decode latency and the race window where late decodes can start unexpectedly.
  useEffect(() => {
    if (!clips || !Array.isArray(clips)) return;
    for (const c of clips) {
      if (c.type === "audio" && c.url) {
        // fire-and-forget: cache.getBuffer will dedupe
        getBuffer(c.url).catch(() => {
          /* ignore decode errors here */
        });
      }
    }
  }, [clips]);

  // master volume sync
  useEffect(() => {
    masterVolRef.current = Math.max(0, Math.min(1, masterVolume));
    const ac = getAC();
    MASTER.gain.setValueAtTime(masterVolRef.current, ac.currentTime);
  }, [masterVolume]);

  // play/pause gate — suspend context & increment session on pause
  useEffect(() => {
    const ac = getAC();
    isPlayingRef.current = isPlaying;
    sessionRef.current += 1; // invalidate decodes started earlier

    if (isPlaying) {
      ac.resume?.();
    } else {
      stopAll();
      try {
        ac.suspend?.();
      } catch {}
    }
  }, [isPlaying]);

  // discrete seek: hard stop + new session token
  useEffect(() => {
    if (seekAudio !== lastSeekRef.current) {
      lastSeekRef.current = seekAudio;
      sessionRef.current += 1;
      stopAll();
    }
  }, [seekAudio]);

  // main scheduler
  useEffect(() => {
    if (!isPlaying) return;

    const ac = getAC();
    const sessionAtTick = sessionRef.current;

    // allow less-aggressive corrections while displaying an image
    const suppressContinuousCorrections = activeVisualType === "image";

    const wantedIds = new Set();
    for (const clip of activeAudioClips) {
      wantedIds.add(clip.id);

      const e = active.get(clip.id);
      if (e) {
        const s = e.clipSnapshot;
        // If timing or url/gain changed, restart the source (still do it)
        if (
          s.startTime !== clip.startTime ||
          s.endTime !== clip.endTime ||
          s.trimStart !== clip.trimStart ||
          s.trimEnd !== clip.trimEnd ||
          s.url !== clip.url ||
          s.gain !== clip.gain
        ) {
          // When showing an image we try to avoid tiny drift restarts, but if the clip definitively changed we restart.
          stopClip(clip.id, true);
        }
      }

      if (!active.has(clip.id)) {
        // extra guard: only schedule if actually overlapping now
        if (
          inWindow(clip, currentTime) ||
          inWindow(clip, currentTime + 0.001)
        ) {
          // pass sessionAtTick / refs down to startClip for safety
          startClip(
            ac,
            clip,
            currentTime,
            masterVolRef.current,
            sessionAtTick,
            isPlayingRef,
            sessionRef
          );
        }
      }
    }

    // stop anything no longer active
    for (const id of Array.from(active.keys())) {
      if (!wantedIds.has(id)) stopClip(id, false);
    }
  }, [isPlaying, currentTime, activeAudioClips, activeVisualType]);

  // cleanup on unmount
  useEffect(() => {
    return () => {
      sessionRef.current += 1;
      stopAll();
    };
  }, []);

  return null;
});

export default AudioPlayer;

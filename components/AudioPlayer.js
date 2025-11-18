// components/AudioPlayer.js
import { useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import {
  ensureAudioContextOnGesture,
  getGlobalAudioContextIfExists,
  resumeIfSuspended,
} from "../utils/audio-helpers";

/** Tunables */
const FADE_SEC = 0.006; // 6ms clickless fade

/** Single shared context + master (may be created lazily) */
let AC = null;
let MASTER = null;

/** Small in-memory cache for decoded AudioBuffers */
const cache = new Map();

/* -------------------------
   Helpers: fetch with fallback (same logic you used before)
   ------------------------- */
function toS3ProxyPath(url) {
  try {
    const u = new URL(url);
    return `/s3${u.pathname}${u.search || ""}`;
  } catch (err) {
    return null;
  }
}

async function fetchAudioArrayBufferWithFallback(audioUrl) {
  // try direct fetch first
  try {
    const resp = await fetch(audioUrl, { mode: "cors" });
    if (resp.ok) return await resp.arrayBuffer();
  } catch (err) {
    // likely CORS; fallthrough
    console.debug("[Audio fetch] direct failed:", err);
  }

  // try a same-origin s3-style proxy path if available
  const s3Path = toS3ProxyPath(audioUrl);
  if (s3Path) {
    try {
      const resp = await fetch(s3Path);
      if (resp.ok) return await resp.arrayBuffer();
    } catch (err) {
      console.debug("[Audio fetch] /s3 proxy failed:", err);
    }
  }

  // finally server-side proxy route (you already had this)
  try {
    const proxyUrl = `/api/audio?url=${encodeURIComponent(audioUrl)}`;
    const resp = await fetch(proxyUrl);
    if (resp.ok) return await resp.arrayBuffer();
    throw new Error(`Proxy fetch failed ${resp.status}`);
  } catch (err) {
    console.error("[Audio fetch] All attempts failed:", err);
    throw err;
  }
}

/* -------------------------
   Decoder: OfflineAudioContext-first with fallback to temporary AudioContext
   (decodes without creating/resuming the global playback AudioContext)
   ------------------------- */
async function decodeAudioBufferOffline(arrayBuffer) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;

  if (OfflineCtx) {
    try {
      // Determine sampleRate - try to obtain from a short-lived AudioContext (not the global one)
      let sampleRate = 44100;
      if (AudioCtx) {
        try {
          const tmp = new AudioCtx();
          sampleRate = tmp.sampleRate || sampleRate;
          if (tmp.close) await tmp.close();
        } catch (e) {
          // ignore; use default sampleRate
        }
      }

      // create an OfflineAudioContext and try decodeAudioData on it
      const offline = new OfflineCtx(1, 1, sampleRate);
      if (typeof offline.decodeAudioData === "function") {
        const decoded = await new Promise((resolve, reject) => {
          try {
            offline.decodeAudioData(arrayBuffer.slice(0), (res) => resolve(res), (err) => reject(err));
          } catch (err) {
            reject(err);
          }
        });
        return decoded;
      }
    } catch (err) {
      console.warn("OfflineAudioContext decode failed, falling back:", err);
      // fall through to AudioContext decode
    }
  }

  // fallback to a temporary AudioContext decode (closed after decode)
  if (AudioCtx) {
    try {
      const ac = new AudioCtx();
      const audioBuffer = await new Promise((resolve, reject) => {
        try {
          const maybePromise = ac.decodeAudioData(arrayBuffer.slice(0));
          if (maybePromise && typeof maybePromise.then === "function") {
            maybePromise.then(resolve).catch(reject);
          } else {
            ac.decodeAudioData(arrayBuffer.slice(0), resolve, reject);
          }
        } catch (e) {
          reject(e);
        }
      });
      try {
        if (ac.close) await ac.close();
      } catch (e) {
        // ignore
      }
      return audioBuffer;
    } catch (err) {
      console.error("Temporary AudioContext decode failed:", err);
      throw err;
    }
  }

  throw new Error("No AudioContext available for decoding");
}

/* -------------------------
   Lazy creation/resume helpers for the global playback AC
   ------------------------- */
function getExistingAC() {
  // return local AC if already created, otherwise check helper's global
  return AC || getGlobalAudioContextIfExists() || null;
}

async function createAudioContextIfNeeded() {
  if (!AC) {
    // try to reuse any context created by audio-helpers
    AC = getGlobalAudioContextIfExists() || null;
  }
  if (!AC) {
    // ensureAudioContextOnGesture will either create on first gesture or create immediately if gesture already happened
    try {
      AC = await ensureAudioContextOnGesture();
    } catch (e) {
      console.warn("ensureAudioContextOnGesture failed:", e);
    }
  }

  // If it still doesn't exist and creation failed, try to construct (last-resort)
  if (!AC && (window.AudioContext || window.webkitAudioContext)) {
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      AC = new Ctor();
    } catch (e) {
      console.error("Fallback AC creation failed:", e);
    }
  }

  if (AC && !MASTER) {
    try {
      MASTER = AC._master || AC.createGain();
      MASTER.gain.setValueAtTime(MASTER.gain?.value ?? 1, AC.currentTime);
      MASTER.connect(AC.destination);
      AC._master = MASTER;
    } catch (e) {
      console.warn("Master gain setup failed:", e);
    }
  } else if (AC && AC._master) {
    MASTER = AC._master;
  }

  return AC;
}

/* -------------------------
   Buffer getter: fetch + decode (without creating global AC)
   ------------------------- */
async function getBuffer(url) {
  if (cache.has(url)) return cache.get(url);

  // fetch arrayBuffer (falls back like before)
  const p = (async () => {
    const arrayBuffer = await fetchAudioArrayBufferWithFallback(url);
    const decoded = await decodeAudioBufferOffline(arrayBuffer);
    return decoded;
  })();

  cache.set(url, p);
  return p;
}

/* -------------------------
   Utility functions (unchanged)
   ------------------------- */
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
    if (e.teardownTimerId != null) {
      clearTimeout(e.teardownTimerId);
      e.teardownTimerId = null;
    }
    try {
      if (e.onendedHandler && e.source) {
        e.source.onended = null;
      }
    } catch {}
    try {
      const now = (AC && AC.currentTime) || 0;
      e.gain.gain.cancelScheduledValues(now);
      e.gain.gain.setValueAtTime(0.0001, now);
    } catch {}
    try {
      e.source.stop(0);
    } catch (err) {}
    try { e.source.disconnect(); } catch {}
    try { e.gain.disconnect(); } catch {}
  } catch (err) {
    // swallow
  }
  active.delete(id);
}

/** Stop and clear all playing/scheduled pieces */
function stopAll() {
  for (const id of Array.from(active.keys())) {
    stopClip(id);
  }
}

/* -------------------------
   Create and schedule a single BufferSource for a clip
   This was startClip — now it ensures AC exists when needed.
   ------------------------- */
function startClip(clip, timelineNow, masterVol, sessionAtStart, isPlayingRef, sessionRef) {
  if (active.has(clip.id)) return;

  const startTL = Math.max(timelineNow, clip.startTime);
  const endTL = clipEnd(clip);
  if (endTL <= startTL) return;

  // getBuffer will decode without creating the global AC
  return getBuffer(clip.url)
    .then(async (buffer) => {
      // safety guards
      if (!buffer || !isPlayingRef.current || sessionRef.current !== sessionAtStart) return;

      // ensure there is a real playback AudioContext before scheduling
      const ac = await createAudioContextIfNeeded();
      if (!ac) return;

      // if resume is needed (suspended), try to resume
      await resumeIfSuspended(ac);

      // Re-check guards after decode/context creation
      if (!isPlayingRef.current || sessionRef.current !== sessionAtStart) return;

      const when = ac.currentTime + (startTL - timelineNow);
      const offset = bufferOffsetFor(clip, startTL);
      const maxPlayable = Math.max(0, buffer.duration - offset);
      const dur = Math.min(endTL - startTL, maxPlayable);
      if (dur <= 0) return;

      const src = ac.createBufferSource();
      src.buffer = buffer;
      const g = ac.createGain();

      const perClip = clip.gain != null ? clip.gain : 1;
      const targetGain = Math.max(0, Math.min(1, perClip)) * Math.max(0, Math.min(1, masterVol));

      // Final guard
      if (!isPlayingRef.current || sessionRef.current !== sessionAtStart) {
        try { src.disconnect(); } catch {}
        try { g.disconnect(); } catch {}
        return;
      }

      // ramp/gain setup
      try {
        g.gain.setValueAtTime(0.0001, when);
      } catch (e) {
        // some browsers throw if scheduling too far in past; safe guard
      }
      fade(g, when, 0.0001, targetGain, FADE_SEC);

      // connect nodes to master
      try {
        src.connect(g).connect(MASTER || ac.destination);
      } catch (e) {
        // if MASTER not set, connect to destination
        try { src.connect(ac.destination); } catch {}
      }

      try {
        src.start(when, offset, dur);
      } catch (err) {
        try { src.disconnect(); } catch {}
        try { g.disconnect(); } catch {}
        return;
      }

      // schedule fade-out
      const outStart = when + dur - FADE_SEC;
      if (outStart > ac.currentTime) {
        fade(g, outStart, targetGain, 0.0001, FADE_SEC);
      }

      // onended handler
      const onendedHandler = () => {
        if (active.has(clip.id)) {
          try { src.onended = null; } catch {}
          active.delete(clip.id);
        }
      };
      try { src.onended = onendedHandler; } catch {}

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

      // cleanup timer
      const teardown = () => {
        const cur = active.get(clip.id);
        if (!cur) return;
        if ((AC && AC.currentTime) >= endsAtCtx - 0.01) {
          try { cur.source.onended = null; } catch {}
          try { cur.source.disconnect(); } catch {}
          try { cur.gain.disconnect(); } catch {}
          active.delete(clip.id);
        } else {
          entry.teardownTimerId = setTimeout(teardown, 50);
        }
      };
      entry.teardownTimerId = setTimeout(teardown, (dur + 0.1) * 1000);
    })
    .catch((err) => {
      // decode failed or fetch failed — ignore as before
      console.warn("startClip error:", err);
    });
}

/* -------------------------
   Component
   ------------------------- */
const AudioPlayer = forwardRef(function AudioPlayer(
  {
    activeAudioClips,
    isPlaying,
    currentTime,
    seekAudio,
    clips,
    activeVisualType,
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
      async setMasterVolume(v) {
        masterVolRef.current = Math.max(0, Math.min(1, v));
        const existingAC = getExistingAC();
        if (existingAC && MASTER) {
          try {
            MASTER.gain.setValueAtTime(masterVolRef.current, existingAC.currentTime);
          } catch (e) {
            // ignore
          }
        }
      },
    }),
    []
  );

  // Prefetch audio buffers (decode offline) when `clips` change.
  useEffect(() => {
    if (!clips || !Array.isArray(clips)) return;
    for (const c of clips) {
      if (c.type === "audio" && c.url) {
        // getBuffer will dedupe and decode without creating the playback AC
        getBuffer(c.url).catch(() => {});
      }
    }
  }, [clips]);

  // master volume sync (do not forcibly create AC here; only if it exists)
  useEffect(() => {
    masterVolRef.current = Math.max(0, Math.min(1, masterVolume));
    const existingAC = getExistingAC();
    if (existingAC && MASTER) {
      try {
        MASTER.gain.setValueAtTime(masterVolRef.current, existingAC.currentTime);
      } catch (e) {}
    }
  }, [masterVolume]);

  // play/pause behavior: when transitioning to play, ensure AC exists and resume it.
  useEffect(() => {
    isPlayingRef.current = isPlaying;
    sessionRef.current += 1; // invalidate previous decodes/schedules

    if (isPlaying) {
      // create/resume context on play (lazy & gesture-protected by audio-helpers)
      createAudioContextIfNeeded()
        .then((ac) => {
          if (!ac) return;
          // set MASTER volume if needed
          try {
            MASTER = ac._master || MASTER;
            if (!MASTER) {
              MASTER = ac.createGain();
              MASTER.gain.setValueAtTime(masterVolRef.current, ac.currentTime);
              MASTER.connect(ac.destination);
              ac._master = MASTER;
            } else {
              MASTER.gain.setValueAtTime(masterVolRef.current, ac.currentTime);
            }
          } catch (e) {}
          // resume if suspended
          return resumeIfSuspended(ac);
        })
        .catch((e) => {
          console.warn("create/resume AC failed on play:", e);
        });
    } else {
      // stop all scheduled playback & optionally suspend AC
      stopAll();
      const existing = getExistingAC();
      if (existing) {
        try {
          existing.suspend?.();
        } catch (e) {}
      }
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

  // main scheduler: schedule clips when playing
  useEffect(() => {
    if (!isPlaying) return;

    const sessionAtTick = sessionRef.current;
    const suppressContinuousCorrections = activeVisualType === "image";

    const wantedIds = new Set();
    for (const clip of activeAudioClips) {
      wantedIds.add(clip.id);

      const e = active.get(clip.id);
      if (e) {
        const s = e.clipSnapshot;
        if (
          s.startTime !== clip.startTime ||
          s.endTime !== clip.endTime ||
          s.trimStart !== clip.trimStart ||
          s.trimEnd !== clip.trimEnd ||
          s.url !== clip.url ||
          s.gain !== clip.gain
        ) {
          stopClip(clip.id, true);
        }
      }

      if (!active.has(clip.id)) {
        if (inWindow(clip, currentTime) || inWindow(clip, currentTime + 0.001)) {
          // startClip returns a promise; we don't await it here
          startClip(clip, currentTime, masterVolRef.current, sessionAtTick, isPlayingRef, sessionRef);
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

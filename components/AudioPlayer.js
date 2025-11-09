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
function getBuffer(url) {
  if (cache.has(url)) return cache.get(url);
  const ac = getAC();
  const p = fetch(url)
    .then(r => r.arrayBuffer())
    .then(ab => new Promise((res, rej) => ac.decodeAudioData(ab, res, rej)));
  cache.set(url, p);
  return p;
}

function visLen(c) {
  const d = Math.max(0, Number(c.duration) || 0);
  const ts = Math.max(0, Number(c.trimStart) || 0);
  const te = Math.max(0, Number(c.trimEnd) || 0);
  return Math.max(0, d - ts - te);
}
function clipEnd(c) {
  return c.endTime ?? (c.startTime + visLen(c));
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

/** Active sources: id -> { source, gain, startedAtCtx, endsAtTimeline, clipSnapshot } */
const active = new Map();

function fade(gainNode, tStart, from, to, dur) {
  const g = gainNode.gain;
  g.cancelScheduledValues(tStart);
  g.setValueAtTime(from, tStart);
  g.linearRampToValueAtTime(to, tStart + Math.max(0.001, dur));
}

function startClip(ac, clip, timelineNow, masterVol) {
  // Avoid double-start
  if (active.has(clip.id)) return;

  const startTL = Math.max(timelineNow, clip.startTime);
  const endTL = clipEnd(clip);
  if (endTL <= startTL) return;

  return getBuffer(clip.url).then(buffer => {
    if (!buffer) return;

    // Compute offsets and durations
    const when = ac.currentTime + (startTL - timelineNow); // schedule relative to now
    const offset = bufferOffsetFor(clip, startTL);
    const maxPlayable = Math.max(0, buffer.duration - offset);
    const dur = Math.min(endTL - startTL, maxPlayable);
    if (dur <= 0) return;

    // Nodes
    const src = ac.createBufferSource();
    src.buffer = buffer;
    const g = ac.createGain();

    const perClip = clip.gain != null ? clip.gain : 1;
    const targetGain = Math.max(0, Math.min(1, perClip)) * Math.max(0, Math.min(1, masterVol));

    // start near silent, fade in
    g.gain.setValueAtTime(0.0001, when);
    fade(g, when, 0.0001, targetGain, FADE_SEC);

    src.connect(g).connect(MASTER);

    try {
      src.start(when, offset, dur);
    } catch {
      return; // scheduling in the past, skip
    }

    // Fade out at the real end only
    const outStart = when + dur - FADE_SEC;
    if (outStart > ac.currentTime) {
      fade(g, outStart, targetGain, 0.0001, FADE_SEC);
    }

    // Auto cleanup
    const endsAtCtx = when + dur;
    const teardown = () => {
      const entry = active.get(clip.id);
      if (!entry) return;
      if (AC.currentTime >= endsAtCtx - 0.01) {
        active.delete(clip.id);
      } else {
        setTimeout(teardown, 50);
      }
    };
    setTimeout(teardown, (dur + 0.1) * 1000);

    // Track it
    active.set(clip.id, {
      source: src,
      gain: g,
      startedAtCtx: when,
      endsAtTimeline: startTL + dur,
      clipSnapshot: { startTime: clip.startTime, endTime: clip.endTime, trimStart: clip.trimStart, trimEnd: clip.trimEnd, url: clip.url, gain: clip.gain },
    });
  });
}

function stopClip(id, fast = false) {
  const e = active.get(id);
  if (!e) return;
  try {
    if (fast) {
      e.source.stop();
    } else {
      // short fade out, then stop
      const now = AC.currentTime;
      const cur = e.gain.gain.value;
      fade(e.gain, now, cur, 0.0001, FADE_SEC);
      setTimeout(() => { try { e.source.stop(); } catch {} }, FADE_SEC * 1000 + 5);
    }
  } catch {}
  active.delete(id);
}

function stopAll() {
  for (const id of Array.from(active.keys())) stopClip(id, true);
}

const AudioPlayer = forwardRef(function AudioPlayer({
  activeAudioClips, // array of audio clips overlapping the current time
  isPlaying,
  currentTime,
  seekAudio,        // bump on discrete seeks
  clips,            // (unused here, but fine to keep)
  activeVisualType, // (unused here)
  masterVolume = 1,
}, ref) {
  const lastSeekRef = useRef(seekAudio);
  const masterVolRef = useRef(masterVolume);

  useImperativeHandle(ref, () => ({
    stopAll() { stopAll(); },
    setMasterVolume(v) {
      masterVolRef.current = Math.max(0, Math.min(1, v));
      const ac = getAC();
      MASTER.gain.setValueAtTime(masterVolRef.current, ac.currentTime);
    },
  }), []);

  // keep master volume node in sync
  useEffect(() => {
    masterVolRef.current = Math.max(0, Math.min(1, masterVolume));
    const ac = getAC();
    MASTER.gain.setValueAtTime(masterVolRef.current, ac.currentTime);
  }, [masterVolume]);

  // play/pause gate
  useEffect(() => {
    const ac = getAC();
    if (isPlaying) ac.resume?.();
    else stopAll();
  }, [isPlaying]);

  // discrete seek: hard stop & let next effect restart what’s needed
  useEffect(() => {
    if (seekAudio !== lastSeekRef.current) {
      lastSeekRef.current = seekAudio;
      stopAll();
    }
  }, [seekAudio]);

  // main scheduling: maintain exactly one continuous source per active clip
  useEffect(() => {
    if (!isPlaying) return;

    const ac = getAC();

    // 1) Start any active clip that isn't already running
    const wantedIds = new Set();
    for (const clip of activeAudioClips) {
      wantedIds.add(clip.id);

      const e = active.get(clip.id);

      // If already playing but its timing definition changed (drag/trim/url), restart it
      if (e) {
        const snap = e.clipSnapshot;
        if (
          snap.startTime !== clip.startTime ||
          snap.endTime !== clip.endTime ||
          snap.trimStart !== clip.trimStart ||
          snap.trimEnd !== clip.trimEnd ||
          snap.url !== clip.url ||
          snap.gain !== clip.gain
        ) {
          stopClip(clip.id, true);
        }
      }

      if (!active.has(clip.id)) {
        startClip(ac, clip, currentTime, masterVolRef.current);
      }
    }

    // 2) Stop anything no longer active (clip left the window)
    for (const id of Array.from(active.keys())) {
      if (!wantedIds.has(id)) stopClip(id, false);
    }
  }, [isPlaying, currentTime, activeAudioClips]);

  // cleanup on unmount
  useEffect(() => () => stopAll(), []);

  return null;
});

export default AudioPlayer;

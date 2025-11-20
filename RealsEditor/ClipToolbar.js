// /mnt/data/ClipToolbar.js
// Updated ClipToolbar with image duration controls (shows for clip.type === 'image')
// Preserves existing volume debounce and video speed controls.
// New props: onChangeDuration(clipId, seconds), onAdjustDuration(clipId, delta), minImageDuration

import React, { useEffect, useRef, useState } from "react";

/**
 * ClipToolbar
 *
 * Props:
 * - clip, pos
 * - onDelete(clipId)
 * - onSplit(clipId, time)
 * - onChangeVolume(clipId, volume)
 * - onChangeSpeed(clipId, rate)
 * - onChangeDuration(clipId, seconds)   // NEW: absolute setter for image duration
 * - onAdjustDuration(clipId, delta)     // NEW: incremental adjust (seconds)
 * - minImageDuration (optional, default 0.1)
 * - playheadTime
 *
 * Notes:
 * - This toolbar intentionally only calls stopPropagation on pointer/mouse events so timeline doesn't seek.
 * - Volume updates are debounced (100ms) to parent.
 */

const IconImg = ({ src, alt, size = 16 }) => (
  <img src={src} alt={alt} width={size} height={size} style={{ display: "block" }} />
);

export default function ClipToolbar({
  clip,
  pos,
  onDelete,
  onSplit,
  onChangeVolume,
  onChangeSpeed,
  onChangeDuration,
  onAdjustDuration,
  minImageDuration = 0.1,
  playheadTime,
}) {
  const [volume, setVolume] = useState(
    typeof clip?.volume === "number" ? clip.volume : 1
  );
  const [rate, setRate] = useState(
    typeof clip?.playbackRate === "number" ? clip.playbackRate : 1
  );

  // Local editable duration state for smooth typing (seconds, string to preserve user's typing)
  const [editableDuration, setEditableDuration] = useState(
    clip ? String(Number(((clip.endTime ?? 0) - (clip.startTime ?? 0)).toFixed(2))) : "0.0"
  );
  const [isEditingDuration, setIsEditingDuration] = useState(false);

  const volumeTimer = useRef(null);
  const toolbarRef = useRef(null);
  const inputDurRef = useRef(null);

  useEffect(() => {
    if (!clip) return;
    if (typeof clip?.volume === "number") setVolume(clip.volume);
    if (typeof clip?.playbackRate === "number") setRate(clip.playbackRate);

    // sync editable duration when clip changes (but don't clobber while editing)
    const dur = Number(((clip.endTime ?? 0) - (clip.startTime ?? 0)).toFixed(2));
    if (!isEditingDuration) {
      setEditableDuration(String(dur));
    }
  }, [clip?.id, clip?.volume, clip?.playbackRate, clip?.startTime, clip?.endTime, isEditingDuration]);

  useEffect(() => {
    return () => {
      if (volumeTimer.current) {
        clearTimeout(volumeTimer.current);
        volumeTimer.current = null;
      }
    };
  }, []);

  if (!clip || !pos) return null;

  // STOP PROPAGATION ONLY (do NOT preventDefault)
  const stopPropagationOnly = (e) => {
    if (e && typeof e.stopPropagation === "function") e.stopPropagation();
    // intentionally do NOT call preventDefault()
  };

  const handleDelete = (e) => {
    stopPropagationOnly(e);
    onDelete && onDelete(clip.id);
  };

  const handleSplit = (e) => {
    stopPropagationOnly(e);
    const t = Math.max(
      clip.startTime ?? 0,
      Math.min(clip.endTime ?? clip.startTime ?? 0, playheadTime ?? 0)
    );
    onSplit && onSplit(clip.id, t);
  };

  // Volume handling (debounced)
  const handleVolumeChangeLocal = (e) => {
    stopPropagationOnly(e);
    const v = Math.max(0, Math.min(1, parseFloat(e.target.value || 0)));
    setVolume(v);

    // debounce to parent
    if (volumeTimer.current) clearTimeout(volumeTimer.current);
    volumeTimer.current = setTimeout(() => {
      volumeTimer.current = null;
      onChangeVolume && onChangeVolume(clip.id, v);
    }, 100);
  };

  const handleVolumePointerDown = (e) => {
    stopPropagationOnly(e);
  };

  const handleSpeedChange = (e) => {
    stopPropagationOnly(e);
    const r = parseFloat(e.target.value || 1);
    setRate(r);
    onChangeSpeed && onChangeSpeed(clip.id, r);
  };

  const formatDuration = (start, end) => {
    if (typeof start !== "number" || typeof end !== "number") return "--";
    const dur = Math.max(0, end - start);
    return `${dur.toFixed(2)}s`;
  };

  // Duration (image) handlers
  const commitDurationChange = (valueStr) => {
    if (!onChangeDuration) return;
    const parsed = parseFloat(valueStr);
    if (!isFinite(parsed)) return;
    const dur = Math.max(minImageDuration, Number(parsed));
    onChangeDuration(clip.id, dur);
    // sync editable state to normalized value
    setEditableDuration(String(Number(dur.toFixed(2))));
  };

  const handleDurationInputChange = (e) => {
    stopPropagationOnly(e);
    setEditableDuration(e.target.value);
  };

  const handleDurationInputBlur = (e) => {
    setIsEditingDuration(false);
    commitDurationChange(e.target.value);
  };

  const handleDurationInputKey = (e) => {
    if (e.key === "Enter") {
      setIsEditingDuration(false);
      commitDurationChange(e.target.value);
      // try to blur to close mobile keyboards
      try {
        inputDurRef.current && inputDurRef.current.blur();
      } catch {}
    } else if (e.key === "Escape") {
      // revert to actual clip duration
      const dur = Number(((clip.endTime ?? 0) - (clip.startTime ?? 0)).toFixed(2));
      setEditableDuration(String(dur));
      setIsEditingDuration(false);
      try {
        inputDurRef.current && inputDurRef.current.blur();
      } catch {}
    }
  };

  const handleAdjustDurationClick = (delta) => (e) => {
    stopPropagationOnly(e);
    if (onAdjustDuration) {
      onAdjustDuration(clip.id, delta);
      // optimistic local update if clip has duration available
      const curDur = Math.max(minImageDuration, (clip.endTime ?? 0) - (clip.startTime ?? 0));
      const newDur = Math.max(minImageDuration, Number((curDur + delta).toFixed(2)));
      setEditableDuration(String(newDur));
    }
  };

  // Helpers for UI state
  const clipDuration = Number(((clip.endTime ?? 0) - (clip.startTime ?? 0)).toFixed(2));
  const showVolume = !!clip.hasAudio && clip.type !== "image"; // still prefer clip.hasAudio, but images typically don't have audio

  return (
    <div
      ref={toolbarRef}
      style={{
        pointerEvents: "auto",
        transform: "translate(-50%, -100%)",
        display: "inline-block",
      }}
      onMouseDown={stopPropagationOnly}
      onPointerDown={stopPropagationOnly}
    >
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          padding: "8px 12px",
          borderRadius: 12,
          background: "rgba(255,255,255,0.98)",
          boxShadow: "0 6px 18px rgba(11,22,39,0.08)",
          minWidth: 280,
          maxWidth: 720,
          fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial",
          fontSize: 13,
          color: "#0f172a",
        }}
      >
        {/* Delete */}
        <button
          title="Delete"
          onClick={handleDelete}
          onMouseDown={stopPropagationOnly}
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            border: "none",
            background: "transparent",
            cursor: "pointer",
            padding: 6,
            borderRadius: 8,
          }}
        >
          <IconImg src="icons/bin.png" alt="Delete" size={16} />
        </button>

        {/* Divider */}
        <div style={{ width: 1, height: 28, background: "rgba(15,23,42,0.06)" }} />

        {/* Split at playhead */}
        <button
          title="Split at playhead"
          onClick={handleSplit}
          onMouseDown={stopPropagationOnly}
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            border: "none",
            background: "transparent",
            cursor: "pointer",
            padding: 6,
            borderRadius: 8,
            fontWeight: 600,
          }}
        >
          <IconImg src="icons/middle.png" alt="Split" size={16} />
          <div style={{ fontSize: 12 }}>{formatDuration(clip.startTime, clip.endTime)}</div>
        </button>

        <div style={{ width: 1, height: 28, background: "rgba(15,23,42,0.06)" }} />

        {/* IMAGE DURATION CONTROLS */}
        {clip.type === "image" && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>Duration</div>

            <button
              title="Decrease 0.5s"
              onClick={handleAdjustDurationClick(-0.5)}
              onMouseDown={stopPropagationOnly}
              style={{
                padding: "6px 8px",
                borderRadius: 8,
                border: "1px solid rgba(11,22,39,0.06)",
                cursor: "pointer",
                background: "transparent",
                fontWeight: 600,
              }}
            >
              −0.5s
            </button>

            <input
              ref={inputDurRef}
              type="number"
              min={minImageDuration}
              step="0.1"
              value={editableDuration}
              onChange={handleDurationInputChange}
              onBlur={handleDurationInputBlur}
              onKeyDown={handleDurationInputKey}
              onPointerDown={stopPropagationOnly}
              onMouseDown={stopPropagationOnly}
              onFocus={() => setIsEditingDuration(true)}
              style={{
                width: 80,
                padding: "6px 8px",
                borderRadius: 8,
                border: "1px solid rgba(11,22,39,0.08)",
                fontSize: 13,
                fontWeight: 600,
                textAlign: "center",
                background: "#fff",
              }}
            />

            <button
              title="Increase 0.5s"
              onClick={handleAdjustDurationClick(0.5)}
              onMouseDown={stopPropagationOnly}
              style={{
                padding: "6px 8px",
                borderRadius: 8,
                border: "1px solid rgba(11,22,39,0.06)",
                cursor: "pointer",
                background: "transparent",
                fontWeight: 600,
              }}
            >
              +0.5s
            </button>
          </div>
        )}

        {/* Volume (only if clip has audio and not an image) */}
        {showVolume && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <IconImg src={volume > 0.01 ? "icons/volume-high.png" : "icons/mute.png"} alt="Volume" size={14} />
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={handleVolumeChangeLocal}
              onPointerDown={handleVolumePointerDown}
              onMouseDown={handleVolumePointerDown}
              style={{ width: 140 }}
            />
          </div>
        )}

        {/* Video speed controls (video only) */}
        {clip.type === "video" && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <IconImg src="icons/time-left.png" alt="Speed" size={14} />
            <select
              value={rate}
              onChange={handleSpeedChange}
              onPointerDown={(e) => e.stopPropagation()}
              style={{
                border: "none",
                background: "transparent",
                fontWeight: 600,
                cursor: "pointer",
                padding: "6px 4px",
                outline: "none",
              }}
            >
              <option value={0.5}>0.5x</option>
              <option value={0.75}>0.75x</option>
              <option value={1}>1x</option>
              <option value={1.25}>1.25x</option>
              <option value={1.5}>1.5x</option>
              <option value={2}>2x</option>
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

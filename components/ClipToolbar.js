// components/ClipToolbar.jsx
import React, { useEffect, useRef, useState } from "react";

/**
 * ClipToolbar
 *
 * - Prevents event bubbling so range/select drags don't trigger timeline seeks
 * - Debounces volume updates (100ms)
 * - Keeps local controlled state so UI reacts immediately
 *
 * Props:
 * - clip, pos, onDelete, onSplit, onChangeVolume, onChangeSpeed, playheadTime
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
  playheadTime,
}) {
  const [volume, setVolume] = useState(
    typeof clip?.volume === "number" ? clip.volume : 1
  );
  const [rate, setRate] = useState(
    typeof clip?.playbackRate === "number" ? clip.playbackRate : 1
  );
  const volumeTimer = useRef(null);
  const toolbarRef = useRef(null);

  useEffect(() => {
    if (typeof clip?.volume === "number") setVolume(clip.volume);
    if (typeof clip?.playbackRate === "number") setRate(clip.playbackRate);
  }, [clip?.id, clip?.volume, clip?.playbackRate]);

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
    if (e && e.stopPropagation) e.stopPropagation();
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
    // just stop propagation so timeline doesn't get this pointer
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
    return dur % 1 === 0 ? `${dur}s` : `${dur.toFixed(1)}s`;
  };

  // Styling/positioning — you adjusted these earlier; keep as you prefer
  const style = {
    position: "absolute",
    left: "-120px",
    top: "130px",
    transform: "translate(-50%, -100%)",
    zIndex: 99999,
    pointerEvents: "auto",
  };

  const containerStyle = {
    display: "flex",
    gap: 10,
    alignItems: "center",
    background: "#fff",
    color: "#111827",
    padding: "8px 20px 8px 10px",
    borderRadius: 12,
    boxShadow: "0 8px 30px rgba(2,6,23,0.12)",
    fontSize: 13,
    minHeight: 44,
    border: "1px solid rgba(15,23,42,0.06)",
    whiteSpace: "nowrap",
    userSelect: "none",
  };

  return (
    <div
      ref={toolbarRef}
      style={style}
      onMouseDown={stopPropagationOnly}
      onPointerDown={stopPropagationOnly}
    >
      <div style={containerStyle} onMouseDown={stopPropagationOnly} onPointerDown={stopPropagationOnly}>
        {/* Delete */}
        <button
          title="Delete"
          onClick={handleDelete}
          style={{
            display: "flex",
            alignItems: "center",
            width: 28,
            height: 28,
            background: "transparent",
            border: "none",
            cursor: "pointer",
          }}
        >
          <IconImg src="/icons/bin.png" alt="Delete" size={18} />
        </button>

        <div style={{ width: 1, height: 28, background: "rgba(15,23,42,0.06)" }} />

        {/* Split + duration */}
        <button
          title="Split at playhead"
          onClick={handleSplit}
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            padding: "6px 8px",
            borderRadius: 8,
            border: "none",
            cursor: "pointer",
            background: "transparent",
            fontWeight: 600,
          }}
        >
          <IconImg src="/icons/middle.png" alt="Split" size={16} />
          <div>{formatDuration(clip.startTime, clip.endTime)}</div>
        </button>

        <div style={{ width: 1, height: 28, background: "rgba(15,23,42,0.06)" }} />

        {/* Volume (only if clip has audio) */}
        {clip.hasAudio && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <IconImg src={volume > 0.01 ? "/icons/volume-high.png" : "/icons/mute.png"} alt="Volume" size={14} />
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={handleVolumeChangeLocal}
              onPointerDown={handleVolumePointerDown}
              onMouseDown={handleVolumePointerDown}
              style={{ width: 120 }}
            />
          </div>
        )}

        {/* Video speed */}
        {clip.type === "video" && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <IconImg src="/icons/time-left.png" alt="Speed" size={14} />
            <select
              value={rate}
              onChange={handleSpeedChange}
              style={{ border: "none", background: "transparent", fontWeight: 600, cursor: "pointer" }}
              // stop propagation only on pointerdown so native dropdown still works
              onPointerDown={(e) => e.stopPropagation()}
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

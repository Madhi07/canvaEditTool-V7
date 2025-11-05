// components/Timeline.js

"use client";
import { motion, useSpring } from "framer-motion";
import { useState, useRef, useEffect } from "react";
import AudioClipWaveform from "./AudioClipWaveform"; // Assuming this is in the same directory

// Minimum duration in seconds to prevent trim collapse
const MIN_CLIP_DURATION = 0.1;

export default function Timeline({
  clips = [],
  currentTime = 0,
  totalDuration = 0,
  onClipUpdate = () => {},
  onClipSelect = () => {},
  onSeek = () => {},
  selectedClipId = null,
  onAutoLayerFix = () => {},
  onSplitAudio = () => {},
}) {
  const timelineRef = useRef(null);
  const timeMarkersRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragType, setDragType] = useState(null);
  const [dragClipId, setDragClipId] = useState(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragPreviewX, setDragPreviewX] = useState(0);
  const [hoverInsertTime, setHoverInsertTime] = useState(null);

  // FIX: Use an object to store the clip's state when the drag starts
  const [dragStartSnapshot, setDragStartSnapshot] = useState(null);

  const [zoomLevel, setZoomLevel] = useState(1);

  // Constants based on zoom
  const pixelsPerSecond = 100 * zoomLevel;
  const maxDuration = Math.max(totalDuration, 60);
  const timelineWidth = maxDuration * pixelsPerSecond;
  const videoClipHeight = 80;
  const audioClipHeight = 50;

  // Handle click to seek
  const handleTimelineClick = (e) => {
    if (!timelineRef.current || isDragging) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const time = x / pixelsPerSecond;

    const clickedTime = Math.max(0, Math.min(time, totalDuration));

    // Check if user clicked inside a clip
    const clickedClip = clips.find(
      (c) => clickedTime >= c.startTime && clickedTime <= c.endTime
    );

    onSeek(clickedTime, clickedClip?.id);
  };

  // Drag handlers
  const handleClipMouseDown = (e, clip, type) => {
    e.stopPropagation();
    setIsDragging(true);
    setDragType(type);
    setDragClipId(clip.id);
    setDragStartX(e.clientX);

    // FIX: Store a snapshot of the clip's state at the *start* of the drag
    setDragStartSnapshot({
      startTime: clip.startTime,
      endTime: clip.endTime,
      trimStart: clip.trimStart,
      trimEnd: clip.trimEnd,
    });

    onClipSelect(clip); // Select the clip when dragging starts
  };

  // ✅ Global drag listeners wrapped in useEffect
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging || !dragClipId || !dragType || !dragStartSnapshot) return;

      const deltaX = e.clientX - dragStartX;
      const deltaTime = deltaX / pixelsPerSecond;
      const clip = clips.find((c) => c.id === dragClipId);
      if (!clip) return;

      const {
        startTime: startSnapshotTime,
        endTime: endSnapshotTime,
        trimStart: trimStartSnapshot,
        trimEnd: trimEndSnapshot,
      } = dragStartSnapshot;

      //  update preview X position for ghost clip
      setDragPreviewX(e.clientX);

      if (dragType === "move") {
        let newStartTime = Math.max(0, startSnapshotTime + deltaTime);
        const clipDuration = endSnapshotTime - startSnapshotTime;

        // Update clip position live
        onClipUpdate(clip.id, {
          startTime: newStartTime,
          endTime: newStartTime + clipDuration,
        });

        // ✨ compute nearest drop indicator
        const sorted = [...clips]
          .filter((c) => c.id !== dragClipId)
          .sort((a, b) => a.startTime - b.startTime);

        let nearestEdge = 0;
        let minDist = Infinity;

        sorted.forEach((c) => {
          const leftEdge = c.startTime;
          const rightEdge = c.endTime;
          const distLeft = Math.abs(newStartTime - leftEdge);
          const distRight = Math.abs(newStartTime - rightEdge);
          if (distLeft < minDist) {
            minDist = distLeft;
            nearestEdge = leftEdge;
          }
          if (distRight < minDist) {
            minDist = distRight;
            nearestEdge = rightEdge;
          }
        });

        // Update indicator time
        setHoverInsertTime(nearestEdge);

        onSeek(newStartTime + MIN_CLIP_DURATION);
      } else if (dragType === "trim-left") {
        if (clip.type === "image") {
          // 🖼 Extend or shrink the image duration by adjusting startTime
          let newStart = Math.max(0, startSnapshotTime + deltaTime);
          const newDuration = Math.max(
            MIN_CLIP_DURATION,
            endSnapshotTime - newStart
          );

          onClipUpdate(clip.id, {
            startTime: newStart,
            endTime: endSnapshotTime,
            duration: newDuration,
          });

          onSeek(newStart);
        } else {
          // 🎥 Keep original video trimming logic
          let newTrimStart = trimStartSnapshot + deltaTime;
          newTrimStart = Math.max(0, newTrimStart);
          newTrimStart = Math.min(
            newTrimStart,
            clip.duration - trimEndSnapshot - MIN_CLIP_DURATION
          );

          const trimChange = newTrimStart - trimStartSnapshot;
          const newStartTime = startSnapshotTime + trimChange;
          const newTimelineDuration =
            clip.duration - newTrimStart - trimEndSnapshot;
          const newEndTime = newStartTime + newTimelineDuration;

          onClipUpdate(clip.id, {
            trimStart: newTrimStart,
            startTime: newStartTime,
            endTime: newEndTime,
          });

          onSeek(newStartTime);
        }
      } else if (dragType === "trim-right") {
        let newEndTime = endSnapshotTime + deltaTime;

        // 🧩 Allow extending image duration beyond original
        if (clip.type === "image") {
          const nextClip = clips
            .filter((c) => c.startTime > clip.startTime)
            .sort((a, b) => a.startTime - b.startTime)[0];

          // Calculate new potential end
          let newEndTime = endSnapshotTime + deltaTime;

          if (deltaTime > 0) {
            // ➕ Extending image to the right
            if (nextClip) {
              const overlap = newEndTime - nextClip.startTime;
              if (overlap > 0) {
                // Push the next clip forward to avoid overlap
                const pushedStart = nextClip.startTime + overlap;
                const pushedEnd = nextClip.endTime + overlap;
                onClipUpdate(nextClip.id, {
                  startTime: pushedStart,
                  endTime: pushedEnd,
                });
              }
            }
          } else if (deltaTime < 0) {
            // ➖ Shrinking image to the left, pull next clip backward to fill gap
            if (nextClip) {
              const shrinkGap = endSnapshotTime - newEndTime;
              const pulledStart = Math.max(0, nextClip.startTime - shrinkGap);
              const pulledEnd = Math.max(
                pulledStart + (nextClip.endTime - nextClip.startTime),
                0
              );
              onClipUpdate(nextClip.id, {
                startTime: pulledStart,
                endTime: pulledEnd,
              });
            }
          }

          // Apply to current image
          newEndTime = Math.max(
            newEndTime,
            startSnapshotTime + MIN_CLIP_DURATION
          );
          const newDuration = newEndTime - startSnapshotTime;

          onClipUpdate(clip.id, {
            duration: newDuration,
            endTime: newEndTime,
          });
        } else {
          // keep video trim logic as-is
          let newTrimEnd = trimEndSnapshot - deltaTime;
          newTrimEnd = Math.max(0, newTrimEnd);
          newTrimEnd = Math.min(
            newTrimEnd,
            clip.duration - trimStartSnapshot - MIN_CLIP_DURATION
          );

          const newTimelineDuration =
            clip.duration - trimStartSnapshot - newTrimEnd;
          onClipUpdate(clip.id, {
            trimEnd: newTrimEnd,
            endTime: startSnapshotTime + newTimelineDuration,
          });
        }
      }
    };

    const handleMouseUp = () => {
      if (isDragging && dragClipId && dragType === "move") {
        const clip = clips.find((c) => c.id === dragClipId);
        if (clip) handleDragEnd(clip.id, clip.startTime);
      }

      setIsDragging(false);
      setDragType(null);
      setDragClipId(null);
      setDragStartSnapshot(null);
      setDragPreviewX(null); // ✅ clear ghost
      setHoverInsertTime(null); // ✅ clear blue line
    };

    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [
    isDragging,
    dragClipId,
    dragStartX,
    dragType,
    dragStartSnapshot,
    pixelsPerSecond,
    clips,
    onClipUpdate,
    onSeek,
  ]);

  // Zoom controls (Unchanged from your previous code)
  const handleZoomIn = () => {
    setZoomLevel((prev) => Math.min(prev + 0.25, 3));
  };

  const handleZoomOut = () => {
    setZoomLevel((prev) => Math.max(prev - 0.25, 0.25));
  };

  const handleZoomReset = () => {
    setZoomLevel(1);
  };

  // Sync scrolling - only timeline scrolls, time markers follow
  useEffect(() => {
    // Ensure parentElement exists before adding listener
    if (
      !timelineRef.current ||
      !timelineRef.current.parentElement ||
      !timeMarkersRef.current ||
      !timeMarkersRef.current.parentElement
    ) {
      return;
    }

    const timelineContainer = timelineRef.current.parentElement;
    const timeMarkersContainer = timeMarkersRef.current.parentElement;

    const handleTimelineScroll = () => {
      if (timeMarkersContainer) {
        timeMarkersContainer.scrollLeft = timelineContainer.scrollLeft;
      }
    };

    timelineContainer.addEventListener("scroll", handleTimelineScroll);

    return () => {
      timelineContainer.removeEventListener("scroll", handleTimelineScroll);
    };
  }, []); // Re-run if refs change (though they shouldn't)

  const handleDragEnd = (clipId, newStartTime) => {
    const clip = clips.find((c) => c.id === clipId);
    if (!clip) return;

    // Calculate duration from its properties, not from subtraction
    const clipTimelineDuration = clip.duration - clip.trimStart - clip.trimEnd;

    const updated = clips.map((c) =>
      c.id === clipId
        ? {
            ...c,
            startTime: newStartTime,
            endTime: newStartTime + clipTimelineDuration,
          }
        : c
    );

    // Check for overlapping audio clips
    const audioClips = updated.filter((c) => c.type === "audio");
    const layered = adjustAudioTracks(audioClips);

    // Merge back updated tracks
    const merged = updated.map((c) => {
      const layer = layered.find((a) => a.id === c.id);
      return layer ? { ...c, track: layer.track } : c;
    });

    if (onAutoLayerFix) onAutoLayerFix(merged);
  };

  // Helper function to reassign overlapping audio clips
  function adjustAudioTracks(audioClips) {
    const sorted = [...audioClips].sort((a, b) => a.startTime - b.startTime);
    const layers = [];

    sorted.forEach((clip) => {
      let assigned = false;

      // Try to place it in an existing layer
      for (const layer of layers) {
        const lastClip = layer[layer.length - 1];
        if (clip.startTime >= lastClip.endTime) {
          layer.push(clip);
          assigned = true;
          break;
        }
      }

      // If it overlaps, create new layer
      if (!assigned) layers.push([clip]);
    });

    // Assign track numbers
    return layers.flatMap((layer, i) =>
      layer.map((clip) => ({ ...clip, track: i }))
    );
  }

  // Enhanced time markers
  const generateTimeMarkers = () => {
    const markers = [];
    const totalSeconds = Math.ceil(maxDuration);
    const markerStyles = [
      { interval: 10, height: 6, label: true, weight: "semibold" },
      { interval: 5, height: 4, label: true, weight: "medium" },
      { interval: 2.5, height: 2, label: false, weight: "light" },
      { interval: 1, height: 1, label: false, weight: "extralight" },
    ];

    for (const { interval, height, label, weight } of markerStyles) {
      for (let i = 0; i <= totalSeconds + 1; i += interval) {
        // Skip markers that overlap with higher-priority markers
        if (interval === 5 && i % 10 === 0) continue;
        if (interval === 2.5 && i % 5 === 0) continue;
        if (interval === 1 && (i % 2.5 === 0 || i % 5 === 0 || i % 10 === 0))
          continue;

        markers.push(
          <div
            key={`${interval}-${i}`}
            className={`absolute top-0 flex flex-col items-center`}
            style={{ left: `${i * pixelsPerSecond}px` }}
          >
            <div
              className={`w-[1px] bg-gray-600`}
              style={{ height: `${height}px` }}
            ></div>
            {label && (
              <span className={`text-xs text-gray-800 mt-2 font-${weight}`}>
                {i}s
              </span>
            )}
          </div>
        );
      }
    }
    return markers;
  };

  return (
    <div className="bg-white select-none">
      {/* Zoom Controls */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">Timeline</span>
          <div className="w-px h-4 bg-gray-300"></div>
          <span className="text-xs text-gray-500">
            {Math.round(zoomLevel * 100)}%
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleZoomOut}
            className="w-8 h-8 flex items-center justify-center rounded-md bg-white hover:bg-gray-50 transition-colors"
            title="Zoom Out"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M5 12H19" />
            </svg>
          </button>
          <button
            onClick={handleZoomReset}
            className="px-3 h-8 flex items-center justify-center rounded-md bg-white hover:bg-gray-50 transition-colors text-xs font-medium border border-gray-300"
            title="Reset Zoom"
          >
            Reset
          </button>
          <button
            onClick={handleZoomIn}
            className="w-8 h-8 flex items-center justify-center rounded-md bg-white hover:bg-gray-50 transition-colors"
            title="Zoom In"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M12 5V19M5 12H19" />
            </svg>
          </button>
        </div>
      </div>

      {/* Time markers header - no scrollbar */}
      <div className="relative overflow-hidden bg-white px-4 border-b border-gray-200">
        <div
          ref={timeMarkersRef}
          className="relative h-10"
          style={{ width: `${timelineWidth}px` }}
        >
          {generateTimeMarkers()}
        </div>
      </div>

      {/* Main timeline with single scrollbar */}
      <div
        className="relative overflow-x-auto timeline-container cursor-pointer bg-gray-50"
        style={{ minHeight: "220px" }}
      >
        <div
          ref={timelineRef}
          className="relative px-4 py-4"
          style={{ width: `${timelineWidth}px`, minHeight: "160px" }}
          onClick={handleTimelineClick}
        >
          {/* Playhead */}
          <motion.div
            className="absolute top-0 w-[3px] bg-red-500 bottom-0 z-30 pointer-events-none flex justify-center"
            animate={{ left: currentTime * pixelsPerSecond }}
            transition={{
              type: "spring",
              stiffness: 120,
              damping: 18,
              mass: 0.3,
            }}
          >
            <div className="absolute -top-0.5 -left-[4px] w-0 h-0 border-l-[6px] border-r-[6px] border-b-[8px] border-l-transparent border-r-transparent border-b-red-500"></div>
            <div className="absolute top-1/2 -left-[4px] w-[11px] h-[11px] bg-red-500 rounded-full border-2 border-white transform -translate-y-1/2"></div>
          </motion.div>

          {/* Tracks: Render two vertical tracks as visual guides */}
          <div
            className="absolute inset-x-0 border-b border-gray-300/50"
            style={{ top: "20px", height: `${videoClipHeight + 10}px` }}
          >
            <span className="absolute -left-12 top-1/2 -translate-y-1/2 text-xs text-gray-500">
              Video
            </span>
          </div>

          <div
            className="absolute inset-x-0 border-b border-gray-300/50"
            style={{
              top: `${videoClipHeight + 50}px`,
              height: `${audioClipHeight + 10}px`,
            }}
          >
            <span className="absolute -left-12 top-1/2 -translate-y-1/2 text-xs text-gray-500">
              Audio
            </span>
          </div>

          {/* 🟢 PUT THESE TWO NEW ELEMENTS RIGHT HERE */}
          {isDragging && dragType === "move" && dragClipId && (
            <motion.div
              className="absolute z-40 pointer-events-none rounded-lg overflow-hidden shadow-lg opacity-70 border border-blue-400"
              style={{
                top: "20px",
                left: `${dragPreviewX - 80}px`, // centers under cursor
                width: "160px",
                height: "60px",
                background: "#3b82f6",
                scale: 1.05,
              }}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 0.8, scale: 1.05 }}
              transition={{ type: "spring", stiffness: 120, damping: 10 }}
            >
              <div className="flex items-center justify-center h-full text-white text-sm font-medium">
                Moving...
              </div>
            </motion.div>
          )}

          {/* 🧭 Drop indicator line */}
          {hoverInsertTime !== null && (
            <motion.div
              className="absolute top-0 bottom-0 w-[3px] bg-blue-500 z-30 rounded-full"
              animate={{ left: hoverInsertTime * pixelsPerSecond }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
            />
          )}

          {/* Clips */}
          {clips.map((clip) => {
            // FIX: Calculate timeline duration from trim values
            const clipTimelineDuration =
              clip.duration - clip.trimStart - clip.trimEnd;

            // Ensure duration is not negative
            if (clipTimelineDuration < MIN_CLIP_DURATION) {
              // This shouldn't happen with the new logic, but as a safeguard:
              console.warn("Clip duration is too small:", clip.id);
              // You could choose to not render it, or render a minimal clip
            }

            const clipWidth = clipTimelineDuration * pixelsPerSecond;
            const clipHeight =
              clip.type === "audio" ? audioClipHeight : videoClipHeight;
            const clipLeft = clip.startTime * pixelsPerSecond;
            const isSelected = clip.id === selectedClipId;

            let trackPosition =
              clip.type === "audio"
                ? videoClipHeight +
                  60 +
                  (clip.track || 0) * (audioClipHeight + 20)
                : 20;

            const baseBgColor =
              clip.type === "video"
                ? "bg-blue-500"
                : clip.type === "audio"
                ? "bg-blue-400"
                : "bg-purple-500";

            return (
              <div
                key={clip.id}
                className={`absolute rounded-xl cursor-move flex items-center justify-center overflow-hidden group shadow-md ${baseBgColor} ${
                  isSelected
                    ? "ring-2 ring-blue-500 z-20"
                    : "hover:ring-1 hover:ring-gray-300 z-10"
                }`}
                style={{
                  left: `${clipLeft}px`,
                  width: `${clipWidth}px`,
                  height: `${clipHeight}px`,
                  top: `${trackPosition}px`,
                }}
                onMouseDown={(e) => handleClipMouseDown(e, clip, "move")}
                onContextMenu={(e) => {
                  if (clip.type === "audio") {
                    e.preventDefault();
                    const rect = e.currentTarget.getBoundingClientRect();
                    const clickX = e.clientX - rect.left;
                    const splitRatio = clickX / rect.width;
                    const splitTime =
                      clip.startTime +
                      (clip.endTime - clip.startTime) * splitRatio;
                    onSplitAudio(clip.id, splitTime);
                  }
                }}
              >
                {/* Visual content */}
                {clip.type === "video" || clip.type === "image" ? (
                  clip.thumbnail ? (
                    <img
                      src={clip.thumbnail}
                      alt="clip"
                      className="w-full h-full object-cover absolute inset-0 rounded-xl"
                    />
                  ) : (
                    <div className="w-full h-full bg-gray-600 flex items-center justify-center rounded-xl text-white">
                      Loading...
                    </div>
                  )
                ) : (
                  <div className="w-full h-full bg-blue-400/80 absolute inset-0 rounded-xl"></div>
                )}

                {/* Waveform Renderer for Audio Clips */}
                {clip.type === "audio" && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center p-2">
                    <AudioClipWaveform
                      audioUrl={clip.url}
                      duration={clip.duration}
                      width={clipWidth}
                      height={clipHeight - 10}
                      progress={
                        (currentTime - clip.startTime) / clipTimelineDuration
                      }
                      isSelected={isSelected}
                      color="#FFFFFF"
                    />
                  </div>
                )}

                {/* Duration label */}
                <div className="absolute bottom-1 left-2 bg-black/80 text-white text-[11px] px-2 py-1 rounded-md font-semibold z-30">
                  {clipTimelineDuration.toFixed(1)}s
                </div>

                {/* Clip Name */}
                <div className="absolute top-1 left-2 text-white text-xs font-medium z-30">
                  {clip.fileName.substring(0, 15)}
                </div>

                {/* Trim Handles */}
                {isSelected && (
                  <>
                    {/* Left Trim Handle */}
                    <div
                      className="absolute top-0 bottom-0 -left-[4px] w-[8px] bg-blue-500 cursor-col-resize z-40 opacity-90 hover:opacity-100 transition-opacity"
                      onMouseDown={(e) =>
                        handleClipMouseDown(e, clip, "trim-left")
                      }
                    >
                      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-1 h-4 bg-white rounded-full"></div>
                    </div>

                    {/* Right Trim Handle */}
                    <div
                      className="absolute top-0 bottom-0 -right-[4px] w-[8px] bg-blue-500 cursor-col-resize z-40 opacity-90 hover:opacity-100 transition-opacity"
                      onMouseDown={(e) =>
                        handleClipMouseDown(e, clip, "trim-right")
                      }
                    >
                      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-1 h-4 bg-white rounded-full"></div>
                    </div>
                  </>
                )}

                {/* Hover overlay */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors rounded-xl z-0"></div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

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
  const [dragStartValue, setDragStartValue] = useState(0);
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
    onSeek(Math.max(0, Math.min(time, totalDuration)));
  };

  // Drag handlers
  const handleClipMouseDown = (e, clip, type) => {
    e.stopPropagation();
    setIsDragging(true);
    setDragType(type);
    setDragClipId(clip.id);
    setDragStartX(e.clientX);
    

    if (type === "move") {
      setDragStartValue(clip.startTime);
    } else if (type === "trim-left") {
      setDragStartValue(clip.trimStart);
    } else if (type === "trim-right") {
      setDragStartValue(clip.trimEnd);
    }

    onClipSelect(clip); // Select the clip when dragging starts
  };

  // Global drag listeners
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging || !dragClipId || !dragType) return;

      const deltaX = e.clientX - dragStartX;
      const deltaTime = deltaX / pixelsPerSecond;
      const clip = clips.find((c) => c.id === dragClipId);
      if (!clip) return;

      if (dragType === "move") {
        let newStartTime = Math.max(0, dragStartValue + deltaTime);
        const clipDuration = clip.endTime - clip.startTime;

        // Update clip with new start/end times
        onClipUpdate(clip.id, {
          startTime: newStartTime,
          endTime: newStartTime + clipDuration,
        });

        // Seek the playhead to the new start time to follow the clip
        onSeek(newStartTime + MIN_CLIP_DURATION);
      } else if (dragType === "trim-left") {
        let newTrimStart = dragStartValue + deltaTime;

        // Clamp to 0 and ensure min duration
        newTrimStart = Math.max(0, newTrimStart);
        newTrimStart = Math.min(
          newTrimStart,
          clip.duration - clip.trimEnd - MIN_CLIP_DURATION
        );

        // Adjust clip start time based on trim (ripple edit)
        const trimChange = newTrimStart - clip.trimStart;
        const newStartTime = clip.startTime + trimChange;

        onClipUpdate(clip.id, {
          trimStart: newTrimStart,
          startTime: newStartTime,
        });

        // Seek the playhead to the new start time to reflect the trim
        onSeek(newStartTime);
      } else if (dragType === "trim-right") {
        let newTrimEnd = dragStartValue - deltaTime;

        // Clamp to 0 and ensure min duration
        newTrimEnd = Math.max(0, newTrimEnd);
        newTrimEnd = Math.min(
          newTrimEnd,
          clip.duration - clip.trimStart - MIN_CLIP_DURATION
        );

        // Adjust clip end time based on trim
        const newDuration = clip.duration - clip.trimStart - newTrimEnd;
        const newEndTime = clip.startTime + newDuration;

        onClipUpdate(clip.id, {
          trimEnd: newTrimEnd,
          endTime: newEndTime,
        });
      }
    };

    const handleMouseUp = () => {
      if (isDragging && dragClipId && dragType === "move") {
        const clip = clips.find((c) => c.id === dragClipId);
        if (clip) {
          // ✅ Call handleDragEnd when clip is released
          handleDragEnd(clip.id, clip.startTime);
        }
      }

      setIsDragging(false);
      setDragType(null);
      setDragClipId(null);
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
    dragStartValue,
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
    const timelineContainer = timelineRef.current.parentElement; // Timeline is wrapped by an overflow div
    const timeMarkersContainer = timeMarkersRef.current.parentElement;

    if (!timelineContainer || !timeMarkersContainer) return;

    const handleTimelineScroll = () => {
      timeMarkersContainer.scrollLeft = timelineContainer.scrollLeft;
    };

    timelineContainer.addEventListener("scroll", handleTimelineScroll);

    return () => {
      timelineContainer.removeEventListener("scroll", handleTimelineScroll);
    };
  }, []);

  const handleDragEnd = (clipId, newStartTime) => {
    const updated = clips.map((c) =>
      c.id === clipId
        ? { ...c, startTime: newStartTime, endTime: newStartTime + c.duration }
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

    // ✅ Notify parent (index.js)
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
    <div className="bg-white">
      {/* Zoom Controls (From your previous code) */}
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
      <div className="relative overflow-hidden bg-white px-4">
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
        className="relative overflow-x-auto timeline-container cursor-pointer bg-gray-50 border-t border-gray-200"
        style={{ minHeight: "220px" }}
      >
        <div
          ref={timelineRef}
          className="relative px-4 py-4"
          style={{ width: `${timelineWidth}px`, minHeight: "160px" }}
          onClick={handleTimelineClick}
        >
          {/* Playhead (Clean style) */}
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
            {/* Playhead top indicator */}
            <div className="absolute -top-0.5 -left-[4px] w-0 h-0 border-l-[6px] border-r-[6px] border-b-[8px] border-l-transparent border-r-transparent border-b-red-500"></div>

            {/* Center circle */}
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

          {/* Clips */}

          {clips.map((clip) => {
            const clipDuration = clip.endTime - clip.startTime;

            const clipWidth = clipDuration * pixelsPerSecond;

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
                // ✅ Add this new event handler:
                onContextMenu={(e) => {
                  // Right-click to split
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
                {/* ✅ FIX: Conditional rendering of visual content
                  We only render thumbnails/placeholders for non-audio clips.
                  Audio clips get a clear background for the waveform.
                */}
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
                  // Simple background layer for audio clips to see the waveform over it
                  <div className="w-full h-full bg-blue-400/80 absolute inset-0 rounded-xl"></div>
                )}

                {/* ✅ Waveform Renderer for Audio Clips (Placed on top of the background) */}
                {clip.type === "audio" && (
                  // The wrapper div is still needed for positioning over the green background
                  <div className="absolute inset-0 z-10 flex items-center justify-center p-2">
                    <AudioClipWaveform
                      // Required Props for the new component
                      audioUrl={clip.url} // Assuming the clip object stores the file URL
                      duration={clip.duration} // Total original duration of the media file
                      width={clipWidth} // Pass the dynamically calculated width
                      height={clipHeight - 10} // Use the fixed track height (e.g., 90)
                      progress={(currentTime - clip.startTime) / clipDuration} // Calculate playback progress (0 to 1)
                      isSelected={isSelected}
                      color="#FFFFFF" // White waves to contrast with the green clip background
                    />
                  </div>
                )}

                {/* Duration label */}
                <div className="absolute bottom-1 left-2 bg-black/80 text-white text-[11px] px-2 py-1 rounded-md font-semibold z-30">
                  {clipDuration.toFixed(1)}s
                </div>

                {/* Clip Name */}
                <div className="absolute top-1 left-2 text-white text-xs font-medium z-30">
                  {clip.fileName.substring(0, 15)}
                </div>

                {/* Trim Handles (Clean style) */}
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

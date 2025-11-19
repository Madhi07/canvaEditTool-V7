// components/Timeline.js
"use client";
import { motion, useSpring, useMotionValue } from "framer-motion";
import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import AudioClipWaveform from "./AudioClipWaveform";
import ClipToolbar from "./ClipToolbar";
// the stable toolbar inline (so it's self-contained and won't require changes).
// Minimum duration in seconds to prevent trim collapse
const MIN_CLIP_DURATION = 0.1;

// Auto-scroll thresholds (tweak these if you want different feel)
const AUTO_SCROLL_RIGHT_THRESHOLD = 0.9; // when playhead passes 90% of visible width
const AUTO_SCROLL_LEFT_THRESHOLD = 0.1; // when playhead is before 10% of visible width
const AUTO_SCROLL_TARGET_OFFSET_RATIO = 0.5; // target: make playhead appear ~50% from left

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
  onSplitClip = () => {},

  // toolbar callbacks (parent / index.js already wires these)
  onDelete = () => {},
  onChangeVolume = () => {},
  onChangeSpeed = () => {},
}) {
  const timelineRef = useRef(null);
  const timeMarkersRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragType, setDragType] = useState(null);
  const [dragClipId, setDragClipId] = useState(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragPreviewX, setDragPreviewX] = useState(0);
  const [hoverInsertTime, setHoverInsertTime] = useState(null);
  const rafSeekRef = useRef(null);

  const [dragStartSnapshot, setDragStartSnapshot] = useState(null);
  const [zoomLevel, setZoomLevel] = useState(1);

  // Constants based on zoom
  const pixelsPerSecond = 100 * zoomLevel;
  const maxDuration = Math.max(totalDuration, 60);
  const timelineWidth = maxDuration * pixelsPerSecond;
  const videoClipHeight = 80;
  const audioClipHeight = 50;

  // ---- Framer-driven scroll logic ----
  const scrollTarget = useMotionValue(0);
  const scrollSpring = useSpring(scrollTarget, {
    stiffness: 220,
    damping: 28,
    mass: 1,
  });

  useEffect(() => {
    function setContainerScroll(v) {
      const container =
        timelineRef.current && timelineRef.current.parentElement
          ? timelineRef.current.parentElement
          : null;
      if (!container) return;
      if (Math.abs(container.scrollLeft - v) > 0.5) {
        container.scrollLeft = Math.round(v);
      }
    }
    const unsub = scrollSpring.on("change", setContainerScroll);
    return () => {
      if (unsub) unsub();
    };
  }, [scrollSpring]);

  const getContainer = useCallback(() => {
    return timelineRef.current && timelineRef.current.parentElement
      ? timelineRef.current.parentElement
      : null;
  }, []);

  // auto scroll when playhead moves
  useEffect(() => {
    if (isDragging) return;
    const container = getContainer();
    if (!container || !timelineRef.current) return;
    const visibleWidth = container.clientWidth;
    if (visibleWidth <= 0) return;
    const playheadX = currentTime * pixelsPerSecond;
    const viewLeft = container.scrollLeft;
    const rightThresholdPx = visibleWidth * AUTO_SCROLL_RIGHT_THRESHOLD;
    const leftThresholdPx = visibleWidth * AUTO_SCROLL_LEFT_THRESHOLD;
    if (playheadX > viewLeft + rightThresholdPx) {
      const desiredVisibleX = visibleWidth * AUTO_SCROLL_TARGET_OFFSET_RATIO;
      let targetScrollLeft = Math.max(0, playheadX - desiredVisibleX);
      const maxScrollLeft = Math.max(
        0,
        timelineRef.current.scrollWidth - visibleWidth
      );
      if (targetScrollLeft > maxScrollLeft) targetScrollLeft = maxScrollLeft;
      if (Math.abs(container.scrollLeft - targetScrollLeft) > 2) {
        scrollTarget.set(targetScrollLeft);
      }
      return;
    }
    if (playheadX < viewLeft + leftThresholdPx) {
      const desiredVisibleX = visibleWidth * AUTO_SCROLL_LEFT_THRESHOLD;
      let targetScrollLeft = Math.max(0, playheadX - desiredVisibleX);
      if (targetScrollLeft < 0) targetScrollLeft = 0;
      if (Math.abs(container.scrollLeft - targetScrollLeft) > 2) {
        scrollTarget.set(targetScrollLeft);
      }
      return;
    }
  }, [currentTime, pixelsPerSecond, isDragging, getContainer, scrollTarget]);

  // Handle click to seek
  const handleTimelineClick = (e) => {
    if (!timelineRef.current || isDragging) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const clickedTime = Math.max(
      0,
      Math.min(x / pixelsPerSecond, totalDuration)
    );
    const videoTrackHeight = 80;
    const audioTrackStartY = videoTrackHeight;
    if (y > audioTrackStartY) {
      const clickedAudioClip = clips.find(
        (c) =>
          c.type === "audio" &&
          clickedTime >= c.startTime &&
          clickedTime < c.endTime
      );
      if (clickedAudioClip) {
        onClipSelect(clickedAudioClip);
        onSeek(clickedTime, clickedAudioClip.id);
        return;
      }
    }
    const clickedVisualClip = clips.find(
      (c) =>
        (c.type === "video" || c.type === "image") &&
        clickedTime >= c.startTime &&
        clickedTime < c.endTime
    );
    if (clickedVisualClip) {
      onClipSelect(clickedVisualClip);
    }
    onSeek(clickedTime, clickedVisualClip?.id || null);
  };

  // refs for clip nodes
  const clipRefs = useRef(new Map());

  // *** TOOLBAR CODE: stable toolbar state (fixed position above timeline)
  const [toolbarVisible, setToolbarVisible] = useState(false);
  const [toolbarClipId, setToolbarClipId] = useState(null); // clip object for toolbar
  const toolbarRef = useRef(null);
  const [toolbarPagePos, setToolbarPagePos] = useState(null);

  const toolbarClip = toolbarClipId
    ? clips.find((c) => c.id === toolbarClipId)
    : null;
  // Helper: compute stable toolbar page position (centered above timeline container)
  const computeStableToolbarPos = useCallback(() => {
    // preferred anchor: center of the timeline container (parent of timelineRef)
    const container = timelineRef.current?.parentElement || timelineRef.current;
    if (!container) {
      // fallback to center of viewport
      const left = window.innerWidth / 2;
      const top = Math.max(48, (window.innerHeight * 0.35) | 0);
      return { left, top };
    }
    const rect = container.getBoundingClientRect();
    const left = rect.left + rect.width / 2;
    // we want toolbar to sit above the timeline but below the player; offset by 64px
    // compute top = rect.top - offset
    const preferredTop = rect.top - 64;
    // clamp to visible viewport with small margin
    const viewportTop = window.scrollY || window.pageYOffset || 0;
    const minTop = viewportTop + 8;
    const viewportBottom =
      (window.scrollY || window.pageYOffset || 0) + window.innerHeight;
    const maxTop = viewportBottom - 56;
    const top = Math.min(Math.max(preferredTop, minTop), maxTop);
    return { left, top };
  }, []);

  // show toolbar on right-click (context menu) on a clip
  // we'll attach onContextMenu to each clip node below (so left-click still functions as before)
  const showToolbarForClip = (clip, e) => {
    e.preventDefault();
    e.stopPropagation();
    // set selection as well
    onClipSelect(clip);
    // compute stable pos
    const pos = computeStableToolbarPos();
    setToolbarPagePos(pos);
    setToolbarClipId(clip.id);
    setToolbarVisible(true);
  };

  // hide toolbar (used on outside click)
  const hideToolbar = useCallback(() => {
    setToolbarVisible(false);
    setToolbarClipId(null);
    setToolbarPagePos(null);
  }, []);

  // click outside detection - hide toolbar when click happens outside toolbarRef
  useEffect(() => {
    if (!toolbarVisible) return;
    const onPointerDown = (ev) => {
      // if click target is inside toolbarRef, keep it open
      if (toolbarRef.current && toolbarRef.current.contains(ev.target)) return;
      // if right-click occurred again on a clip, we'll handle it in onContextMenu
      // otherwise, hide toolbar
      hideToolbar();
    };
    window.addEventListener("pointerdown", onPointerDown);
    // also hide on ESC
    const onKey = (ev) => {
      if (ev.key === "Escape") hideToolbar();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [toolbarVisible, hideToolbar]);

  // recompute stable pos on resize/scroll while toolbar visible
  useEffect(() => {
    if (!toolbarVisible) return;
    const update = () => {
      const pos = computeStableToolbarPos();
      setToolbarPagePos(pos);
    };
    const onScrollOrResize = () => requestAnimationFrame(update);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [toolbarVisible, computeStableToolbarPos]);

  // TOOLBAR UI handlers (map to parent handlers)
  const toolbarDelete = (id) => {
    onDelete(id);
    hideToolbar();
  };

  const toolbarSplit = (id) => {
    // split at current playhead time
    onSplitClip(id, currentTime);
    hideToolbar();
  };

  const toolbarChangeVolume = (id, v) => {
    onChangeVolume(id, v);
    // keep toolbar open
  };

  const toolbarChangeSpeed = (id, r) => {
    onChangeSpeed(id, r);
    // keep toolbar open
  };

  // image duration control: set clip duration (endTime = startTime + duration)
  const toolbarSetImageDuration = (id, durationSec) => {
    const dur = Math.max(0.1, Number(durationSec) || 0.1);
    onClipUpdate(id, {
      duration: dur,
      startTime: clips.find((c) => c.id === id)?.startTime ?? 0,
      endTime: (clips.find((c) => c.id === id)?.startTime ?? 0) + dur,
    });
    // keep toolbar open so user can fine tune
  };

  // increase/decrease by 0.5s
  const toolbarAdjustImageDuration = (id, delta) => {
    const clip = clips.find((c) => c.id === id);
    if (!clip) return;
    const currentDur = Math.max(0.1, clip.endTime - clip.startTime);
    const newDur = Math.max(0.1, currentDur + delta);
    toolbarSetImageDuration(id, newDur);
  };

  // ---------------- end TOOLBAR CODE

  const handleClipMouseDown = (e, clip, type) => {
    // left-click: keep existing behavior (selection + drag start)
    // if toolbar is visible, hide it on left-click (user expects it)
    if (toolbarVisible) {
      // left click should close toolbar
      hideToolbar();
    }
    e.stopPropagation(); // don’t trigger timeline seek
    setIsDragging(true);
    setDragType(type); // "move" | "trim-left" | "trim-right"
    setDragClipId(clip.id);
    setDragStartX(e.clientX);

    setDragStartSnapshot({
      startTime: clip.startTime,
      endTime: clip.endTime,
      trimStart: clip.trimStart,
      trimEnd: clip.trimEnd,
    });

    onClipSelect(clip);
  };

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

      setDragPreviewX(e.clientX);

      if (dragType === "move") {
        let newStartTime = startSnapshotTime + deltaTime;
        const clipDuration = endSnapshotTime - startSnapshotTime;

        onClipUpdate(clip.id, {
          startTime: newStartTime,
          endTime: newStartTime + clipDuration,
        });

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

        setHoverInsertTime(nearestEdge);

        if (!rafSeekRef.current) {
          rafSeekRef.current = requestAnimationFrame(() => {
            rafSeekRef.current = null;
            onSeek(newStartTime);
          });
        }
      } else if (dragType === "trim-left") {
        if (clip.type === "image") {
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
        if (clip.type === "image") {
          const nextClip = clips
            .filter((c) => c.startTime > clip.startTime)
            .sort((a, b) => a.startTime - b.startTime)[0];

          let newEndTime = endSnapshotTime + deltaTime;

          if (deltaTime > 0) {
            if (nextClip) {
              const overlap = newEndTime - nextClip.startTime;
              if (overlap > 0) {
                const pushedStart = nextClip.startTime + overlap;
                const pushedEnd = nextClip.endTime + overlap;
                onClipUpdate(nextClip.id, {
                  startTime: pushedStart,
                  endTime: pushedEnd,
                });
              }
            }
          } else if (deltaTime < 0) {
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
      if (rafSeekRef.current) {
        cancelAnimationFrame(rafSeekRef.current);
        rafSeekRef.current = null;
      }

      setIsDragging(false);
      setDragType(null);
      setDragClipId(null);
      setDragStartSnapshot(null);
      setDragPreviewX(null);
      setHoverInsertTime(null);
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

  const handleZoomIn = () => {
    setZoomLevel((prev) => Math.min(prev + 0.25, 3));
  };

  const handleZoomOut = () => {
    setZoomLevel((prev) => Math.max(prev - 0.25, 0.25));
  };

  const handleZoomReset = () => {
    setZoomLevel(1);
  };

  useEffect(() => {
    return () => {
      if (rafSeekRef.current) {
        cancelAnimationFrame(rafSeekRef.current);
        rafSeekRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
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
    const audioClips = updated.filter((c) => c.type === "audio");
    const layered = adjustAudioTracks(audioClips);
    const merged = updated.map((c) => {
      const layer = layered.find((a) => a.id === c.id);
      return layer ? { ...c, track: layer.track } : c;
    });
    if (onAutoLayerFix) onAutoLayerFix(merged);
  };

  function adjustAudioTracks(audioClips) {
    const sorted = [...audioClips].sort((a, b) => a.startTime - b.startTime);
    const layers = [];
    sorted.forEach((clip) => {
      let assigned = false;
      for (const layer of layers) {
        const lastClip = layer[layer.length - 1];
        if (clip.startTime >= lastClip.endTime) {
          layer.push(clip);
          assigned = true;
          break;
        }
      }
      if (!assigned) layers.push([clip]);
    });
    return layers.flatMap((layer, i) =>
      layer.map((clip) => ({ ...clip, track: i }))
    );
  }

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
              <span
                className={`text-xs text-gray-800 mt-2`}
                style={{ fontWeight: weight === "semibold" ? 600 : 500 }}
              >
                {i}s
              </span>
            )}
          </div>
        );
      }
    }
    return markers;
  };

  const selectedClip = clips.find((c) => c.id === selectedClipId) || null;

  // small helper to format duration for toolbar display
  const fmt = (n) => (Number.isFinite(n) ? `${Number(n).toFixed(1)}s` : "--");

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

          {/* Tracks visual guides */}
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

          {/* Drag preview ghost */}
          {isDragging && dragType === "move" && dragClipId && (
            <motion.div
              className="absolute z-40 pointer-events-none rounded-lg overflow-hidden shadow-lg opacity-70 border border-blue-400"
              style={{
                top: "20px",
                left: `${dragPreviewX - 80}px`,
                width: "160px",
                height: "60px",
                background: "#3b82f6",
                scale: 1.05,
              }}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 0.8, scale: 1.05 }}
              transition={{ type: "spring", stiffness: 120, damping: 18 }}
            >
              <div className="flex items-center justify-center h-full text-white text-sm font-medium">
                Moving...
              </div>
            </motion.div>
          )}

          {/* Drop indicator line */}
          {hoverInsertTime !== null && (
            <motion.div
              className="absolute top-0 bottom-0 w-[3px] bg-blue-500 z-30 rounded-full"
              animate={{ left: hoverInsertTime * pixelsPerSecond }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
            />
          )}

          {/* Clips rendering */}
          {clips.map((clip) => {
            const clipTimelineDuration =
              clip.duration - clip.trimStart - clip.trimEnd;
            if (clipTimelineDuration < MIN_CLIP_DURATION) {
              console.warn("Clip duration is too small:", clip.id);
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
            const thumb = clip.thumbnail;
            const thumbIsImage =
              !!thumb &&
              typeof thumb === "string" &&
              (thumb.startsWith("data:image/") ||
                /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i.test(thumb));

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
                ref={(el) => {
                  if (el) clipRefs.current.set(clip.id, el);
                  else clipRefs.current.delete(clip.id);
                }}
                onMouseDown={(e) => handleClipMouseDown(e, clip, "move")}
                onContextMenu={(e) => {
                  // right-click -> show stable toolbar (not following clip)
                  showToolbarForClip(clip, e);
                }}
              >
                {/* visuals */}
                {(() => {
                  if (clip.type === "image") {
                    return thumb ? (
                      <img
                        src={thumb}
                        alt="clip"
                        className="w-full h-full object-cover absolute inset-0 rounded-xl"
                      />
                    ) : (
                      <div className="w-full h-full bg-gray-600 flex items-center justify-center rounded-xl text-white">
                        Loading...
                      </div>
                    );
                  }
                  if (clip.type === "video") {
                    return thumbIsImage ? (
                      <img
                        src={thumb}
                        alt="video thumbnail"
                        className="w-full h-full object-cover absolute inset-0 rounded-xl"
                      />
                    ) : (
                      <div className="w-full h-full bg-gray-600 flex items-center justify-center rounded-xl text-white">
                        Loading...
                      </div>
                    );
                  }
                  return (
                    <div className="w-full h-full bg-blue-400/80 absolute inset-0 rounded-xl"></div>
                  );
                })()}

                {/* waveform for audio */}
                {clip.type === "audio" && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center p-2">
                    <AudioClipWaveform
                      audioUrl={clip.url}
                      duration={clip.duration}
                      width={clipWidth}
                      height={clipHeight - 10}
                      progress={
                        clipTimelineDuration > 0
                          ? Math.max(
                              0,
                              Math.min(
                                1,
                                (currentTime - clip.startTime) /
                                  clipTimelineDuration
                              )
                            )
                          : 0
                      }
                      isSelected={isSelected}
                      trimStart={clip.trimStart}
                      trimEnd={clip.trimEnd}
                      color="#FFFFFF"
                    />
                  </div>
                )}

                <div className="absolute bottom-1 left-2 bg-black/80 text-white text-[11px] px-2 py-1 rounded-md font-semibold z-30">
                  {clipTimelineDuration.toFixed(1)}s
                </div>

                <div className="absolute top-1 left-2 text-white text-xs font-medium z-30">
                  {clip.fileName?.substring(0, 15)}
                </div>

                {/* Trim handles (selected only) */}
                {isSelected && (
                  <>
                    <div
                      className="absolute top-0 bottom-0 -left-[4px] w-[8px] bg-blue-500 cursor-col-resize z-40 opacity-90 hover:opacity-100 transition-opacity"
                      onMouseDown={(e) =>
                        handleClipMouseDown(e, clip, "trim-left")
                      }
                    >
                      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-1 h-4 bg-white rounded-full"></div>
                    </div>
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

                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors rounded-xl z-0"></div>
              </div>
            );
          })}

          {/* Stable portal-mounted toolbar (appears only when toolbarVisible) */}
          {toolbarVisible &&
          toolbarPagePos &&
          toolbarClip &&
          typeof document !== "undefined"
            ? createPortal(
                <div
                  ref={toolbarRef}
                  style={{
                    position: "absolute",
                    left: `${toolbarPagePos.left}px`,
                    top: `${toolbarPagePos.top}px`,
                    transform: "translate(-50%, -100%)",
                    zIndex: 99999,
                    pointerEvents: "auto",
                  }}
                >
                  <ClipToolbar
                    clip={toolbarClip}
                    pos={toolbarPagePos}
                    onDelete={(id) => {
                      onDelete(id);
                      hideToolbar();
                    }}
                    onSplit={(id, atTime) => {
                      // prefer splitting at playhead; ClipToolbar already calculates but pass through
                      onSplitClip(
                        id,
                        typeof atTime === "number" ? atTime : currentTime
                      );
                      hideToolbar();
                    }}
                    onChangeVolume={(id, v) => {
                      // forward event to parent; parent must update clip state
                      onChangeVolume && onChangeVolume(id, v);
                      // keep open (ClipToolbar has debounce)
                    }}
                    onChangeSpeed={(id, r) => {
                      onChangeSpeed && onChangeSpeed(id, r);
                    }}
                    playheadTime={currentTime}
                  />
                </div>,
                document.body
              )
            : null}
        </div>
      </div>
    </div>
  );
}

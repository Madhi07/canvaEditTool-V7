// pages/index.js
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import VideoPlayer from "../components/VideoPlayer";
import Timeline from "../components/Timeline";
import MediaUploader from "../components/MediaUploader";
import { Toolbar } from "../components/Toolbar";
import {
  extractThumbnailFromVideo,
  getImageThumbnail,
} from "../utils/thumbnailExtractor";
import AudioPlayer from "../components/AudioPlayer";

export default function Home() {
  const [clips, setClips] = useState([
    {
      id: "default-clip",
      type: "video",
      url: "/parameters_example.mp4", // default demo video in /public
      fileName: "parameters_example.mp4",
      mimeType: "video/mp4",
      duration: 10,
      startTime: 0,
      endTime: 10,
      trimStart: 0,
      trimEnd: 0,
      hasAudio: true,
      thumbnail: null,
      track: 0,
    },
  ]);

  const [selectedClipId, setSelectedClipId] = useState("default-clip");
  const [currentTime, setCurrentTime] = useState(0); // seconds (global timeline time)
  const [isPlaying, setIsPlaying] = useState(false);
  const [totalDuration, setTotalDuration] = useState(10);
  const [videoZoom, setVideoZoom] = useState(1);
  const [seekAudio, setSeekAudio] = useState(0);
  const EPS = 0.001;
  const justSeekedIntoImageRef = useRef(false);
  const clipsRef = useRef(clips);
  useEffect(() => {
    clipsRef.current = clips;
  }, [clips]);

  // If you want to call methods on AudioPlayer you can add a ref and wire methods there
  const audioPlayerRef = useRef(null);

  // placeholder: central stop all audio hook — connect into AudioPlayer if needed
  const stopAllAudio = useCallback(() => {
    // If your AudioPlayer exposes a stopAll method, call it via ref here:
    audioPlayerRef.current?.stopAll?.();
    // For now just ensure playback flag false
    // setIsPlaying(false);
  }, []);

  // Load default video metadata + thumbnail for default clip
  useEffect(() => {
    const defaultClip = clips.find((c) => c.id === "default-clip");
    if (!defaultClip) return;

    const loadDefaultMetadata = async () => {
      try {
        const video = document.createElement("video");
        video.src = defaultClip.url;
        video.crossOrigin = "anonymous";

        video.onloadedmetadata = async () => {
          const durationSec = video.duration;

          let thumbnail = null;
          try {
            const response = await fetch(defaultClip.url);
            const blob = await response.blob();
            thumbnail = await extractThumbnailFromVideo(blob, 1);
            if (thumbnail) new Image().src = thumbnail;
          } catch (err) {
            console.warn("⚠️ Failed to extract default video thumbnail:", err);
          }

          setClips((prev) =>
            prev.map((c) =>
              c.id === "default-clip"
                ? {
                    ...c,
                    duration: durationSec,
                    endTime: durationSec,
                    thumbnail,
                  }
                : c
            )
          );
          setTotalDuration(durationSec);
        };
      } catch (err) {
        console.error("Failed to load default video metadata:", err);
      }
    };

    loadDefaultMetadata();
  }, []);

  // Auto-calculate total timeline duration (visuals only)
  useEffect(() => {
    if (!clips.length) return;

    const visualClips = clips.filter(
      (c) => c.type === "video" || c.type === "image"
    );
    const maxVisualEnd =
      visualClips.length > 0
        ? Math.max(...visualClips.map((c) => c.endTime))
        : 0;

    setTotalDuration(maxVisualEnd);
  }, [clips]);

  // Handle clip end: move to next visual or stop
  const handleClipEnd = useCallback(
    (endedClipId) => {
      const visualClips = clipsRef.current
        .filter((c) => c.type === "video" || c.type === "image")
        .sort((a, b) => a.startTime - b.startTime);

      const idx = visualClips.findIndex((c) => c.id === endedClipId);

      if (idx !== -1 && idx < visualClips.length - 1) {
        const nextClip = visualClips[idx + 1];

        setSelectedClipId(nextClip.id);
        // Nudge into the clip to avoid falling on boundary
        const startInside =
          nextClip.type === "image"
            ? nextClip.startTime + EPS
            : nextClip.startTime;
        setCurrentTime(startInside);

        if (isPlaying) setTimeout(() => setIsPlaying(true), 50);
      } else {
        setIsPlaying(false);
        stopAllAudio();
      }
    },
    [isPlaying, stopAllAudio]
  );

  // Media upload (video/image/audio)
  const handleMediaUpload = async (file, type) => {
    const url = URL.createObjectURL(file);

    const getDuration = () =>
      new Promise((resolve) => {
        if (type === "image") return resolve(3);
        const media =
          type === "video"
            ? document.createElement("video")
            : document.createElement("audio");
        media.src = url;
        media.onloadedmetadata = () => resolve(media.duration || 0);
      });

    const duration = await getDuration();

    let startTime = 0;
    let track = 0;
    if (type === "video" || type === "image") {
      const visualClips = clipsRef.current.filter(
        (c) => c.type === "video" || c.type === "image"
      );
      startTime =
        visualClips.length > 0
          ? Math.max(...visualClips.map((c) => c.endTime))
          : 0;
      track = 0;
    } else if (type === "audio") {
      const audioClips = clipsRef.current.filter((c) => c.type === "audio");
      startTime =
        audioClips.length > 0
          ? Math.max(...audioClips.map((c) => c.endTime))
          : 0;

      // Find the lowest free audio track (layering)
      const usedTracks = new Set(audioClips.map((c) => c.track));
      let nextTrack = 0;
      while (usedTracks.has(nextTrack)) nextTrack++;
      track = nextTrack;
    }

    let thumbnail = null;
    try {
      if (type === "video")
        thumbnail = await extractThumbnailFromVideo(file, 1);
      else if (type === "image") thumbnail = await getImageThumbnail(file);
      if (thumbnail) new Image().src = thumbnail;
    } catch (error) {
      console.error("Thumbnail extraction failed:", error);
    }

    const newClip = {
      id: `clip-${Date.now()}`,
      type,
      url,
      fileName: file.name,
      mimeType: file.type || (type === "audio" ? "audio/mpeg" : "video/mp4"),
      duration,
      startTime,
      endTime: startTime + duration,
      trimStart: 0,
      trimEnd: 0,
      hasAudio: type === "video" || type === "audio",
      thumbnail,
      track,
    };

    setClips((prev) => fixAudioTrackLayers([...prev, newClip]));

    if (!selectedClipId) setSelectedClipId(newClip.id);
  };

  // Split audio clip
  const handleSplitAudio = (clipId, splitTime) => {
    setClips((prevClips) => {
      const updated = [...prevClips];
      const index = updated.findIndex((c) => c.id === clipId);
      if (index === -1) return updated;

      const clip = updated[index];

      if (
        splitTime <= clip.startTime + 0.05 ||
        splitTime >= clip.endTime - 0.05
      )
        return updated;

      const totalVisibleDuration =
        clip.duration - clip.trimStart - clip.trimEnd;
      const splitOffset = splitTime - clip.startTime;
      const splitRelative = clip.trimStart + splitOffset;

      const firstPart = {
        ...clip,
        id: `${clip.id}-part1-${Date.now()}`,
        endTime: splitTime,
        trimStart: clip.trimStart,
        trimEnd: clip.duration - splitRelative,
      };

      const secondPart = {
        ...clip,
        id: `${clip.id}-part2-${Date.now()}`,
        startTime: splitTime,
        trimStart: splitRelative,
        trimEnd: clip.trimEnd,
      };

      updated.splice(index, 1, firstPart, secondPart);
      return updated;
    });
  };

  // Arrange overlapping audio tracks into layers (track numbers)
  const fixAudioTrackLayers = (clipsArr) => {
    const audioClips = clipsArr.filter((c) => c.type === "audio");
    const sorted = [...audioClips].sort((a, b) => a.startTime - b.startTime);
    const layers = [];

    sorted.forEach((clip) => {
      let placed = false;
      for (const layer of layers) {
        const last = layer[layer.length - 1];
        if (clip.startTime >= last.endTime) {
          layer.push(clip);
          placed = true;
          break;
        }
      }
      if (!placed) layers.push([clip]);
    });

    const layered = layers.flatMap((layer, i) =>
      layer.map((clip) => ({ ...clip, track: i }))
    );

    return clipsArr.map((c) => {
      const match = layered.find((a) => a.id === c.id);
      return match ? { ...c, track: match.track } : c;
    });
  };

  const handleAutoLayerFix = (updatedClips) => {
    const fixed = fixAudioTrackLayers(updatedClips);
    setClips(fixed);
  };

  const handleClipUpdate = (clipId, updates) => {
    setClips((prev) => {
      const target = prev.find((c) => c.id === clipId);
      if (!target) return prev;

      // Apply the field updates
      const updated = prev.map((c) =>
        c.id === clipId ? { ...c, ...updates } : c
      );

    
      const affectsTimeline =
        updates.startTime !== undefined ||
        updates.trimStart !== undefined ||
        updates.trimEnd !== undefined;

      const shouldReflow = target.type === "video" && affectsTimeline;

      return shouldReflow ? autoReflowClips(updated) : updated;
    });
  };

  const handleClipSelect = (clip) => {
    setSelectedClipId(clip.id);
    setCurrentTime(clip.startTime);
    setIsPlaying(false);
    stopAllAudio();
    setSeekAudio((t) => t + 1);
  };
  const activeVisualType = (() => {
    const visual = clips
      .filter((c) => c.type === "video" || c.type === "image")
      .find((c) => currentTime >= c.startTime && currentTime < c.endTime);
    return visual?.type; // 'image' | 'video' | undefined
  })();

  const handleSeek = (time, clipId = null) => {
    const wasPlaying = isPlaying;
    const clamped = Math.max(0, Math.min(time, totalDuration - EPS));

    // Figure out which visual we’re seeking into
    const visuals = clipsRef.current
      .filter((c) => c.type === "video" || c.type === "image")
      .sort((a, b) => a.startTime - b.startTime);

    let targetClip = clipId
      ? clipsRef.current.find((c) => c.id === clipId)
      : visuals.find(
          (c) => clamped >= c.startTime - EPS && clamped < c.endTime - EPS
        );

    // If we land on an IMAGE, nudge slightly inside the window and set the rAF guard
    if (targetClip && targetClip.type === "image") {
      const inside = Math.min(
        targetClip.endTime - EPS,
        Math.max(targetClip.startTime + EPS, clamped)
      );
      justSeekedIntoImageRef.current = true;
      setCurrentTime(inside);
    } else {
      justSeekedIntoImageRef.current = false;
      setCurrentTime(clamped);
    }

    if (clipId) {
      setSelectedClipId(clipId);
      const clickedClip = clipsRef.current.find((c) => c.id === clipId);
      if (clickedClip)
        console.log(`Seeked inside clip: ${clickedClip.fileName}`);
    }

    // Stop audio immediately, then force re-seek
    audioPlayerRef.current?.stopAll?.();
    setSeekAudio((t) => t + 1);

    // Resume only if we were playing pre-seek
    if (wasPlaying) setTimeout(() => setIsPlaying(true), 50);
  };

  const handlePlayPause = () => setIsPlaying((prev) => !prev);

  // Time update from the visual player (maps local clip time -> global timeline)
  const handleTimeUpdate = (timeSec, clipId) => {
    const currentClip = clipsRef.current.find((c) => c.id === clipId);
    if (!currentClip || !isPlaying) return;

    const relativeTime = Math.max(0, timeSec - currentClip.trimStart);
    const globalTime = currentClip.startTime + relativeTime;

    const epsilon = 0.05; // 50ms tolerance to avoid stopping early

    if (globalTime < currentClip.endTime - epsilon) {
      setCurrentTime(globalTime);
    } else if (globalTime >= currentClip.endTime - epsilon && isPlaying) {
      // Snap exactly to the clip’s end and trigger stop
      setCurrentTime(currentClip.endTime);
      handleClipEnd(currentClip.id);
    }
  };

  // Find current visual clip and return data for VideoPlayer
  const getCurrentClip = useCallback(() => {
    const visualClips = clips
      .filter((c) => c.type === "video" || c.type === "image")
      .sort((a, b) => a.startTime - b.startTime);

    // inclusive start, exclusive end with epsilon guards
    let activeClip = visualClips.find(
      (c) => currentTime >= c.startTime - EPS && currentTime < c.endTime - EPS
    );

    // If we're exactly at the very end, snap to the last visual
    if (
      !activeClip &&
      currentTime >= totalDuration - EPS &&
      visualClips.length
    ) {
      activeClip = visualClips[visualClips.length - 1];
    }
    if (!activeClip) return null;

    const relativeTime = Math.max(
      0,
      currentTime - activeClip.startTime + activeClip.trimStart
    );
    const maxRel =
      activeClip.duration - activeClip.trimStart - activeClip.trimEnd;
    const clampedRelativeTime = Math.min(
      relativeTime,
      Math.max(0, maxRel - EPS)
    );

    return {
      id: activeClip.id,
      url: activeClip.url,
      type: activeClip.type,
      startTime: activeClip.startTime,
      relativeTime: clampedRelativeTime,
      hasAudio: activeClip.hasAudio,
    };
  }, [currentTime, clips, totalDuration]);

  // Ensure at least one clip selected
  useEffect(() => {
    if (clips.length && !selectedClipId) {
      setSelectedClipId(clips[0].id);
    }
  }, [clips, selectedClipId]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = (e.target.tagName || "").toUpperCase();
      const isEditable =
        e.target.isContentEditable ||
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        tag === "BUTTON";

      if (isEditable) return; // don't hijack typing

      if (e.code === "Space") {
        e.preventDefault();
        handlePlayPause();
        return;
      }

      if (e.code === "ArrowLeft") {
        e.preventDefault();
        const newTime = Math.max(0, currentTime - 1);
        handleSeek(newTime);
        return;
      }

      if (e.code === "ArrowRight") {
        e.preventDefault();
        const newTime = Math.min(totalDuration, currentTime + 1);
        handleSeek(newTime);
        return;
      }

      if ((e.code === "Delete" || e.code === "Backspace") && selectedClipId) {
        e.preventDefault();
        setClips((prev) => prev.filter((clip) => clip.id !== selectedClipId));
        setSelectedClipId(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [currentTime, totalDuration, selectedClipId]);

  // Automatically arrange visual clips sequentially (no gaps/overlaps)
  const autoReflowClips = (inputClips) => {
    const sorted = [...inputClips]
      .filter((c) => c.type === "video" || c.type === "image")
      .sort((a, b) => a.startTime - b.startTime);

    let curTime = 0;
    const adjusted = sorted.map((clip) => {
      const newStart = curTime;
      const clipLength = clip.duration - clip.trimStart - clip.trimEnd;
      const newEnd = newStart + clipLength;
      curTime = newEnd;

      return {
        ...clip,
        startTime: newStart,
        endTime: newEnd,
      };
    });

    const nonVisuals = inputClips.filter(
      (c) => c.type !== "video" && c.type !== "image"
    );
    return [...adjusted, ...nonVisuals];
  };

  // Image clip playback: drive timeline with rAF (stable, no skips)
  useEffect(() => {
    if (!isPlaying) return;

    let rafId;
    let last = performance.now();

    const tick = (now) => {
      let dt = (now - last) / 1000;

      // If we just sought into an image, zero out the first dt so we don't leap over it.
      if (justSeekedIntoImageRef.current) {
        justSeekedIntoImageRef.current = false;
        last = now;
        dt = 0;
      } else {
        // Cap dt to avoid big jumps after tab throttling (~60ms cap)
        if (dt > 0.06) dt = 0.06;
        last = now;
      }

      setCurrentTime((prev) => {
        const freshClips = clipsRef.current;

        const active = freshClips.find(
          (c) => prev >= c.startTime - EPS && prev < c.endTime - EPS
        );
        if (!active || active.type !== "image") return prev;

        const next = prev + dt;

        if (next >= active.endTime - EPS) {
          const nextClip = freshClips
            .filter((c) => c.type === "video" || c.type === "image")
            .sort((a, b) => a.startTime - b.startTime)
            .find((c) => c.startTime >= active.endTime - EPS);

          if (nextClip) {
            const startInside =
              nextClip.type === "image"
                ? nextClip.startTime + EPS
                : nextClip.startTime;
            // keep transport going if we were already playing
            setTimeout(() => setIsPlaying(true), 50);
            return startInside;
          } else {
            setIsPlaying(false);
            return active.endTime - EPS;
          }
        }

        return next;
      });

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, EPS, clipsRef]);

  // This preserves your "echo" behavior: multiple audio clips overlapping will all be active.
  const activeAudioClips = useMemo(() => {
    return clips
      .filter(
        (clip) =>
          clip.type === "audio" &&
          currentTime >= clip.startTime &&
          currentTime < Math.min(clip.endTime, totalDuration)
      )
      .sort((a, b) => (a.track ?? 0) - (b.track ?? 0));
  }, [clips, currentTime, totalDuration]);

  // Render
  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans flex flex-col items-center justify-center">
      <div className="container mx-auto px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-indigo-600">Video Editor</h1>
          <MediaUploader onMediaUpload={handleMediaUpload} />
        </div>

        {/* Player */}
        <div className="p-4">
          <VideoPlayer
            currentClip={getCurrentClip()}
            currentTime={currentTime}
            isPlaying={isPlaying}
            clips={clips}
            onPlayPause={handlePlayPause}
            onClipEnd={handleClipEnd}
            onTimeUpdate={handleTimeUpdate}
            duration={totalDuration}
            zoom={videoZoom}
          />
        </div>

        {/* Timeline */}
        <div className="p-4">
          <Timeline
            clips={clips}
            onSplitAudio={handleSplitAudio}
            currentTime={currentTime}
            totalDuration={totalDuration}
            onClipUpdate={handleClipUpdate}
            onClipSelect={handleClipSelect}
            onSeek={handleSeek}
            selectedClipId={selectedClipId}
            onAutoLayerFix={handleAutoLayerFix}
          />
        </div>

        {/* Audio player (hidden) - receives ALL overlapping audio clips */}
        <AudioPlayer
          // ref={audioPlayerRef} // optional: requires AudioPlayer to forwardRef if you want to call methods
          activeAudioClips={activeAudioClips}
          isPlaying={isPlaying}
          currentTime={currentTime}
          seekAudio={seekAudio}
          clips={clips}
          activeVisualType={activeVisualType}
        />

        {/* Toolbar */}
        <div className="rounded-xl bg-white p-4 shadow-md border border-gray-200 flex justify-between items-center">
          <Toolbar
            currentTime={currentTime}
            totalDuration={totalDuration}
            videoZoom={videoZoom}
            setVideoZoom={setVideoZoom}
          />
        </div>
      </div>
    </div>
  );
}

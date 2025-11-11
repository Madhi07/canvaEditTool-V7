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
      url: "/parameters_example.mp4",
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
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [totalDuration, setTotalDuration] = useState(10);
  const [videoZoom, setVideoZoom] = useState(1);
  const [seekAudio, setSeekAudio] = useState(0);
  const EPS = 0.002;
  const MAX_DT = 0.05;
  const justSeekedIntoImageRef = useRef(false);
  const clipsRef = useRef(clips);
  useEffect(() => {
    clipsRef.current = clips;
  }, [clips]);
  const lastVisualIdRef = useRef(null);
  const enteredImageRef = useRef(false);
  const totalDurationRef = useRef(totalDuration);
  useEffect(() => {
    totalDurationRef.current = totalDuration;
  }, [totalDuration]);

  // ---- new: track last manual selection so auto-select won't instantly override
  const lastManualSelectRef = useRef(0);

  const audioPlayerRef = useRef(null);

  const stopAllAudio = useCallback(() => {
    audioPlayerRef.current?.stopAll?.();
  }, []);

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

  const handleClipEnd = useCallback(
    (endedClipId) => {
      const visualClips = clipsRef.current
        .filter((c) => c.type === "video" || c.type === "image")
        .sort((a, b) => a.startTime - b.startTime);

      const idx = visualClips.findIndex((c) => c.id === endedClipId);

      if (idx !== -1 && idx < visualClips.length - 1) {
        const nextClip = visualClips[idx + 1];

        setSelectedClipId(nextClip.id);
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
      const updated = prev.map((c) =>
        c.id === clipId ? { ...c, ...updates } : c
      );

      const affectsTimeline =
        updates.startTime !== undefined ||
        updates.trimStart !== undefined ||
        updates.trimEnd !== undefined;

      const isVisual =
        target && (target.type === "video" || target.type === "image");

      return affectsTimeline && isVisual ? autoReflowClips(updated) : updated;
    });
  };

  const handleClipSelect = (clip) => {
    setSelectedClipId(clip.id);
    setCurrentTime(clip.startTime);
    setIsPlaying(false);
    stopAllAudio();
    setSeekAudio((t) => t + 1);
    // record manual selection time so auto-select won't override immediately
    lastManualSelectRef.current = performance.now();
  };
  const activeVisualType = (() => {
    const visual = clips
      .filter((c) => c.type === "video" || c.type === "image")
      .find((c) => currentTime >= c.startTime && currentTime < c.endTime);
    return visual?.type;
  })();

  const handleSeek = (time, clipId = null) => {
    const wasPlaying = isPlaying;
    const clamped = Math.max(0, Math.min(time, totalDuration - EPS));

    const visuals = clipsRef.current
      .filter((c) => c.type === "video" || c.type === "image")
      .sort((a, b) => a.startTime - b.startTime);

    let targetClip = clipId
      ? clipsRef.current.find((c) => c.id === clipId)
      : visuals.find(
          (c) => clamped >= c.startTime - EPS && clamped < c.endTime - EPS
        );

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

    audioPlayerRef.current?.stopAll?.();
    setSeekAudio((t) => t + 1);

    if (wasPlaying) setTimeout(() => setIsPlaying(true), 50);
  };

  const handlePlayPause = () => setIsPlaying((prev) => !prev);

  // --- IMPORTANT CHANGE: ignore video timeupdate updates when clip is not a video
  const handleTimeUpdate = (timeSec, clipId) => {
    const currentClip = clipsRef.current.find((c) => c.id === clipId);
    if (!currentClip || !isPlaying) return;

    // **NEW GUARD**: protect against stray timeupdate events from video frames
    // that can race and move the timeline while we're trying to show an image.
    if (currentClip.type !== "video") {
      // If the player reported a timeupdate for a non-video clip (rare),
      // ignore it — the timeline for images is driven by requestAnimationFrame.
      return;
    }

    const relativeTime = Math.max(0, timeSec - currentClip.trimStart);
    const globalTime = currentClip.startTime + relativeTime;

    const epsilon = 0.05;

    if (globalTime < currentClip.endTime - epsilon) {
      setCurrentTime(globalTime);
    } else if (globalTime >= currentClip.endTime - epsilon && isPlaying) {
      setCurrentTime(currentClip.endTime);
      handleClipEnd(currentClip.id);
    }
  };

  const getCurrentClip = useCallback(() => {
    const visualClips = clips
      .filter((c) => c.type === "video" || c.type === "image")
      .sort((a, b) => a.startTime - b.startTime);

    let activeClip = visualClips.find(
      (c) => currentTime >= c.startTime - EPS && currentTime < c.endTime - EPS
    );

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

  useEffect(() => {
    if (clips.length && !selectedClipId) {
      setSelectedClipId(clips[0].id);
    }
  }, [clips, selectedClipId]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = (e.target.tagName || "").toUpperCase();
      const isEditable =
        e.target.isContentEditable ||
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        tag === "BUTTON";

      if (isEditable) return;

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

  useEffect(() => {
    if (!isPlaying) return;

    let rafId;
    let lastNow = performance.now();
    let running = true;

    const visualsSorted = () =>
      clipsRef.current
        .filter((c) => c.type === "video" || c.type === "image")
        .sort((a, b) => a.startTime - b.startTime);

    const findActiveAt = (t, visuals) =>
      visuals.find((c) => t >= c.startTime - EPS && t < c.endTime - EPS);

    const tick = (now) => {
      if (!running) return;

      let dt = (now - lastNow) / 1000;
      if (dt > MAX_DT) dt = MAX_DT;
      lastNow = now;

      setCurrentTime((prev) => {
        const visuals = visualsSorted();
        if (!visuals.length) return prev;

        const active = findActiveAt(prev, visuals);

        if (!active) {
          running = false;
          setIsPlaying(false);
          const end = Math.max(...visuals.map((c) => c.endTime));
          return end;
        }

        if (active.type !== "image") {
          enteredImageRef.current = false;
          lastVisualIdRef.current = active.id;
          return prev;
        }

        const firstTimeOnThisImage =
          lastVisualIdRef.current !== active.id || !enteredImageRef.current;
        if (firstTimeOnThisImage) {
          enteredImageRef.current = true;
          lastVisualIdRef.current = active.id;
          return Math.max(prev, active.startTime + EPS);
        }

        const nextT = prev + dt;
        const imgEnd = active.endTime - EPS;

        if (nextT < imgEnd) return nextT;

        const idx = visuals.findIndex((c) => c.id === active.id);
        if (idx >= 0 && idx < visuals.length - 1) {
          const nxt = visuals[idx + 1];
          enteredImageRef.current = false;
          lastVisualIdRef.current = nxt.id;
          return nxt.type === "image" ? nxt.startTime + EPS : nxt.startTime;
        }

        running = false;
        setIsPlaying(false);
        return active.endTime;
      });

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [isPlaying]);

  // --- NEW: auto-select active visual clip but respect recent manual clicks
  useEffect(() => {
    const MANUAL_GRACE_MS = 400;

    const visualClips = clips
      .filter((c) => c.type === "video" || c.type === "image")
      .sort((a, b) => a.startTime - b.startTime);

    const active = visualClips.find(
      (c) => currentTime >= c.startTime - EPS && currentTime < c.endTime - EPS
    );

    if (!active) return;

    const sinceManual = performance.now() - (lastManualSelectRef.current || 0);
    if (sinceManual < MANUAL_GRACE_MS) return;

    if (active.id !== selectedClipId) {
      setSelectedClipId(active.id);
    }
  }, [currentTime, clips, selectedClipId, EPS]);

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

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans flex flex-col items-center justify-center">
      <div className="container mx-auto px-6 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-indigo-600">Video Editor</h1>
          <MediaUploader onMediaUpload={handleMediaUpload} />
        </div>

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
            onRequestSeek={handleSeek}
          />
        </div>

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

        <AudioPlayer
          activeAudioClips={activeAudioClips}
          isPlaying={isPlaying}
          currentTime={currentTime}
          seekAudio={seekAudio}
          clips={clips}
          activeVisualType={activeVisualType}
        />

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

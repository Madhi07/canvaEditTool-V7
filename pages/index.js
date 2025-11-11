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

import ClipsData from "../constant/data";

async function fetchExternalClips() {
  try {
    const resp = await fetch("/api/clips");
    if (!resp.ok) return [];
    const data = await resp.json();
    return data?.clips || [];
  } catch (err) {
    console.debug("failed to load external clips:", err);
    return [];
  }
}

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

  // ---------- DEFAULT CLIP METADATA LOADER
  // Skip loading/updating default clip if external visuals exist.
  useEffect(() => {
    // Determine if external visuals exist from ClipsData or marked clips
    const externalHasVisuals = (() => {
      try {
        if (ClipsData) {
          const dataEntry =
            Array.isArray(ClipsData) && ClipsData.length
              ? ClipsData.find((d) => Array.isArray(d.slides)) || ClipsData[0]
              : ClipsData;
          const slides = Array.isArray(dataEntry?.slides)
            ? dataEntry.slides
            : Array.isArray(ClipsData) && ClipsData.every((s) => s && (s.image || s.image_url || s.url))
            ? ClipsData
            : null;
          if (slides && slides.length) return true;
        }
      } catch (e) {
        // ignore
      }
      // runtime flag: if clips already contain non-default visual items that came from remote
      const existingVisualsFromExternal = clips.some(
        (c) => (c.type === "image" || c.type === "video") && c.externalSource
      );
      return !!existingVisualsFromExternal;
    })();

    if (externalHasVisuals) {
      // skip default video load since external visuals exist
      return;
    }

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
  }, []); // run once on mount

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

  // -----------------------
  // ADAPTER: map ClipsData -> app clips and REPLACE existing clips
  // - converts slides to image + audio clips
  // - attempts to read remote audio durations (but will fall back to slide duration)
  // - REPLACES current clips so default-clip does not show when external data exists
  // -----------------------

  const getRemoteAudioDuration = (url, fallback = null) =>
    new Promise((resolve) => {
      if (!url) return resolve(fallback);
      try {
        const a = new Audio();
        a.src = url;
        a.preload = "metadata";

        const onMeta = () => {
          const d = isFinite(a.duration) && a.duration > 0 ? a.duration : fallback;
          cleanup();
          resolve(d);
        };
        const onErr = () => {
          cleanup();
          resolve(fallback);
        };
        const cleanup = () => {
          a.removeEventListener("loadedmetadata", onMeta);
          a.removeEventListener("error", onErr);
          try {
            a.src = "";
          } catch (e) {}
        };

        a.addEventListener("loadedmetadata", onMeta);
        a.addEventListener("error", onErr);

        // safety timeout
        setTimeout(() => {
          cleanup();
          resolve(fallback);
        }, 3000);
      } catch (err) {
        resolve(fallback);
      }
    });

  useEffect(() => {
    let cancelled = false;

    const buildAndReplaceClipsFromClipsData = async () => {
      if (!ClipsData) return;

      // Determine slides array: support multiple shapes (array of entries with slides, or top-level slides)
      const dataEntry =
        Array.isArray(ClipsData) && ClipsData.length
          ? ClipsData.find((d) => Array.isArray(d.slides)) || ClipsData[0]
          : ClipsData;
      if (!dataEntry) return;

      const slides = Array.isArray(dataEntry.slides)
        ? dataEntry.slides
        : Array.isArray(ClipsData) && ClipsData.every((s) => s && (s.image || s.image_url || s.url))
        ? ClipsData
        : null;
      if (!slides || !slides.length) return;

      // Fetch audio durations in parallel (with fallback)
      const audioDurationPromises = slides.map((s) =>
        s?.audio?.audio_url
          ? getRemoteAudioDuration(s.audio.audio_url, Number(s?.image?.duration) || 3)
          : Promise.resolve(null)
      );

      const audioDurations = await Promise.all(audioDurationPromises);

      // Build newClips, laid out sequentially from start=0
      const newClips = [];
      let visualCursor = 0;

      for (let i = 0; i < slides.length; i++) {
        const slide = slides[i];
        const imageObj = slide.image || {};
        const audioObj = slide.audio || {};

        // support alternate shapes: slide.image_url or slide.imageUrl
        const imageUrl = imageObj.image_url || slide.image_url || slide.imageUrl || null;
        const visualDuration = Number(imageObj.duration || slide.duration) || 3;
        const visualId =
          slide.uuid || `visual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const visualStart = visualCursor;
        const visualEnd = visualStart + visualDuration;

        const visualClip = {
          id: visualId,
          type: "image",
          url: imageUrl || "",
          fileName: imageUrl ? imageUrl.split("/").pop() : `image-${visualId}`,
          mimeType: imageUrl?.endsWith(".png") ? "image/png" : "image/jpeg",
          duration: visualDuration,
          startTime: visualStart,
          endTime: visualEnd,
          trimStart: 0,
          trimEnd: 0,
          hasAudio: !!(audioObj && audioObj.audio_url),
          thumbnail: imageUrl || null,
          track: 0,
        };
        newClips.push(visualClip);

        if (audioObj && audioObj.audio_url) {
          const audioDur = audioDurations[i] || visualDuration;
          const audioClip = {
            id: `${audioObj.uuid || visualId}-audio`,
            type: "audio",
            url: audioObj.audio_url,
            fileName: audioObj.audio_url.split("/").pop(),
            mimeType: "audio/mpeg",
            duration: audioDur,
            startTime: visualStart,
            endTime: visualStart + audioDur,
            trimStart: 0,
            trimEnd: 0,
            hasAudio: true,
            thumbnail: null,
            track: 0, // will be fixed by fixAudioTrackLayers
          };
          newClips.push(audioClip);
        }

        visualCursor = visualEnd;
      }

      if (cancelled) return;
      if (!newClips.length) return;

      // REPLACE existing clips entirely with generated clips (no default-clip)
      setClips(() => {
        const marked = newClips.map((c) => ({ ...c, externalSource: true }));
        return fixAudioTrackLayers(marked);
      });

      // ensure selection and total duration update
      setTimeout(() => {
        const allClipsNow = clipsRef.current;
        const firstVisual = allClipsNow.find((c) => c.type === "image" || c.type === "video");
        if (firstVisual) {
          setSelectedClipId((prev) => prev || firstVisual.id);
          const maxVisualEnd = Math.max(
            ...allClipsNow.filter((c) => c.type === "video" || c.type === "image").map((c) => c.endTime)
          );
          setTotalDuration((prev) => Math.max(prev, maxVisualEnd || 0));
        }
      }, 50);
    };

    // Run the builder once on mount
    buildAndReplaceClipsFromClipsData();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once

  // -----------------------
  // end adapter
  // -----------------------

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

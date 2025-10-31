import { useState, useEffect, useCallback, useRef } from "react";
import VideoPlayer from "../components/VideoPlayer";
import Timeline from "../components/Timeline";
import MediaUploader from "../components/MediaUploader";
import { Toolbar } from "../components/Toolbar";
import {
  extractThumbnailFromVideo,
  getImageThumbnail,
} from "../utils/thumbnailExtractor";

// Enhanced audio element management with better sync
class AudioSyncManager {
  constructor() {
    this.audioElements = new Map();
    this.masterClock = 0;
    this.isPlaying = false;
    this.lastUpdateTime = 0;
    this.syncTolerance = 0.1; // 100ms tolerance
  }

  createAudioElement(clipId, url) {
    if (this.audioElements.has(clipId)) {
      return this.audioElements.get(clipId);
    }

    const audio = new Audio();
    audio.preload = "auto";
    audio.crossOrigin = "anonymous";
    audio.src = url;

    // Store metadata
    const elementData = {
      audio,
      clipId,
      url,
      isActive: false,
      lastSyncTime: 0,
      syncOffset: 0,
    };

    this.audioElements.set(clipId, elementData);
    return elementData;
  }

  // Synchronize audio with master timeline
  syncAudio(clipId, timelineTime, isPlaying, clipStartTime, clipTrimStart) {
    const elementData = this.audioElements.get(clipId);
    if (!elementData) return;

    const { audio } = elementData;
    const relativeTime = Math.max(
      0,
      timelineTime - clipStartTime + clipTrimStart
    );
    const isActive =
      timelineTime >= clipStartTime &&
      timelineTime < clipStartTime + audio.duration;

    elementData.isActive = isActive;

    if (isActive) {
      // Calculate desired audio position
      const desiredTime = relativeTime;
      const currentTime = audio.currentTime;
      const timeDiff = Math.abs(desiredTime - currentTime);

      // Sync if significantly out of sync
      if (timeDiff > this.syncTolerance) {
        audio.currentTime = Math.max(
          0,
          Math.min(desiredTime, audio.duration - 0.1)
        );
        elementData.lastSyncTime = timelineTime;
      }

      // Play/pause based on global state
      if (isPlaying && audio.paused) {
        audio.play().catch((e) => {
          console.warn(`Audio play failed for clip ${clipId}:`, e);
        });
      } else if (!isPlaying && !audio.paused) {
        audio.pause();
      }
    } else {
      // Not active, ensure paused
      if (!audio.paused) {
        audio.pause();
      }
    }
  }

  // Cleanup removed clips
  cleanupClips(activeClipIds) {
    for (const [clipId, elementData] of this.audioElements.entries()) {
      if (!activeClipIds.has(clipId)) {
        elementData.audio.pause();
        elementData.audio.src = "";
        this.audioElements.delete(clipId);
      }
    }
  }

  // Get all active audio clips at current time
  getActiveAudioClips(clips, timelineTime) {
    return clips.filter(
      (clip) =>
        clip.type === "audio" &&
        timelineTime >= clip.startTime &&
        timelineTime < clip.endTime
    );
  }

  // Stop all audio
  stopAll() {
    this.audioElements.forEach((elementData) => {
      if (!elementData.audio.paused) {
        elementData.audio.pause();
      }
    });
  }
}

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
      thumbnail: null, // will be generated
      track: 0,
    },
  ]);

  const [selectedClipId, setSelectedClipId] = useState("default-clip");
  const [currentTime, setCurrentTime] = useState(0); // seconds
  const [isPlaying, setIsPlaying] = useState(false);
  const [totalDuration, setTotalDuration] = useState(10);
  const [videoZoom, setVideoZoom] = useState(1);

  const clipsRef = useRef(clips);
  const audioSyncManager = useRef(new AudioSyncManager());

  useEffect(() => {
    clipsRef.current = clips;
  }, [clips]);

  // Load default video metadata + thumbnail
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

  // Auto-calculate total timeline duration
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

  // Enhanced clip end handler with better sync
  // Enhanced clip end handler with image continuation fix
  const handleClipEnd = useCallback(
    (endedClipId) => {
      const visualClips = clipsRef.current
        .filter((c) => c.type === "video" || c.type === "image")
        .sort((a, b) => a.startTime - b.startTime);

      const currentVisualIndex = visualClips.findIndex(
        (c) => c.id === endedClipId
      );

      if (
        currentVisualIndex !== -1 &&
        currentVisualIndex < visualClips.length - 1
      ) {
        const nextClip = visualClips[currentVisualIndex + 1];

        // Move to the next clip instantly
        setSelectedClipId(nextClip.id);
        setCurrentTime(nextClip.startTime);

        // ✅ Continue playback automatically if user was playing
        if (isPlaying) {
          setTimeout(() => setIsPlaying(true), 50);
        }
      } else {
        // End of timeline
        setIsPlaying(false);
        audioSyncManager.current.stopAll();
      }
    },
    [isPlaying]
  );

  // Enhanced media upload handler
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

      // Find the lowest free audio track
      const usedTracks = new Set(audioClips.map((c) => c.track));
      let nextTrack = 0;
      while (usedTracks.has(nextTrack)) {
        nextTrack++;
      }

      track = nextTrack;
    }

    let thumbnail = null;
    let waveformData = null;
    try {
      if (type === "video") {
        thumbnail = await extractThumbnailFromVideo(file, 1);
      } else if (type === "image") {
        thumbnail = await getImageThumbnail(file);
      }
      if (thumbnail) new Image().src = thumbnail;
    } catch (error) {
      console.error("Thumbnail extraction failed:", error);
    }

    const newClip = {
      id: `clip-${Date.now()}`,
      type,
      url,
      fileName: file.name,
      mimeType: file.type || "video/mp4",
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

    if (!selectedClipId) {
      setSelectedClipId(newClip.id);
    }
  };

  const handleSplitAudio = (clipId, splitTime) => {
    setClips((prevClips) => {
      const updated = [...prevClips];
      const index = updated.findIndex((c) => c.id === clipId);
      if (index === -1) return updated;

      const clip = updated[index];

      // Prevent invalid splits near the clip edges
      if (
        splitTime <= clip.startTime + 0.05 ||
        splitTime >= clip.endTime - 0.05
      )
        return updated;

      // 1️⃣ Find where we’re splitting inside the *original file*
      const totalVisibleDuration =
        clip.duration - clip.trimStart - clip.trimEnd;
      const splitOffset = splitTime - clip.startTime; // seconds from clip start
      const splitRelative = clip.trimStart + splitOffset; // position in the file

      // 2️⃣ Create the first clip (start → split)
      const firstPart = {
        ...clip,
        id: `${clip.id}-part1-${Date.now()}`,
        endTime: splitTime,
        // keep same full file duration
        trimStart: clip.trimStart,
        trimEnd: clip.duration - splitRelative, // amount remaining after split
      };

      // 3️⃣ Create the second clip (split → end)
      const secondPart = {
        ...clip,
        id: `${clip.id}-part2-${Date.now()}`,
        startTime: splitTime,
        trimStart: splitRelative,
        trimEnd: clip.trimEnd,
      };

      // 4️⃣ Replace the original with the two parts
      updated.splice(index, 1, firstPart, secondPart);

      return updated;
    });
  };

  const fixAudioTrackLayers = (clips) => {
    const audioClips = clips.filter((c) => c.type === "audio");
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

    // assign correct track numbers
    const layered = layers.flatMap((layer, i) =>
      layer.map((clip) => ({ ...clip, track: i }))
    );

    // merge back into full clip array
    return clips.map((c) => {
      const match = layered.find((a) => a.id === c.id);
      return match ? { ...c, track: match.track } : c;
    });
  };

  const handleAutoLayerFix = (updatedClips) => {
    const fixed = fixAudioTrackLayers(updatedClips);
    setClips(fixed);
  };

  // Timeline & Player handlers
  const handleClipUpdate = (clipId, updates) => {
    setClips((prev) => {
      const updated = prev.map((c) =>
        c.id === clipId ? { ...c, ...updates } : c
      );

      if (
        updates.trimStart !== undefined ||
        updates.trimEnd !== undefined ||
        updates.startTime !== undefined // added for moving
      ) {
        return autoReflowClips(updated);
      }

      return updated;
    });
  };

  const handleClipSelect = (clip) => {
    setSelectedClipId(clip.id);
    setCurrentTime(clip.startTime);
    setIsPlaying(false);
    audioSyncManager.current.stopAll();
  };

  const handleSeek = (time) => {
    setCurrentTime(time);
    setIsPlaying(false);
    audioSyncManager.current.stopAll();
  };

  const handlePlayPause = () => setIsPlaying((prev) => !prev);

  // Enhanced time update handler with better sync
  const handleTimeUpdate = (timeSec, clipId) => {
    const currentClip = clipsRef.current.find((c) => c.id === clipId);
    if (!currentClip || !isPlaying) return;

    // Correctly map local player time to global timeline time
    const relativeTime = Math.max(0, timeSec - currentClip.trimStart);
    const globalTime = currentClip.startTime + relativeTime;

    // Only update time if it's within the clip's bounds
    if (globalTime < currentClip.endTime) {
      setCurrentTime(globalTime);
    } else if (globalTime >= currentClip.endTime && isPlaying) {
      // Failsafe in case 'ended' event is missed
      handleClipEnd(currentClip.id);
    }
  };

  // Enhanced current clip getter
  const getCurrentClip = useCallback(() => {
    const visualClips = clips
      .filter((c) => c.type === "video" || c.type === "image")
      .sort((a, b) => a.startTime - b.startTime);

    let activeClip = visualClips.find(
      (c) => currentTime >= c.startTime && currentTime < c.endTime
    );

    if (!activeClip && currentTime >= totalDuration && visualClips.length > 0) {
      activeClip = visualClips[visualClips.length - 1];
    }

    if (!activeClip) return null;

    const relativeTime = Math.max(
      0,
      currentTime - activeClip.startTime + activeClip.trimStart
    );

    const maxRelativeTime =
      activeClip.duration - activeClip.trimStart - activeClip.trimEnd;
    const clampedRelativeTime = Math.min(relativeTime, maxRelativeTime);

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
      if (e.code === "Space" && e.target.tagName !== "INPUT") {
        e.preventDefault();
        handlePlayPause();
      } else if (e.code === "ArrowLeft" && e.target.tagName !== "INPUT") {
        e.preventDefault();
        const newTime = Math.max(0, currentTime - 1);
        handleSeek(newTime);
      } else if (e.code === "ArrowRight" && e.target.tagName !== "INPUT") {
        e.preventDefault();
        const newTime = Math.min(totalDuration, currentTime + 1);
        handleSeek(newTime);
      } else if (
        e.code === "Delete" &&
        selectedClipId &&
        e.target.tagName !== "INPUT"
      ) {
        e.preventDefault();
        setClips((prev) => prev.filter((clip) => clip.id !== selectedClipId));
        setSelectedClipId(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentTime, totalDuration, selectedClipId, clips]);

  // Enhanced audio synchronization with the new AudioSyncManager
  useEffect(() => {
    const activeAudioClips = audioSyncManager.current.getActiveAudioClips(
      clipsRef.current,
      currentTime
    );
    const activeClipIds = new Set(activeAudioClips.map((c) => c.id));

    // Clean up removed clips
    audioSyncManager.current.cleanupClips(activeClipIds);

    // Sync each active audio clip
    activeAudioClips.forEach((clip) => {
      audioSyncManager.current.createAudioElement(clip.id, clip.url);
      audioSyncManager.current.syncAudio(
        clip.id,
        currentTime,
        isPlaying,
        clip.startTime,
        clip.trimStart
      );
    });

    // Cleanup function
    return () => {
      // Cleanup is handled by AudioSyncManager
    };
  }, [clips, currentTime, isPlaying]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      audioSyncManager.current.stopAll();
    };
  }, []);

  // Automatically arrange clips sequentially (no gaps or overlaps)
  const autoReflowClips = (inputClips) => {
    const sorted = [...inputClips]
      .filter((c) => c.type === "video" || c.type === "image")
      .sort((a, b) => a.startTime - b.startTime);

    let currentTime = 0;
    const adjusted = sorted.map((clip) => {
      const newStart = currentTime;
      const clipLength = clip.duration - clip.trimStart - clip.trimEnd;
      const newEnd = newStart + clipLength;
      currentTime = newEnd;

      return {
        ...clip,
        startTime: newStart,
        endTime: newEnd,
      };
    });

    // Keep audio and other clips untouched
    const nonVisuals = inputClips.filter(
      (c) => c.type !== "video" && c.type !== "image"
    );

    return [...adjusted, ...nonVisuals];
  };

  // 🖼️ Handle image clip playback progression manually
  useEffect(() => {
    if (!isPlaying) return;

    const activeClip = clips.find(
      (clip) => currentTime >= clip.startTime && currentTime < clip.endTime
    );
    if (!activeClip || activeClip.type !== "image") return;

    // Smooth time progression for image clips
    const interval = setInterval(() => {
      setCurrentTime((prev) => {
        const next = prev + 0.05; // roughly 20 FPS (0.05s steps)
        if (next >= activeClip.endTime) {
          clearInterval(interval);

          // Move to the next clip
          const nextClip = clips.find((c) => c.startTime >= activeClip.endTime);
          if (nextClip) {
            setCurrentTime(nextClip.startTime);
          } else {
            setIsPlaying(false);
          }
        }
        return next;
      });
    }, 50);

    return () => clearInterval(interval);
  }, [isPlaying, currentTime, clips]);

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

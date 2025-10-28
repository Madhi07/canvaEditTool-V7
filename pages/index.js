import { useState, useEffect, useCallback, useRef } from "react";
import VideoPlayer from "../components/VideoPlayer";
import Timeline from "../components/Timeline";
import MediaUploader from "../components/MediaUploader";
import { Toolbar } from "../components/Toolbar";
import {
  extractThumbnailFromVideo,
  getImageThumbnail,
} from "../utils/thumbnailExtractor";

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
  const audioElementsRef = useRef({});

  useEffect(() => {
    clipsRef.current = clips;
  }, [clips]);

  // Load default video metadata + thumbnail (Unchanged)
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

  // Auto-calculate total timeline duration (Unchanged)
  // ✅ Only calculate totalDuration from video & image clips
  useEffect(() => {
    if (!clips.length) return;

    const visualClips = clips.filter(
      (c) => c.type === "video" || c.type === "image"
    );

    const maxVisualEnd =
      visualClips.length > 0
        ? Math.max(...visualClips.map((c) => c.endTime))
        : 0;

    setTotalDuration(maxVisualEnd); // 👈 Only visual clips count
  }, [clips]);

  // ✅ [FIX] handleClipEnd now only advances between VISUAL clips
  const handleClipEnd = useCallback((endedClipId) => {
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

      // Switch to the next visual clip
      setSelectedClipId(nextClip.id);
      setCurrentTime(nextClip.startTime);
      setIsPlaying(true);
    } else {
      // No more visual clips — stop playback
      setIsPlaying(false);
    }
  }, []);

  // Upload handler (Unchanged)
  const handleMediaUpload = async (file, type) => {
    const url = URL.createObjectURL(file);

    const getDuration = () =>
      new Promise((resolve) => {
        if (type === "image") return resolve(5);
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

      // ✅ Find the lowest free audio track (starting from 0)
      const usedTracks = new Set(audioClips.map((c) => c.track));
      let nextTrack = 0;
      while (usedTracks.has(nextTrack)) {
        nextTrack++;
      }

      track = nextTrack; // e.g., first audio clip → track 0
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
      if (splitTime <= clip.startTime || splitTime >= clip.endTime)
        return updated;

      const firstPart = {
        ...clip,
        id: `${clip.id}-part1-${Date.now()}`,
        endTime: splitTime,
        duration: splitTime - clip.startTime,
        trimEnd: clip.trimStart + (splitTime - clip.startTime),
      };

      const secondPart = {
        ...clip,
        id: `${clip.id}-part2-${Date.now()}`,
        startTime: splitTime,
        duration: clip.endTime - splitTime,
        trimStart: clip.trimStart + (splitTime - clip.startTime),
      };

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

  // Timeline & Player handlers (Unchanged)
  const handleClipUpdate = (clipId, updates) =>
    setClips((prev) =>
      prev.map((c) => (c.id === clipId ? { ...c, ...updates } : c))
    );

  const handleClipSelect = (clip) => {
    setSelectedClipId(clip.id);
    setCurrentTime(clip.startTime);
    setIsPlaying(false);
  };

  const handleSeek = (time) => {
    setCurrentTime(time);
    setIsPlaying(false);
  };

  const handlePlayPause = () => setIsPlaying((prev) => !prev);

  // ✅ [FIX] handleTimeUpdate now uses the clipId from the player
  const handleTimeUpdate = (timeSec, clipId) => {
    // `clipId` is the ID of the clip *currently in the player*
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

  // ✅ [FIX] getCurrentClip is now based on currentTime, NOT selectedClipId
  const getCurrentClip = useCallback(() => {
    const visualClips = clips
      .filter((c) => c.type === "video" || c.type === "image")
      .sort((a, b) => a.startTime - b.startTime); // Ensure order for logic below

    // 1. Find the clip that is *currently* active
    let activeClip = visualClips.find(
      (c) => currentTime >= c.startTime && currentTime < c.endTime
    );

    // 2. If at the end, show the last frame of the last clip
    if (!activeClip && currentTime >= totalDuration && visualClips.length > 0) {
      activeClip = visualClips[visualClips.length - 1];
    }

    // 3. If no visual clips exist, or we're at the very start, return null
    if (!activeClip) return null;

    // Calculate relative time.
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

  // Ensure at least one clip selected (Unchanged)
  useEffect(() => {
    if (clips.length && !selectedClipId) {
      setSelectedClipId(clips[0].id);
    }
  }, [clips, selectedClipId]);

  // Keyboard shortcuts (Unchanged)
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

  // Audio track playback (Unchanged)
  useEffect(() => {
    const audioClips = clips.filter((c) => c.type === "audio");
    const activeAudioClips = audioClips.filter(
      (c) => currentTime >= c.startTime && currentTime < c.endTime
    );
    const activeAudioIds = new Set(activeAudioClips.map((c) => c.id));
    const allClipIds = new Set(clips.map((c) => c.id));

    const audioElements = audioElementsRef.current;

    // 1. Pause/Remove old/inactive clips
    Object.keys(audioElements).forEach((clipId) => {
      const audio = audioElements[clipId];
      if (!allClipIds.has(clipId)) {
        // Clip was deleted
        audio.pause();
        audio.src = "";
        delete audioElements[clipId];
      } else if (!activeAudioIds.has(clipId)) {
        // Clip is inactive, pause it
        if (!audio.paused) {
          audio.pause();
        }
      }
    });

    // 2. Play/Seek active clips
    activeAudioClips.forEach((clip) => {
      let audio = audioElements[clip.id];

      if (!audio) {
        audio = new Audio(clip.url);
        audio.preload = "auto";
        audioElements[clip.id] = audio;
      }

      const relativeTime = currentTime - clip.startTime + clip.trimStart;

      // Sync time if needed
      if (Math.abs(audio.currentTime - relativeTime) > 0.2) {
        if (audio.readyState >= 1) {
          const seekTime = Math.min(relativeTime, audio.duration - 0.1);
          audio.currentTime = Math.max(0, seekTime);
        } else {
          audio.onloadedmetadata = () => {
            const seekTime = Math.min(relativeTime, audio.duration - 0.1);
            audio.currentTime = Math.max(0, seekTime);
          };
        }
      }

      // Handle play/pause
      if (isPlaying && audio.paused) {
        audio.play().catch((e) => console.warn("Audio play failed", e));
      } else if (!isPlaying && !audio.paused) {
        audio.pause();
      }
    });

    // Cleanup on component unmount
    return () => {
      Object.values(audioElementsRef.current).forEach((audio) => {
        audio.pause();
        audio.src = "";
      });
      audioElementsRef.current = {};
    };
  }, [clips, currentTime, isPlaying]);

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

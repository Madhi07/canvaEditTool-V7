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
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState("default-clip");
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [totalDuration, setTotalDuration] = useState(10);
  const [videoZoom, setVideoZoom] = useState(1);
  const [seekAudio, setSeekAudio] = useState(0);
  const [externalClipsJson, setExternalClipsJson] = useState(() => {
    try {
      const base = Array.isArray(ClipsData) ? ClipsData : [ClipsData];
      if (typeof structuredClone === "function") return structuredClone(base);
      return JSON.parse(JSON.stringify(base));
    } catch {
      return Array.isArray(ClipsData) ? ClipsData : [ClipsData];
    }
  });

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

  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const MAX_HISTORY = 30;

  // safe deep clone helper
  const snapshotClips = (arr) => {
    try {
      return typeof structuredClone === "function"
        ? structuredClone(arr)
        : JSON.parse(JSON.stringify(arr));
    } catch {
      return arr.map((c) => ({ ...c }));
    }
  };

  // helper to compare two clips arrays for equality (lightweight)
  const areClipsEqual = (a, b) => {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  };

  // Wrapper around setClips to record history
  const updateClips = useCallback(
    (newClips) => {
      const currentSnapshot = snapshotClips(clipsRef.current || []);

      // avoid pushing duplicate consecutive history entries
      const lastHistory = undoStackRef.current.length
        ? undoStackRef.current[undoStackRef.current.length - 1]
        : null;
      if (!lastHistory || !areClipsEqual(lastHistory, currentSnapshot)) {
        undoStackRef.current.push(currentSnapshot);
        // cap history
        if (undoStackRef.current.length > MAX_HISTORY) {
          undoStackRef.current.shift();
        }
      }

      // clear redo stack on new action
      redoStackRef.current = [];

      // apply new state
      setClips(newClips);

      // update reactive booleans
      setCanUndo(undoStackRef.current.length > 0);
      setCanRedo(redoStackRef.current.length > 0);
    },
    [] // no deps; uses refs and setClips which are stable in this component
  );

  // ---- new: track last manual selection so auto-select won't instantly override
  const lastManualSelectRef = useRef(0);

  const audioPlayerRef = useRef(null);

  const stopAllAudio = useCallback(() => {
    audioPlayerRef.current?.stopAll?.();
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("editor-clips");
      if (raw) {
        const parsed = JSON.parse(raw);
        // ensure we only accept an array
        if (Array.isArray(parsed)) {
          setClips(parsed);
        }
      }
    } catch (err) {
      console.warn("Failed to load saved clips from localStorage:", err);
    }
    // run once on client mount
  }, []);

  // Save clips to localStorage on every change (debounce optional)
  useEffect(() => {
    try {
      localStorage.setItem("editor-clips", JSON.stringify(clips));
    } catch (err) {
      console.warn("Failed to save clips to localStorage:", err);
    }
  }, [clips]);

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
            : Array.isArray(ClipsData) &&
              ClipsData.every((s) => s && (s.image || s.image_url || s.url))
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

          updateClips(
            (clipsRef.current || []).map((c) =>
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

  // reorder visuals, auto-reflow them sequentially, and update app-state and external JSON
  const commitMoveAndSync = useCallback(
    (clipId, finalStart) => {
      const prevCopy = (clipsRef.current || []).map((c) => ({ ...c }));
      const target = prevCopy.find((c) => c.id === clipId);
      if (!target) return;

      const duration = Math.max(
        0.001,
        (target.duration || target.endTime - target.startTime || 0) -
          (target.trimStart || 0) -
          (target.trimEnd || 0)
      );

      target.startTime = finalStart;
      target.endTime = finalStart + duration;

      const visuals = prevCopy
        .filter((c) => c.type === "video" || c.type === "image")
        .sort((a, b) => a.startTime - b.startTime || (a.id > b.id ? 1 : -1));

      let cur = 0;
      const reflowedVisuals = visuals.map((v) => {
        const len = Math.max(
          0.001,
          v.duration - (v.trimStart || 0) - (v.trimEnd || 0)
        );
        const newV = { ...v, startTime: cur, endTime: cur + len };
        cur += len;
        return newV;
      });

      const nonVisuals = prevCopy.filter(
        (c) => !(c.type === "video" || c.type === "image")
      );

      const merged = [...reflowedVisuals, ...nonVisuals];
      const finalClips = fixAudioTrackLayers(merged);

      updateClips(finalClips);

      setTimeout(() => {
        syncClipsToClipsData(clipsRef.current);
      }, 0);
    },
    [updateClips]
  );

  const undo = useCallback(() => {
    if (undoStackRef.current.length === 0) return false;

    const previous = undoStackRef.current.pop();
    // push current state to redo
    redoStackRef.current.push(snapshotClips(clipsRef.current || []));

    // apply previous
    setClips(previous);

    // update reactive flags
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(redoStackRef.current.length > 0);

    return true;
  }, []);

  const redo = useCallback(() => {
    if (redoStackRef.current.length === 0) return false;

    const next = redoStackRef.current.pop();
    // push current state to undo
    undoStackRef.current.push(snapshotClips(clipsRef.current || []));

    // apply next
    setClips(next);

    // update reactive flags
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(redoStackRef.current.length > 0);

    return true;
  }, []);

  // Build a new ClipsData structure from app clips (visual order -> slides order)
  const syncClipsToClipsData = useCallback(async (currentClips) => {
    if (!currentClips || !currentClips.length) return;

    const deepClone = (o) => {
      try {
        return typeof structuredClone === "function"
          ? structuredClone(o)
          : JSON.parse(JSON.stringify(o));
      } catch {
        return JSON.parse(JSON.stringify(o));
      }
    };

    // 1) visuals only, in timeline order
    const visuals = [...currentClips]
      .filter((c) => c.type === "video" || c.type === "image")
      .sort((a, b) => a.startTime - b.startTime || (a.id > b.id ? 1 : -1));

    // Build top-level audio lookup so we can copy durations when present
    const topLevelAudioByUrl = new Map();
    const topLevelAudioByFile = new Map();
    currentClips
      .filter((c) => c.type === "audio")
      .forEach((a) => {
        if (a.url) topLevelAudioByUrl.set(a.url, a);
        if (a.fileName) topLevelAudioByFile.set(a.fileName, a);
        if (a.url) {
          const parts = a.url.split("/");
          const last = parts[parts.length - 1];
          if (last) topLevelAudioByFile.set(last, a);
        }
      });

    // small helper to test images
    const isLikelyImage = (url) => {
      if (!url || typeof url !== "string") return false;
      if (url.startsWith("data:image/")) return true;
      return /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i.test(url);
    };

    // 2) map visuals -> slides
    const newSlides = visuals.map((v, idx) => {
      const visibleLen = Math.max(
        0,
        Number(v.endTime - v.startTime || v.duration || 0)
      );
      const visibleLenRounded = Number(visibleLen.toFixed(2));

      if (v._rawSlide) {
        const clone = deepClone(v._rawSlide);

        // update durations
        if (v.type === "image") {
          if (!clone.image) clone.image = {};
          clone.image.image_duration = visibleLenRounded;
        } else if (v.type === "video") {
          if (!clone.video) clone.video = {};
          clone.video.video_duration = visibleLenRounded;

          // write back canonical video_thumbnail only if v.thumbnail looks like an image
          if (v.thumbnail && isLikelyImage(v.thumbnail)) {
            clone.video.video_thumbnail = v.thumbnail;
          } else {
            // if no valid thumbnail on clip, keep whatever existing clone.video.video_thumbnail is (do not delete)
          }
        }

        // copy top-level audio duration if a matching top-level audio clip exists
        if (clone.audio && clone.audio.audio_url) {
          const audioUrl = clone.audio.audio_url;
          const fileNameFromUrl = audioUrl ? audioUrl.split("/").pop() : null;

          const match =
            (audioUrl && topLevelAudioByUrl.get(audioUrl)) ||
            (fileNameFromUrl && topLevelAudioByFile.get(fileNameFromUrl)) ||
            null;

          if (
            match &&
            typeof match.duration === "number" &&
            isFinite(match.duration)
          ) {
            clone.audio.duration = Number(match.duration.toFixed(2));
          } else {
            // leave clone.audio.duration unchanged if it existed; do not overwrite with visual length
          }
        }

        if (typeof clone.slide_number !== "undefined")
          clone.slide_number = idx + 1;
        return clone;
      }

      // fallback slide
      return {
        uuid: v.id,
        slide_number: idx + 1,
        ...(v.type === "image"
          ? { image: { image_url: v.url, image_duration: visibleLenRounded } }
          : {}),
        ...(v.type === "video"
          ? {
              video: {
                video_url: v.url,
                video_duration: visibleLenRounded,
                video_thumbnail: isLikelyImage(v.thumbnail)
                  ? v.thumbnail
                  : null,
              },
            }
          : {}),
        audio: undefined,
      };
    });

    // 3) build final JSON shape and set to memory
    const original =
      Array.isArray(ClipsData) && ClipsData.length ? ClipsData[0] : null;
    let newJson;
    if (
      original &&
      typeof original === "object" &&
      Array.isArray(original.slides)
    ) {
      newJson = [{ ...deepClone(original), slides: newSlides }];
    } else {
      newJson = [{ slides: newSlides }];
    }

    setExternalClipsJson(newJson);

    // debug
    // console.log(
    //   "Synced ClipsData -> new slides (video thumbnails + durations):",
    //   newSlides.map((s) => ({
    //     id: s.uuid || s.image?.image_url || s.video?.video_url,
    //     image_duration: s.image?.image_duration,
    //     video_duration: s.video?.video_duration,
    //     audio_duration: s.audio?.duration,
    //     video_thumbnail: s.video?.video_thumbnail,
    //   }))
    // );

    // attempt to save server-side (optional)
    try {
      await fetch("/api/save-clips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clips: newJson }),
      });
      console.log("Saved updated ClipsData to server output.js");
    } catch (err) {
      console.warn("Failed to save ClipsData to server:", err);
    }
  }, []);

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

  async function uploadManualImage(slideUuid, file) {
    const formData = new FormData();
    formData.append("slide_uuid", slideUuid);
    formData.append("image", file);

    const res = await fetch(
      "https://media-v2.episyche.com/media/manual-image-upload",
      {
        method: "POST",
        body: formData,
      }
    );

    return res.json();
  }

  const handleMediaUpload = async (file, type) => {
    // create a local object URL early for duration / thumbnail work & fallback
    const localUrl = URL.createObjectURL(file);

    const getDuration = () =>
      new Promise((resolve) => {
        if (type === "image") return resolve(3); // default image duration
        const media =
          type === "video"
            ? document.createElement("video")
            : document.createElement("audio");
        media.src = localUrl;
        media.onloadedmetadata = () => resolve(media.duration || 0);
        // add a small timeout fallback in case metadata doesn't fire
        setTimeout(() => {
          // if duration still unknown, resolve 0
          resolve(media.duration || 0);
        }, 2000);
      });

    const duration = await getDuration();

    // compute startTime and track depending on type
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

    // try to extract/generate a thumbnail (video or image)
    let thumbnail = null;
    try {
      if (type === "video")
        thumbnail = await extractThumbnailFromVideo(file, 1);
      else if (type === "image") thumbnail = await getImageThumbnail(file);

      if (thumbnail) new Image().src = thumbnail; // pre-load
    } catch (error) {
      console.error("Thumbnail extraction failed:", error);
    }

    // For images: upload to manual-image-upload endpoint and use returned URL.
    // If upload fails, fallback to the local object URL.
    let finalUrl = localUrl;
    if (type === "image") {
      try {
        // create a slide UUID for the server
        const slideUuid =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `slide-${Date.now()}`;

        const formData = new FormData();
        formData.append("slide_uuid", slideUuid);
        formData.append("image", file);

        const res = await fetch(
          "https://media-v2.episyche.com/media/manual-image-upload/",
          {
            method: "POST",
            body: formData,
            // Note: DO NOT set Content-Type header here. Browser will set multipart/form-data boundary.
          }
        );

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          console.warn("Image upload failed:", res.status, text);
        } else {
          const data = await res.json().catch(() => null);
          // The API should ideally return a direct URL for the uploaded image.
          // Use it if present; otherwise fallback to local object URL.
          if (data && (data.url || data.image_url || data.file_url)) {
            finalUrl = data.url || data.image_url || data.file_url;
          } else if (data && data.success && data.path) {
            // fallback if API returns path
            finalUrl = data.path;
          } else {
            console.warn(
              "Upload response didn't contain a usable URL, falling back to local URL.",
              data
            );
          }
        }
      } catch (err) {
        console.error("Image upload error:", err);
        // continue with localUrl as fallback
      }
    }

    // Build the new clip object
    const newClip = {
      id: `clip-${Date.now()}`,
      type,
      url: finalUrl,
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

    // add to clips state (preserving audio track layering helper)
    updateClips(fixAudioTrackLayers([...(clipsRef.current || []), newClip]));

    if (!selectedClipId) setSelectedClipId(newClip.id);

    // revoke object URL after some time (optional cleanup)
    // setTimeout(() => URL.revokeObjectURL(localUrl), 30000);

    return newClip;
  };

  const handleSplitClip = (clipId, splitTime) => {
    const prevClips = clipsRef.current || [];
    const updated = [...prevClips];
    const index = updated.findIndex((c) => c.id === clipId);
    if (index === -1) return;

    const clip = updated[index];

    // Compute total visible length (accounting for trims)
    const totalVisible =
      (clip.duration || clip.endTime - clip.startTime || 0) -
      (clip.trimStart || 0) -
      (clip.trimEnd || 0);

    // If there's no visible duration or split is near edges -> ignore
    const REL_EPS = 0.05; // 50ms tolerance
    const splitOffset = splitTime - clip.startTime; // seconds from clip start
    if (totalVisible <= 0) return;
    if (splitOffset <= REL_EPS || splitOffset >= totalVisible - REL_EPS) return;

    // Convert to absolute trim positions (relative to original clip.duration)
    const splitRelative = (clip.trimStart || 0) + splitOffset;

    // Build first and second parts
    const nowTag = Date.now();
    const firstPart = {
      ...clip,
      id: `${clip.id}-part1-${nowTag}`,
      endTime: splitTime,
      trimStart: clip.trimStart || 0,
      trimEnd: Math.max(
        0,
        (clip.duration || clip.endTime - clip.startTime || 0) - splitRelative
      ),
      startTime: clip.startTime,
    };

    const secondPart = {
      ...clip,
      id: `${clip.id}-part2-${nowTag}`,
      startTime: splitTime,
      trimStart: Math.max(0, splitRelative),
      trimEnd: clip.trimEnd || 0,
      endTime: clip.endTime,
    };

    updated.splice(index, 1, firstPart, secondPart);

    // After splitting, we should fix audio layers or reflow visuals:
    let final = updated;

    if (clip.type === "audio") {
      // recompute audio tracks to avoid collisions
      final = fixAudioTrackLayers(final);
    } else if (clip.type === "image" || clip.type === "video") {
      // For visual clips, we likely want timeline to auto-reflow visuals sequentially.
      if (typeof autoReflowClips === "function") {
        final = autoReflowClips(final);
      }
    }

    // Keep selection consistent: select first part
    setSelectedClipId(firstPart.id);

    // Update totalDuration if needed
    const maxVisualEnd = Math.max(
      ...final
        .filter((c) => c.type === "video" || c.type === "image")
        .map((c) => c.endTime)
    );
    if (isFinite(maxVisualEnd) && maxVisualEnd > 0) {
      setTotalDuration((prev) => Math.max(prev, maxVisualEnd));
    }

    // Persist
    updateClips(final);
  };

  // replace the const version with this hoisted function so it's available earlier
  function fixAudioTrackLayers(clipsArr) {
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
  }

  // New handleAutoLayerFix: apply audio layering, set clips, and sync the new visual order
  const handleAutoLayerFix = useCallback(
    (updatedClips) => {
      const fixed = fixAudioTrackLayers(updatedClips);
      updateClips(fixed);

      // Sync to ClipsData (use microtask so clipsRef.current is up-to-date)
      setTimeout(() => {
        // if you prefer to use the fixed value directly, pass fixed instead of clipsRef.current
        syncClipsToClipsData(clipsRef.current || fixed);
      }, 0);
    },
    [
      /* no deps necessary (fixAudioTrackLayers and syncClipsToClipsData are stable) */
    ]
  );

  // --------------------------
  // IMPORTANT: UPDATED handler to support trimming effects
  // --------------------------
  const handleClipUpdate = (clipId, updates) => {
    // snapshot current clips (the hook exposes `clips`)
    const prev = clipsRef.current || [];
    const target = prev.find((c) => c.id === clipId);
    if (!target) return;

    // merge simple updates first (shallow merge for the target clip)
    let updated = prev.map((c) => (c.id === clipId ? { ...c, ...updates } : c));

    const affectsTimeline =
      updates.startTime !== undefined ||
      updates.trimStart !== undefined ||
      updates.trimEnd !== undefined;

    const isVisual =
      target && (target.type === "video" || target.type === "image");

    if (isVisual && affectsTimeline) {
      // read old trim values from the original target
      const oldTrimStart = Number(target.trimStart || 0);
      const oldTrimEnd = Number(target.trimEnd || 0);

      // pick new trim values (may not be provided in updates)
      const newClip = updated.find((c) => c.id === clipId);
      const newTrimStart =
        updates.trimStart !== undefined
          ? Number(updates.trimStart || 0)
          : oldTrimStart;
      const newTrimEnd =
        updates.trimEnd !== undefined
          ? Number(updates.trimEnd || 0)
          : oldTrimEnd;

      // compute visible length based on original media duration
      const mediaDuration = Number(
        newClip.duration || newClip.endTime - newClip.startTime || 0
      );
      const visibleLen = Math.max(
        0.001,
        mediaDuration - newTrimStart - newTrimEnd
      );

      // compute new startTime:
      const deltaTrimStart = newTrimStart - oldTrimStart;
      const newStartTime =
        updates.startTime !== undefined
          ? Number(updates.startTime)
          : Number(target.startTime) + deltaTrimStart;

      const newEndTime = newStartTime + visibleLen;

      // apply the computed times and trims to the updated array
      updated = updated.map((c) =>
        c.id === clipId
          ? {
              ...c,
              trimStart: newTrimStart,
              trimEnd: newTrimEnd,
              startTime: newStartTime,
              endTime: newEndTime,
            }
          : c
      );

      // Auto-reflow visual clips so downstream clips shift to accommodate new length
      updated = autoReflowClips(updated);
    }

    // Persist the change using updateClips (records history)
    updateClips(updated);

    // Immediately sync to ClipsData JSON (use microtask so clipsRef is updated)
    setTimeout(() => {
      syncClipsToClipsData(clipsRef.current);
    }, 0);
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

  // ---- FIX: when toggling Play, if currentTime is at/after the end -> seek to first visual start
  const handlePlayPause = useCallback(() => {
    setIsPlaying((prev) => {
      const willPlay = !prev;
      if (willPlay) {
        const visuals = clipsRef.current
          .filter((c) => c.type === "video" || c.type === "image")
          .sort((a, b) => a.startTime - b.startTime);
        if (visuals.length) {
          const maxEnd = Math.max(...visuals.map((c) => c.endTime));
          // if we're at/after end, reset to first visual start so playback begins correctly
          if (
            currentTime >= maxEnd - EPS ||
            currentTime >= totalDuration - EPS
          ) {
            const firstStart = visuals[0].startTime || 0;
            // small epsilon to ensure image logic works
            setCurrentTime(Math.max(0, firstStart + EPS));
            // stop audio players too (we will restart them via effect)
            audioPlayerRef.current?.stopAll?.();
            setSeekAudio((t) => t + 1);
          }
        }
      }
      return willPlay;
    });
  }, [currentTime, totalDuration, EPS]);

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

  // Replace the existing getCurrentClip() with this function in index.js

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
      currentTime - activeClip.startTime + (activeClip.trimStart || 0)
    );
    const maxRel =
      (activeClip.duration || activeClip.endTime - activeClip.startTime) -
      (activeClip.trimStart || 0) -
      (activeClip.trimEnd || 0);
    const clampedRelativeTime = Math.min(
      relativeTime,
      Math.max(0, maxRel - EPS)
    );

    return {
      // spread entire clip so VideoPlayer can use other fields too (thumbnail, mimeType, etc.)
      ...activeClip,
      id: activeClip.id,
      url: activeClip.url,
      type: activeClip.type,
      startTime: activeClip.startTime,
      relativeTime: clampedRelativeTime,
      hasAudio: !!activeClip.hasAudio,
      // important fields for immediate playback changes
      playbackRate:
        typeof activeClip.playbackRate === "number"
          ? activeClip.playbackRate
          : 1,
      volume:
        typeof activeClip.volume === "number"
          ? activeClip.volume
          : activeClip.type === "video"
          ? 1
          : undefined,
      mimeType: activeClip.mimeType,
      thumbnail: activeClip.thumbnail,
      duration: activeClip.duration,
    };
  }, [currentTime, clips, totalDuration, EPS]);

  useEffect(() => {
    if (clips.length && !selectedClipId) {
      setSelectedClipId(clips[0].id);
    }
  }, [clips, selectedClipId]);

  const handleDeleteClip = useCallback(
    (clipId) => {
      const prev = clipsRef.current || [];
      const target = prev.find((c) => c.id === clipId);
      if (!target) return;

      // Remove the clip
      const remaining = prev.filter((c) => c.id !== clipId);

      let final = remaining;

      // If the deleted clip is visual, auto-reflow visuals so gaps are filled.
      if (target.type === "video" || target.type === "image") {
        // collect visuals sorted by start (so reflow order is deterministic)
        const visuals = remaining
          .filter((c) => c.type === "video" || c.type === "image")
          .sort((a, b) => a.startTime - b.startTime || (a.id > b.id ? 1 : -1));

        // reflow visuals sequentially (pack starting at 0)
        let cur = 0;
        const reflowed = visuals.map((v) => {
          const len = Math.max(
            0.001,
            (v.duration || v.endTime - v.startTime || 0) -
              (v.trimStart || 0) -
              (v.trimEnd || 0)
          );
          const newV = { ...v, startTime: cur, endTime: cur + len };
          cur += len;
          return newV;
        });

        // keep non-visuals (audio) unchanged
        const nonVisuals = remaining.filter(
          (c) => !(c.type === "video" || c.type === "image")
        );

        // merge back and fix audio track layering
        final = fixAudioTrackLayers([...reflowed, ...nonVisuals]);
      } else {
        // Non-visual deletion: still ensure audio tracks are compacted
        final = fixAudioTrackLayers(remaining);
      }

      // Persist (records history)
      updateClips(final);

      // Clear selection if we deleted the selected clip
      setSelectedClipId((cur) => (cur === clipId ? null : cur));

      // Update totalDuration to cover the new visual timeline
      const maxVisualEnd = Math.max(
        0,
        ...final
          .filter((c) => c.type === "video" || c.type === "image")
          .map((c) => c.endTime)
      );
      setTotalDuration((prev) => Math.max(prev, maxVisualEnd));

      // Sync ClipsData JSON after state has been applied
      setTimeout(() => {
        syncClipsToClipsData(clipsRef.current);
      }, 0);
    },
    [updateClips]
  );

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
        // record history and sync ClipsData exactly like the toolbar delete does.
        handleDeleteClip(selectedClipId);
        // clear selection (handleDeleteClip already clears selection, but keep this for safety)
        setSelectedClipId(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [
    currentTime,
    totalDuration,
    selectedClipId,
    handlePlayPause,
    handleDeleteClip,
  ]);

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
          // ---- FIX: if there is no active visual but currentTime is before the first visual,
          // advance into the first visual instead of jumping to the end.
          const firstVisual = visuals[0];
          const lastVisualEnd = Math.max(...visuals.map((c) => c.endTime));
          if (prev < firstVisual.startTime + EPS) {
            // move to first visual start (small EPS to avoid image-first-time edge)
            lastVisualIdRef.current = firstVisual.id;
            return Math.max(prev, firstVisual.startTime + EPS);
          }

          // otherwise assume we truly reached the end -> stop and set to end
          running = false;
          setIsPlaying(false);
          return lastVisualEnd;
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

  const getRemoteMediaDuration = (
    url,
    type = "audio",
    fallback = null,
    opts = {}
  ) =>
    new Promise((resolve) => {
      if (!url) return resolve(fallback);

      const timeoutMs = opts.timeoutMs || 8000;
      const maxAttempts = opts.retry ? opts.retry + 1 : 2; // try no-cors then cors
      let attempt = 0;
      let finished = false;

      const tryOnce = (useCrossOrigin) => {
        attempt++;
        let timeoutId = null;
        const el = document.createElement(type === "video" ? "video" : "audio");
        el.preload = "metadata";

        // Attach listeners BEFORE assigning src
        const cleanup = () => {
          el.removeEventListener("loadedmetadata", onMeta);
          el.removeEventListener("error", onErr);
          try {
            el.src = "";
          } catch {}
          if (timeoutId) clearTimeout(timeoutId);
        };

        const finish = (dur) => {
          if (finished) return;
          finished = true;
          cleanup();
          resolve(dur);
        };

        const onMeta = () => {
          const d =
            isFinite(el.duration) && el.duration > 0 ? el.duration : null;
          finish(d ?? fallback);
        };

        const onErr = (ev) => {
          // if error, try next attempt (e.g., switch crossOrigin)
          cleanup();
          if (attempt < maxAttempts) {
            // small backoff
            setTimeout(() => tryOnce(!useCrossOrigin), 150);
            return;
          }
          finish(fallback);
        };

        el.addEventListener("loadedmetadata", onMeta);
        el.addEventListener("error", onErr);

        try {
          if (useCrossOrigin) {
            try {
              el.crossOrigin = "anonymous";
            } catch {}
          } else {
            // ensure nothing set
            try {
              el.removeAttribute("crossorigin");
            } catch {}
          }
          // set src after listeners attached
          el.src = url;
        } catch (err) {
          // failure -> try next if any
          cleanup();
          if (attempt < maxAttempts) {
            setTimeout(() => tryOnce(!useCrossOrigin), 150);
            return;
          }
          finish(fallback);
        }

        timeoutId = setTimeout(() => {
          cleanup();
          if (attempt < maxAttempts) {
            // retry with opposite crossOrigin setting
            setTimeout(() => tryOnce(!useCrossOrigin), 150);
            return;
          }
          finish(fallback);
        }, timeoutMs);
      };

      // start without crossOrigin first
      tryOnce(false);
    });

  // async function: builds clips array from ClipsData and replaces app clips state
  const buildAndReplaceClipsFromClipsData = async () => {
    if (!ClipsData) return;

    // Find slides array (support both shapes)
    const dataEntry =
      Array.isArray(ClipsData) && ClipsData.length
        ? ClipsData.find((d) => Array.isArray(d.slides)) || ClipsData[0]
        : ClipsData;
    if (!dataEntry) return;

    const slides = Array.isArray(dataEntry.slides)
      ? dataEntry.slides
      : Array.isArray(ClipsData) &&
        ClipsData.every(
          (s) =>
            s && (s.image || s.image_url || s.url || s.video_url || s.video)
        )
      ? ClipsData
      : null;
    if (!slides || !slides.length) return;

    // Helper: deep clone
    const deepClone = (o) => {
      try {
        return typeof structuredClone === "function"
          ? structuredClone(o)
          : JSON.parse(JSON.stringify(o));
      } catch {
        return JSON.parse(JSON.stringify(o));
      }
    };

    // Pre-read audio durations in parallel (best-effort)
    const audioDurationPromises = slides.map((s, idx) => {
      const audioUrl = s?.audio?.audio_url || s?.audio_url || null;
      const slideAudioDuration = s?.audio?.duration ?? null;
      if (!audioUrl)
        return Promise.resolve(
          slideAudioDuration != null ? Number(slideAudioDuration) : null
        );

      // getRemoteMediaDuration should exist in your file (robust helper recommended)
      return getRemoteMediaDuration(
        audioUrl,
        "audio",
        slideAudioDuration || 3,
        {
          timeoutMs: 8000,
          tryCrossOrigin: true,
        }
      )
        .then((d) => {
          if (d == null)
            return slideAudioDuration != null ? Number(slideAudioDuration) : 3;
          return d;
        })
        .catch(() =>
          slideAudioDuration != null ? Number(slideAudioDuration) : 3
        );
    });

    // Pre-read video durations in parallel (if needed)
    const videoDurationPromises = slides.map((s) => {
      const videoUrl =
        (s.video && (s.video.video_url || s.video.url)) ||
        s.video_url ||
        s.videoUrl ||
        null;
      const providedDuration =
        Number(
          s.duration ||
            (s.video && (s.video.duration || s.video.video_duration)) ||
            0
        ) || 0;
      if (!videoUrl) return Promise.resolve(null);
      if (providedDuration > 0) return Promise.resolve(providedDuration);
      return getRemoteMediaDuration(videoUrl, "video", null, {
        timeoutMs: 10000,
        tryCrossOrigin: true,
      });
    });

    const [audioDurations, videoDurations] = await Promise.all([
      Promise.all(audioDurationPromises),
      Promise.all(videoDurationPromises),
    ]);

    // tiny helper to test whether a URL looks like an image
    const isLikelyImage = (url) => {
      if (!url || typeof url !== "string") return false;
      if (url.startsWith("data:image/")) return true;
      return /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i.test(url);
    };

    // Build clips sequentially
    const newClips = [];
    let visualCursor = 0;

    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const imageObj = slide.image || {};
      const audioObj = slide.audio || {};
      const videoObj = slide.video || {};

      const videoUrl =
        videoObj.video_url ||
        videoObj.url ||
        slide.video_url ||
        slide.videoUrl ||
        null;

      const imageUrl =
        imageObj.image_url ||
        slide.image_url ||
        slide.imageUrl ||
        slide.url ||
        null;

      const isVideo = !!videoUrl;

      // Pick visual duration
      let visualDuration = 0;
      if (isVideo) {
        visualDuration =
          Number(videoObj.duration || videoObj.video_duration) ||
          Number(videoDurations[i]) ||
          3;
      } else {
        visualDuration =
          Number(
            imageObj.duration || imageObj.image_duration || slide.duration
          ) || 3;
      }

      const visualId =
        slide.uuid ||
        `visual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const visualStart = visualCursor;
      const visualEnd = visualStart + visualDuration;

      // Choose thumbnail:
      // - For videos: prefer slide.video_thumbnail (your canonical field)
      // - For images: use the image url (you said you don't send separate thumbnails for images)
      let chosenThumbnail = null;
      if (isVideo) {
        chosenThumbnail =
          (slide.video &&
            (slide.video.video_thumbnail || slide.video.Video_thumbnail)) ||
          slide.video_thumbnail ||
          // optional older fallback if present:
          slide.thumbnail ||
          videoObj.thumbnail ||
          null;

        // Validate: if the chosen value is obviously not an image (e.g. an mp3 link),
        // we don't set a thumbnail (UI will show Loading... fallback).
        if (!isLikelyImage(chosenThumbnail)) {
          chosenThumbnail = null;
        }
      } else {
        chosenThumbnail = imageUrl || null; // image itself is the thumbnail
      }

      // Build clip
      const visualClip = {
        id: visualId,
        type: isVideo ? "video" : "image",
        url: isVideo ? videoUrl || "" : imageUrl || "",
        fileName: isVideo
          ? (videoUrl || "").split("/").pop()
          : imageUrl
          ? imageUrl.split("/").pop()
          : `image-${visualId}`,
        mimeType: isVideo
          ? videoObj.mimeType || "video/mp4"
          : imageUrl?.endsWith(".png")
          ? "image/png"
          : "image/jpeg",
        duration: visualDuration,
        startTime: visualStart,
        endTime: visualEnd,
        trimStart: 0,
        trimEnd: 0,
        hasAudio: !!(audioObj && audioObj.audio_url) || !!isVideo,
        thumbnail: chosenThumbnail,
        track: 0,
        _rawSlide: deepClone(slide),
      };

      newClips.push(visualClip);

      // Attach independent audio clip if slide provides audio_url
      if (audioObj && audioObj.audio_url) {
        const audioDur =
          audioDurations &&
          typeof audioDurations[i] !== "undefined" &&
          audioDurations[i] != null
            ? audioDurations[i]
            : Number(audioObj.duration) || 3;

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
          track: 0,
        };

        newClips.push(audioClip);
      }

      visualCursor = visualEnd;
    } // end for

    if (!newClips.length) return;

    // replace app clips state (assumes setClips + fixAudioTrackLayers exist in your file)
    const marked = newClips.map((c) => ({ ...c, externalSource: true }));
    updateClips(fixAudioTrackLayers(marked));

    // ensure selection and totalDuration update after setClips
    setTimeout(() => {
      const allClipsNow = clipsRef.current;
      const firstVisual = allClipsNow.find(
        (c) => c.type === "image" || c.type === "video"
      );
      if (firstVisual) {
        setSelectedClipId((prev) => prev || firstVisual.id);
        const maxVisualEnd = Math.max(
          ...allClipsNow
            .filter((c) => c.type === "video" || c.type === "image")
            .map((c) => c.endTime)
        );
        setTotalDuration((prev) => Math.max(prev, maxVisualEnd || 0));
      }
    }, 50);
  };

  useEffect(() => {
    let cancelled = false;
    // Run the builder once on mount
    buildAndReplaceClipsFromClipsData();

    return () => {
      cancelled = true;
    };
  }, []); // run once

  // -----------------------
  // end adapter
  // -----------------------

  // =========================
  // *** ADDED HANDLERS (minimal)
  // =========================

  // Per-clip volume setter (0..1)
  const handleChangeVolume = useCallback(
    (clipId, newVolume) => {
      const v = Number(newVolume);
      const clamped = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
      updateClips(
        (clipsRef.current || []).map((c) =>
          c.id === clipId ? { ...c, volume: clamped } : c
        )
      );
    },
    [updateClips]
  );

  // Per-clip playback speed setter (video)
  const handleChangeSpeed = useCallback(
    (clipId, newRate) => {
      const r = Number(newRate);
      const clamped = Number.isFinite(r) ? Math.max(0.25, Math.min(4, r)) : 1;
      updateClips(
        (clipsRef.current || []).map((c) =>
          c.id === clipId ? { ...c, playbackRate: clamped } : c
        )
      );
    },
    [updateClips]
  );

  // =========================
  // end ADDED HANDLERS
  // =========================

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans flex flex-col items-center justify-center">
      <div className="max-w-[80rem] mx-auto px-6 py-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-indigo-600">Video Editor</h1>
          <MediaUploader onMediaUpload={handleMediaUpload} />
        </div>

        <div className="">
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
        <div className="mt-3 flex items-center gap-3 px-3 py-2 rounded-lg bg-white shadow border border-gray-200 w-fit">
          {/* Undo */}
          <button
            onClick={undo}
            disabled={!canUndo}
            className={`
      p-2 rounded-md border transition cursor-pointer
      ${
        !canUndo
          ? "opacity-40 cursor-not-allowed border-gray-200"
          : "hover:bg-gray-100 border-gray-300"
      }
    `}
          >
            <img src="/icons/undo.png" alt="Undo" className="w-5 h-5" />
          </button>

          {/* Redo */}
          <button
            onClick={redo}
            disabled={!canRedo}
            className={`
      p-2 rounded-md border transition cursor-pointer
      ${
        !canRedo
          ? "opacity-40 cursor-not-allowed border-gray-200"
          : "hover:bg-gray-100 border-gray-300"
      }
    `}
          >
            <img src="/icons/redo.png" alt="Redo" className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4">
          <Timeline
            clips={clips}
            onSplitClip={handleSplitClip}
            onSplitAudio={handleSplitClip}
            currentTime={currentTime}
            totalDuration={totalDuration}
            onClipUpdate={handleClipUpdate}
            onClipSelect={handleClipSelect}
            onSeek={handleSeek}
            selectedClipId={selectedClipId}
            onAutoLayerFix={handleAutoLayerFix}
            onCommitMove={commitMoveAndSync}
            onDelete={handleDeleteClip} // Delete button
            onChangeVolume={handleChangeVolume} // Volume slider
            onChangeSpeed={handleChangeSpeed} // Speed selector (video)
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

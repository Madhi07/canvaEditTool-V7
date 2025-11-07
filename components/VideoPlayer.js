import { useEffect, useRef, useState } from "react";
import videojs from "video.js";
import "video.js/dist/video-js.css";
import { Play, Pause } from "lucide-react";

export default function VideoPlayer({
  currentClip,
  currentTime,
  isPlaying,
  onPlayPause,
  onClipEnd,
  onTimeUpdate,
  clips,
  duration,
  zoom = 1,
}) {
  const videoRef = useRef(null);
  const playerRef = useRef(null);
  const [localTime, setLocalTime] = useState(0);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [audioContext, setAudioContext] = useState(null);
  const safeZoom = Math.min(Math.max(zoom, 0.5), 3);

  // Refs to hold the latest callbacks/values
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onClipEndRef = useRef(onClipEnd);
  const currentClipRef = useRef(currentClip);

  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onTimeUpdate]);

  useEffect(() => {
    onClipEndRef.current = onClipEnd;
  }, [onClipEnd]);

  useEffect(() => {
    currentClipRef.current = currentClip;
  }, [currentClip]);

  // Initialize Video.js once
  useEffect(() => {
    if (!videoRef.current || playerRef.current) return;

    const player = videojs(videoRef.current, {
      controls: false,
      autoplay: false,
      preload: "auto",
      fluid: true,
      muted: false,
      responsive: true,
    });

    playerRef.current = player;
    setIsPlayerReady(true);

    player.on("timeupdate", () => {
      const time = player.currentTime();
      setLocalTime(time);
      if (onTimeUpdateRef.current && currentClipRef.current) {
        onTimeUpdateRef.current(time, currentClipRef.current.id);
      }
    });

    player.on("ended", () => {
      if (onClipEndRef.current && currentClipRef.current) {
        onClipEndRef.current(currentClipRef.current.id);
      }
    });

    player.on("error", () => {
      const err = player.error();
      if (err) console.warn("Video player error:", err);
    });

    player.on("play", () => {
      if (audioContext && audioContext.state === "suspended") {
        audioContext.resume().catch((err) => {
          console.warn("Failed to resume audio context:", err);
        });
      }
    });
  }, [audioContext]);

  // Helper: current source URL from player
  const getCurrentSourceUrl = () => {
    const p = playerRef.current;
    if (!p) return "";
    const cs = p.currentSource && p.currentSource();
    if (cs?.src) return cs.src;
    try {
      const s = p.src();
      if (typeof s === "string" && s) return s;
      if (Array.isArray(s) && s[0]?.src) return s[0].src;
      if (s?.src) return s.src;
    } catch {}
    return "";
  };

  // EFFECT A: PRIME next video *inside the main player* while an image is active
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !isPlayerReady || !currentClip) return;
    if (currentClip.type !== "image") return;

    // Find the very next *video* visual clip after this image
    const nextVideo = (clips || [])
      .filter(
        (c) => c.type === "video" && c.startTime >= (currentClip.startTime ?? 0)
      )
      .sort((a, b) => a.startTime - b.startTime)[0];

    if (!nextVideo || !nextVideo.url) return;

    // If already primed with this url, skip
    const currentSourceUrl = getCurrentSourceUrl();
    if (currentSourceUrl === nextVideo.url) return;

    // Prime: set the next video source now (under the image overlay), keep paused
    playerRef.current.clipId = nextVideo.id;
    player.src({
      src: nextVideo.url,
      type: nextVideo.mimeType || "video/mp4",
    });

    const onReady = () => {
      player.off("loadedmetadata", onReady);
      // keep paused; we’re only buffering
      if (!player.paused()) player.pause();
    };

    if (player.readyState() >= 1) onReady();
    else player.one("loadedmetadata", onReady);
  }, [currentClip?.id, currentClip?.type, currentClip?.startTime, clips, isPlayerReady]);

  // EFFECT B: Load/Seek for the active clip (no reload when already primed)
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !currentClip || !isPlayerReady) return;

    if (currentClip.type === "image") {
      // Pause exactly once while an image is visible
      if (!player._imgPaused) {
        if (!player.paused()) player.pause();
        player._imgPaused = true;
      }
      return;
    }

    // back to video: lift the image pause marker
    player._imgPaused = false;

    const currentSourceUrl = getCurrentSourceUrl();
    const urlChanged = !!currentClip.url && currentSourceUrl !== currentClip.url;
    const seekTo = Math.max(0, currentClip.relativeTime || 0);

    if (urlChanged) {
      // Only when jumping to a different video than what we primed
      playerRef.current.clipId = currentClip.id;
      player.src({
        src: currentClip.url,
        type: currentClip.mimeType || "video/mp4",
      });

      const onReady = () => {
        player.off("loadedmetadata", onReady);
        if (Math.abs((player.currentTime() ?? 0) - seekTo) > 0.02) {
          player.currentTime(seekTo);
        }
        if (isPlaying) {
          const p = player.play();
          if (p?.catch) p.catch(() => {});
        }
      };

      // loadedmetadata is enough; using it avoids waiting for full buffering
      if (player.readyState() >= 1) onReady();
      else player.one("loadedmetadata", onReady);
    } else {
      // Same URL (likely primed): just drift-correct & play/pause
      const drift = Math.abs((player.currentTime() ?? 0) - seekTo);
      if (drift > 0.1) player.currentTime(seekTo);

      if (isPlaying) {
        if (player.paused()) {
          const p = player.play();
          if (p?.catch) p.catch(() => {});
        }
      } else {
        if (!player.paused()) player.pause();
      }

      if (playerRef.current.clipId !== currentClip.id) {
        playerRef.current.clipId = currentClip.id;
      }
    }
  }, [
    currentClip?.url,
    currentClip?.relativeTime,
    currentClip?.id,
    currentClip?.mimeType,
    isPlayerReady,
    isPlaying,
  ]);

  // EFFECT C: React to play/pause toggles (only when current clip’s src is set)
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !isPlayerReady || !currentClip) return;

    if (!player.currentSrc() || playerRef.current.clipId !== currentClip.id)
      return;

    if (isPlaying) {
      if (player.paused()) {
        const playPromise = player.play();
        if (playPromise !== undefined) {
          playPromise.catch((err) => {
            console.warn("Play blocked:", err);
            if (err?.name === "NotAllowedError") {
              onPlayPause(); // reflect blocked state
            }
          });
        }
      }
    } else {
      if (!player.paused()) player.pause();
    }
  }, [isPlaying, isPlayerReady, currentClip?.id, onPlayPause]);

  // Manual play toggle
  const handleManualPlay = () => {
    if (!playerRef.current) return;
    onPlayPause();
  };

  // Format mm:ss
  const formatTime = (sec) => {
    const mins = Math.floor(sec / 60);
    const secs = Math.floor(sec % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Cleanup
  useEffect(() => {
    return () => {
      if (playerRef.current) {
        try {
          playerRef.current.dispose();
        } catch {}
        playerRef.current = null;
      }
    };
  }, []);

  return (
    <div className="flex flex-col items-center w-full justify-center bg-white rounded-lg p-4 h-[60vh]">
      {/* Video Display */}
      <div className="relative w-full max-w-4xl h-[80%] rounded-lg overflow-hidden mb-2 flex items-center justify-center bg-black">
        <div
          className="w-full h-full flex items-center justify-center"
          style={{
            transform: `scale(${safeZoom})`,
            transformOrigin: "center",
          }}
        >
          {/* Keep video element mounted for Video.js stability */}
          <video
            ref={videoRef}
            className="video-js vjs-default-skin w-full h-full object-contain absolute inset-0"
            playsInline
            preload="auto"
            // crossOrigin is optional; keep if you capture frames/thumbnails
            // crossOrigin="anonymous"
          />

          {/* Image overlay shown when current clip is an image */}
          {currentClip?.type === "image" && (
            <img
              src={currentClip.url}
              alt={currentClip.fileName || "image"}
              className="absolute inset-0 w-full h-full object-contain z-10 transition-opacity duration-500"
              style={{
                // opacity: isPlaying ? 1 : 0.8,
                backgroundColor: "black",
              }}
            />
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4 w-full max-w-4xl justify-center">
        <span className="text-black font-mono text-sm">
          {formatTime(currentTime || 0)}
        </span>

        <button
          onClick={handleManualPlay}
          className="w-12 h-12 bg-indigo-600 rounded-full flex items-center justify-center hover:bg-indigo-700 transition-colors shadow-lg"
          disabled={!isPlayerReady}
        >
          {isPlaying ? (
            <Pause className="w-6 h-6 text-white" />
          ) : (
            <Play className="w-6 h-6 text-white ml-1" />
          )}
        </button>

        <span className="text-black font-mono text-sm">
          {formatTime(duration)}
        </span>
      </div>
    </div>
  );
}

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
  const safeZoom = Math.min(Math.max(zoom, 0.5), 2);

  // Refs to hold the latest callbacks
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onClipEndRef = useRef(onClipEnd);
  const currentClipRef = useRef(currentClip);
  const lastSrcRef = useRef(null);
  const imageTimeoutRef = useRef(null);
  const imageIntervalRef = useRef(null);

  const backgroundAudioRef = useRef(null);


  // Update refs when props change
  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onTimeUpdate]);

  useEffect(() => {
    onClipEndRef.current = onClipEnd;
  }, [onClipEnd]);

  useEffect(() => {
    currentClipRef.current = currentClip;
  }, [currentClip]);

  // Initialize player once
  useEffect(() => {
    if (!videoRef.current || playerRef.current) return;

    const player = videojs(videoRef.current, {
      controls: false,
      autoplay: false,
      preload: "auto",
      fluid: true,
      muted: false, // Start unmuted for better audio handling
      responsive: true,
    });

    playerRef.current = player;
    setIsPlayerReady(true);

    // Update current time
    player.on("timeupdate", () => {
      const time = player.currentTime();
      setLocalTime(time);
      if (onTimeUpdateRef.current && currentClipRef.current) {
        onTimeUpdateRef.current(time, currentClipRef.current.id);
      }
    });

    // Move to next clip when ended
    player.on("ended", () => {
      if (onClipEndRef.current && currentClipRef.current) {
        onClipEndRef.current(currentClipRef.current.id);
      }
    });

    // Handle player errors
    player.on("error", (e) => {
      console.warn("Video player error:", player.error());
    });

    // Ensure audio context is properly initialized
    player.on("play", () => {
      // Resume audio context if suspended (required by some browsers)
      if (audioContext && audioContext.state === "suspended") {
        audioContext.resume().catch((err) => {
          console.warn("Failed to resume audio context:", err);
        });
      }
    });
  }, [audioContext]);

  // EFFECT 1: Load new clip OR Seek when timeline position changes
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !currentClip || !isPlayerReady) return;

    // 🖼️ Handle image clips (simulate playback without seeking or re-triggering)
    if (currentClip.type === "image") {
      // Just pause the video player — image playback is managed globally
      if (!player.paused()) player.pause();
      return;
    }

    // Handle video clips normally
    const currentSrc = player.currentSrc();
    const needsReload =
      !currentSrc ||
      currentSrc !== currentClip.url ||
      playerRef.current.clipId !== currentClip.id;

    if (needsReload) {
      player.pause();
      playerRef.current.clipId = currentClip.id;

      player.src({
        src: currentClip.url,
        type: currentClip.mimeType || "video/mp4",
      });

      player.one("canplay", () => {
        const seekTime = Math.max(0, currentClip.relativeTime || 0);
        player.currentTime(seekTime);

        player.muted(false);
        player.volume(1.0);

        if (isPlaying) {
          const playPromise = player.play();
          if (playPromise !== undefined) {
            playPromise.catch((err) => {
              console.warn("Autoplay blocked:", err);
            });
          }
        }
      });
    } else if (!isPlaying) {
      const currentPlayerTime = player.currentTime();
      const targetTime = Math.max(0, currentClip.relativeTime || 0);
      if (Math.abs(currentPlayerTime - targetTime) > 0.1) {
        player.currentTime(targetTime);
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

  // EFFECT 2: Handle Play/Pause state changes
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !isPlayerReady || !currentClip) return; // Need currentClip to be ready

    // Don't do anything if the source isn't loaded yet
    if (!player.currentSrc() || playerRef.current.clipId !== currentClip.id)
      return;

    if (isPlaying) {
      if (player.paused()) {
        const playPromise = player.play();
        if (playPromise !== undefined) {
          playPromise.catch((err) => {
            console.warn("Play blocked:", err);
            // If blocked, sync state back to paused
            if (err.name === "NotAllowedError") {
              onPlayPause(); // Tell parent we couldn't play
            }
          });
        }
      }
    } else {
      if (!player.paused()) {
        player.pause();
      }
    }
  }, [
    isPlaying,
    isPlayerReady,
    currentClip?.id, // Re-evaluate when clip changes
  ]);

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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (playerRef.current) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      clearTimeout(imageTimeoutRef.current);
      clearInterval(imageIntervalRef.current);
      if (playerRef.current) {
        playerRef.current.dispose();
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
          {/* 🧱 Always keep video element mounted for video.js stability */}
          <video
            ref={videoRef}
            className="video-js vjs-default-skin w-full h-full object-contain absolute inset-0"
            playsInline
            preload="auto"
          />

          {/* 🖼️ Show image overlay if current clip is an image */}
          {currentClip?.type === "image" && (
            <img
              src={currentClip.url}
              alt={currentClip.fileName || "image"}
              className="absolute inset-0 w-full h-full object-contain z-10 transition-opacity duration-500"
              style={{
                opacity: isPlaying ? 1 : 0.8,
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

        {/* Audio status indicator */}
        {/* {currentClip?.hasAudio && (
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.617.757L4.273 14H2a1 1 0 01-1-1V7a1 1 0 011-1h2.273l4.11-2.757a1 1 0 011.617.757zM12 7a1 1 0 011 1v4.586l2.293-2.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4A1 1 0 1110 10.586V8a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
            Audio
          </div>
        )} */}
      </div>
    </div>
  );
}
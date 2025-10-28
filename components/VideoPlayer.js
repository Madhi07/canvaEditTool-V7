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
  const safeZoom = Math.min(Math.max(zoom, 0.5), 2);

  // Refs to hold the latest callbacks
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onClipEndRef = useRef(onClipEnd);
  // Ref to hold the currently playing clip object
  const currentClipRef = useRef(currentClip);

  // Update refs when props change
  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onTimeUpdate]);

  useEffect(() => {
    onClipEndRef.current = onClipEnd;
  }, [onClipEnd]);
  
  // Keep the currentClipRef updated
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
      muted: true, // Start muted (required for instant play)
    });

    playerRef.current = player;

    // Update current time
    player.on("timeupdate", () => {
      const time = player.currentTime();
      setLocalTime(time);
      // ✅ Pass local time AND the clip ID it's for
      if (onTimeUpdateRef.current && currentClipRef.current) {
        onTimeUpdateRef.current(time, currentClipRef.current.id);
      }
    });

    // Move to next clip when ended
    player.on("ended", () => {
      // ✅ Pass the ID of the clip that just ended
      if (onClipEndRef.current && currentClipRef.current) {
        onClipEndRef.current(currentClipRef.current.id);
      }
    });

  }, [clips]);

  // Load / play clip safely
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !currentClip) return;

    console.log("Switching clip:", currentClip.url, "isPlaying:", isPlaying, "relativeTime:", currentClip.relativeTime);


    const currentSrc = player.currentSrc();

    // Reload only if URL changed or if the clip ID changes
    if (currentClip.url && (currentSrc !== currentClip.url || playerRef.current.clipId !== currentClip.id)) {
      player.pause();
      player.src({ src: currentClip.url, type: "video/mp4" });
      playerRef.current.clipId = currentClip.id; // Store current clip ID on player instance

      player.one("canplay", () => {
        const seekTime = Math.max(0, currentClip.relativeTime || 0);
        player.currentTime(seekTime);

        const shouldBeMuted = !isPlaying || !currentClip.hasAudio;
        player.muted(shouldBeMuted);

        if (isPlaying) {
          const playPromise = player.play();
          if (playPromise !== undefined) {
            playPromise.catch((err) => {
              console.warn("Autoplay blocked:", err);
            });
          }
        }
      });
    } else {
      // Same clip — check if we need to seek
      const currentPlayerTime = player.currentTime();
      const targetTime = Math.max(0, currentClip.relativeTime || 0);

      if (Math.abs(currentPlayerTime - targetTime) > 0.1) {
        player.currentTime(targetTime);
      }

      const shouldBeMuted = !isPlaying || !currentClip.hasAudio;
      player.muted(shouldBeMuted);

      if (isPlaying) {
        const playPromise = player.play();
        if (playPromise !== undefined) {
          playPromise.catch((err) => {
            console.warn("Play blocked:", err);
          });
        }
      } else {
        player.pause();
      }
    }
  }, [
    currentClip?.url,
    currentClip?.relativeTime,
    currentClip?.id, // Added ID dependency for robust switching
    isPlaying,
    currentClip?.hasAudio,
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
          <video
            ref={videoRef}
            className="video-js vjs-default-skin w-full h-full object-contain absolute inset-0"
            playsInline
            preload="auto"
          />
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
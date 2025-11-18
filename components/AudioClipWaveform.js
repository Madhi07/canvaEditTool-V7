import { useEffect, useRef, useState } from "react";

// Cache decoded buffers by URL
const bufferCache = new Map();

/* -------------------------
   Helpers: fallbacks for fetch
   ------------------------- */
function toS3ProxyPath(url) {
  try {
    const u = new URL(url);
    return `/s3${u.pathname}${u.search || ""}`;
  } catch (err) {
    return null;
  }
}

async function fetchAudioArrayBufferWithFallback(audioUrl) {
  // 1) try direct fetch first (fast if CORS enabled)
  try {
    const resp = await fetch(audioUrl, { mode: "cors" });
    if (resp.ok) return await resp.arrayBuffer();
    // fallthrough if 4xx/5xx
  } catch (err) {
    console.debug("[Audio fetch] Direct fetch failed (likely CORS):", err);
  }

  // 2) try same-origin rewrite path (requires next.config.js rewrite)
  const s3Path = toS3ProxyPath(audioUrl);
  if (s3Path) {
    try {
      const resp = await fetch(s3Path);
      if (resp.ok) return await resp.arrayBuffer();
    } catch (err) {
      console.debug("[Audio fetch] /s3 proxy failed:", err);
    }
  }

  // 3) try API proxy route that fetches server-side
  try {
    const proxyUrl = `/api/proxy-audio?url=${encodeURIComponent(audioUrl)}`;
    const resp = await fetch(proxyUrl);
    if (resp.ok) return await resp.arrayBuffer();
    throw new Error(`Proxy fetch failed ${resp.status}`);
  } catch (err) {
    console.error("[Audio fetch] All fetch attempts failed:", err);
    throw err;
  }
}

/* -------------------------
   Decoder: OfflineAudioContext-first with fallbacks
   ------------------------- */
async function decodeAudioBufferOffline(arrayBuffer) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;

  // Prefer OfflineAudioContext (does not need user gesture)
  if (OfflineCtx) {
    try {
      // Determine sampleRate: try to read from a short-lived AudioContext if available
      let sampleRate = 44100;
      if (AudioCtx) {
        try {
          const tmp = new AudioCtx();
          sampleRate = tmp.sampleRate || sampleRate;
          if (tmp.close) await tmp.close();
        } catch (e) {
          // ignore; fallback to default sampleRate
        }
      }

      // Create an offline context with an estimated length (1 frame). Some browsers support decodeAudioData on OfflineAudioContext.
      const offline = new OfflineCtx(1, 1, sampleRate);

      // Try decode on offline context (some browsers allow this)
      if (typeof offline.decodeAudioData === "function") {
        const decoded = await new Promise((resolve, reject) => {
          try {
            offline.decodeAudioData(
              arrayBuffer.slice(0),
              (res) => resolve(res),
              (err) => reject(err)
            );
          } catch (err) {
            reject(err);
          }
        });
        return decoded;
      }
    } catch (err) {
      console.warn("OfflineAudioContext decode failed, falling back to AudioContext:", err);
      // fallthrough to AudioContext fallback
    }
  }

  // Fallback: use temporary AudioContext decodeAudioData (may show user-gesture warning if used for playback, but decoding here is short-lived)
  if (AudioCtx) {
    try {
      const ac = new AudioCtx();
      const audioBuffer = await new Promise((resolve, reject) => {
        try {
          const maybePromise = ac.decodeAudioData(arrayBuffer.slice(0));
          if (maybePromise && typeof maybePromise.then === "function") {
            maybePromise.then(resolve).catch(reject);
          } else {
            ac.decodeAudioData(arrayBuffer.slice(0), resolve, reject);
          }
        } catch (e) {
          reject(e);
        }
      });
      try {
        if (ac.close) await ac.close();
      } catch (e) {
        // ignore
      }
      return audioBuffer;
    } catch (err) {
      console.error("AudioContext decode fallback failed:", err);
      throw err;
    }
  }

  throw new Error("No AudioContext available for decoding");
}

/* -------------------------
   Component
   ------------------------- */
export default function AudioClipWaveform({
  audioUrl,
  duration,
  progress = 0, // 0 → 1 within the visible (trimmed) region
  color = "#60A5FA",
  isSelected = false,
  width = 400,
  height = 50,
  // trims in seconds
  trimStart = 0,
  trimEnd = 0,
}) {
  const canvasRef = useRef(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!audioUrl || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    let mounted = true;

    async function renderWave() {
      setIsLoading(true);
      setError(null);

      try {
        // 1) Decode & cache buffer (by URL)
        let cached = bufferCache.get(audioUrl);
        if (!cached) {
          // fetch arrayBuffer (with fallbacks)
          let buf;
          try {
            buf = await fetchAudioArrayBufferWithFallback(audioUrl);
          } catch (fetchErr) {
            throw new Error(`Failed to fetch audio (all fallbacks): ${fetchErr.message || fetchErr}`);
          }

          // decode using OfflineAudioContext-first helper (doesn't require user gesture)
          const decoded = await decodeAudioBufferOffline(buf);

          const data = decoded.numberOfChannels > 0 ? decoded.getChannelData(0) : new Float32Array(0);
          const sampleRate = decoded.sampleRate;
          const durationSec = decoded.length / sampleRate;

          cached = { decoded, data, sampleRate, durationSec };
          bufferCache.set(audioUrl, cached);

          // Limit cache size
          if (bufferCache.size > 50) {
            const firstKey = bufferCache.keys().next().value;
            bufferCache.delete(firstKey);
          }
        }

        const { data, sampleRate, durationSec } = cached;

        // 2) Compute visible window in samples from trims
        const d = Math.max(0, duration || durationSec || 0);
        const safeTrimStart = Math.max(0, Math.min(Number(trimStart) || 0, d));
        const safeTrimEnd = Math.max(0, Math.min(Number(trimEnd) || 0, Math.max(0, d - safeTrimStart)));

        const visibleStartSec = safeTrimStart;
        const visibleEndSec = Math.max(visibleStartSec + 0.001, d - safeTrimEnd); // ensure > 0

        const visibleStartSample = Math.floor(visibleStartSec * sampleRate);
        const visibleEndSample = Math.min(Math.floor(visibleEndSec * sampleRate), data.length);
        const visibleSamples = Math.max(1, visibleEndSample - visibleStartSample);

        // 3) Build waveform bins only for the visible window
        const bins = Math.max(1, Math.floor(width));
        const step = Math.max(1, Math.floor(visibleSamples / bins));
        const waveform = new Array(bins).fill(0);

        for (let i = 0; i < bins; i++) {
          const base = visibleStartSample + i * step;
          let sum = 0,
            count = 0;
          for (let j = 0; j < step && base + j < visibleEndSample; j++) {
            sum += Math.abs(data[base + j] || 0);
            count++;
          }
          waveform[i] = count ? sum / count : 0;
        }

        // 4) Draw
        ctx.clearRect(0, 0, width, height);

        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, `${color}99`);

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);

        waveform.forEach((v, i) => {
          const y = height / 2 - v * (height / 2) * 0.8;
          ctx.lineTo(i, y);
        });

        for (let i = waveform.length - 1; i >= 0; i--) {
          const y = height / 2 + waveform[i] * (height / 2) * 0.8;
          ctx.lineTo(i, y);
        }
        ctx.closePath();
        ctx.fill();

        // Progress overlay & line (expect progress normalized to trimmed width)
        if (progress > 0) {
          ctx.fillStyle = "rgba(255,255,255,0.2)";
          ctx.fillRect(0, 0, width * Math.max(0, Math.min(1, progress)), height);

          ctx.strokeStyle = "rgba(255,255,255,0.8)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(width * Math.max(0, Math.min(1, progress)), 0);
          ctx.lineTo(width * Math.max(0, Math.min(1, progress)), height);
          ctx.stroke();
        }

        if (isSelected) {
          ctx.strokeStyle = "#6366F1";
          ctx.lineWidth = 2;
          ctx.strokeRect(1, 1, width - 2, height - 2);
        }
      } catch (err) {
        console.error("Waveform rendering error:", err);
        setError(err.message || String(err));

        // Draw error state
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = "#f3f4f6";
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = "#6b7280";
        ctx.font = "12px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Audio preview unavailable", width / 2, height / 2);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    renderWave();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl, width, height, color, progress, isSelected, trimStart, trimEnd, duration]);

  if (error) {
    return (
      <div
        className={`relative rounded-md overflow-hidden shadow-sm border bg-gray-100 flex items-center justify-center ${
          isSelected ? "border-indigo-500 ring-2 ring-indigo-300" : "border-gray-300"
        }`}
        style={{ width, height }}
      >
        <div className="text-center text-gray-500">
          <div className="text-xs">Audio error</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative rounded-md overflow-hidden shadow-sm border transition-all ${
        isSelected ? "border-indigo-500 ring-2 ring-indigo-300" : "border-gray-300"
      } ${isLoading ? "opacity-50" : "opacity-100"}`}
      style={{ width, height }}
    >
      <canvas ref={canvasRef} width={width} height={height} className="w-full h-full" />
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 bg-opacity-75">
          <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
        </div>
      )}
    </div>
  );
}

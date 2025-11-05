import { useEffect, useRef, useState } from "react";

// Single AudioContext instance to prevent conflicts
let globalAudioContext = null;
let audioContextPromise = null;

function getAudioContext() {
  if (!globalAudioContext) {
    audioContextPromise = new Promise((resolve, reject) => {
      try {
        globalAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        resolve(globalAudioContext);
      } catch (error) {
        console.error("Failed to create AudioContext:", error);
        reject(error);
      }
    });
  }
  return audioContextPromise;
}

// Cache decoded buffers by URL
const bufferCache = new Map();

export default function AudioClipWaveform({
  audioUrl,
  duration,
  progress = 0, // 0 → 1 within the visible (trimmed) region
  color = "#60A5FA",
  isSelected = false,
  width = 400,
  height = 50,
  // NEW: trims in seconds
  trimStart = 0,
  trimEnd = 0,
}) {
  const canvasRef = useRef(null);
  const audioCtxRef = useRef(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!audioUrl || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    async function renderWave() {
      setIsLoading(true);
      setError(null);

      try {
        // 1) Decode & cache buffer (by URL)
        let cached = bufferCache.get(audioUrl);
        if (!cached) {
          const audioCtx = await getAudioContext();
          audioCtxRef.current = audioCtx;

          if (audioCtx.state === "suspended") {
            await audioCtx.resume();
          }

          const response = await fetch(audioUrl);
          if (!response.ok) throw new Error(`Failed to fetch audio: ${response.status}`);

          const buf = await response.arrayBuffer();
          const decoded = await audioCtx.decodeAudioData(buf);
          const data = decoded.getChannelData(0);
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

        const { data, sampleRate } = cached;

        // 2) Compute visible window in samples from trims
        const d = Math.max(0, duration || cached.durationSec || 0);
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
          let sum = 0, count = 0;
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
          ctx.fillRect(0, 0, width * progress, height);

          ctx.strokeStyle = "rgba(255,255,255,0.8)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(width * progress, 0);
          ctx.lineTo(width * progress, height);
          ctx.stroke();
        }

        if (isSelected) {
          ctx.strokeStyle = "#6366F1";
          ctx.lineWidth = 2;
          ctx.strokeRect(1, 1, width - 2, height - 2);
        }
      } catch (err) {
        console.error("Waveform rendering error:", err);
        setError(err.message);

        // Draw error state
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = "#f3f4f6";
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = "#6b7280";
        ctx.font = "12px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Audio preview unavailable", width / 2, height / 2);
      } finally {
        setIsLoading(false);
      }
    }

    renderWave();
  }, [audioUrl, width, height, color, progress, isSelected, trimStart, trimEnd, duration]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      audioCtxRef.current = null;
    };
  }, []);

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
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="w-full h-full"
      />
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 bg-opacity-75">
          <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
        </div>
      )}
    </div>
  );
}

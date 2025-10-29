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

// Enhanced waveform data cache
const waveformCache = new Map();

export default function AudioClipWaveform({
  audioUrl,
  duration,
  progress = 0, // 0 → 1
  color = "#60A5FA",
  isSelected = false,
  width = 400,
  height = 50,
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
        // Check cache first
        const cacheKey = `${audioUrl}_${width}x${height}`;
        let waveformData = waveformCache.get(cacheKey);
        
        if (!waveformData) {
          // Get or create AudioContext
          const audioCtx = await getAudioContext();
          audioCtxRef.current = audioCtx;
          
          // Resume context if suspended (required by some browsers)
          if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
          }

          // Fetch and decode audio
          const response = await fetch(audioUrl);
          if (!response.ok) {
            throw new Error(`Failed to fetch audio: ${response.status}`);
          }
          
          const buf = await response.arrayBuffer();
          const decoded = await audioCtx.decodeAudioData(buf);
          const data = decoded.getChannelData(0);

          // Calculate waveform
          const step = Math.floor(data.length / width);
          const amp = height / 2;
          const waveform = [];

          for (let i = 0; i < width; i++) {
            let sum = 0;
            let count = 0;
            for (let j = 0; j < step && (i * step + j) < data.length; j++) {
              sum += Math.abs(data[i * step + j]);
              count++;
            }
            waveform.push(count > 0 ? sum / count : 0);
          }

          waveformData = { waveform, decoded, data };
          waveformCache.set(cacheKey, waveformData);
          
          // Limit cache size to prevent memory issues
          if (waveformCache.size > 50) {
            const firstKey = waveformCache.keys().next().value;
            waveformCache.delete(firstKey);
          }
        }

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Draw waveform shape with gradient
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, `${color}99`); // Semi-transparent

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);

        waveformData.waveform.forEach((v, i) => {
          const y = height / 2 - v * (height / 2) * 0.8; // 80% of available height
          ctx.lineTo(i, y);
        });
        
        for (let i = waveformData.waveform.length - 1; i >= 0; i--) {
          const y = height / 2 + waveformData.waveform[i] * (height / 2) * 0.8;
          ctx.lineTo(i, y);
        }
        ctx.closePath();
        ctx.fill();

        // Draw playback progress overlay
        if (progress > 0) {
          ctx.fillStyle = "rgba(255,255,255,0.2)";
          ctx.fillRect(0, 0, width * progress, height);
        }

        // Draw progress line
        if (progress > 0) {
          ctx.strokeStyle = "rgba(255,255,255,0.8)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(width * progress, 0);
          ctx.lineTo(width * progress, height);
          ctx.stroke();
        }

        // Border highlight
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
  }, [audioUrl, width, height, color, progress, isSelected]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Don't close the global AudioContext as it might be used elsewhere
      // Just clear the reference
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
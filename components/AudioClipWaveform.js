import { useEffect, useRef } from "react";

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

  useEffect(() => {
    if (!audioUrl) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    async function renderWave() {
      const res = await fetch(audioUrl);
      const buf = await res.arrayBuffer();
      const decoded = await audioCtx.decodeAudioData(buf);
      const data = decoded.getChannelData(0);

      const step = Math.floor(data.length / width);
      const amp = height / 2;
      const waveform = [];

      for (let i = 0; i < width; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += Math.abs(data[i * step + j]);
        waveform.push(sum / step);
      }

      ctx.clearRect(0, 0, width, height);

      // Draw waveform shape
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, "#63abfdff");

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(0, height / 2);

      waveform.forEach((v, i) => {
        const y = height / 2 - v * amp;
        ctx.lineTo(i, y);
      });
      for (let i = waveform.length - 1; i >= 0; i--) {
        const y = height / 2 + waveform[i] * amp;
        ctx.lineTo(i, y);
      }
      ctx.closePath();
      ctx.fill();

      // Draw playback progress overlay
      if (progress > 0) {
        ctx.fillStyle = "rgba(255,255,255,0.3)";
        ctx.fillRect(0, 0, width * progress, height);
      }

      // Optional border highlight
      if (isSelected) {
        ctx.strokeStyle = "#6366F1";
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, width - 2, height - 2);
      }
    }

    renderWave();
  }, [audioUrl, width, height, color, progress, isSelected]);

  return (
    <div
      className={`relative rounded-md overflow-hidden shadow-sm border transition-all ${
        isSelected ? "border-indigo-500 ring-2 ring-indigo-300" : "border-gray-300"
      }`}
      style={{ width, height }}
    >
      <canvas ref={canvasRef} width={width} height={height} />
    </div>
  );
}

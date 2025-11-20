export function Toolbar({
  currentTime,
  totalDuration,
  videoZoom,
  setVideoZoom,
}) {
  const formatTime = (sec) => {
    const mins = Math.floor(sec / 60);
    const secs = Math.floor(sec % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex items-center gap-4 bg-gray-100 px-4 py-3 rounded-lg">
      {/* Zoom control */}
      <div className="flex items-center gap-2">
        <span className="text-gray-800 text-sm">Zoom:</span>
        <input
          type="range"
          min="0.5"
          max="3"
          step="0.05"
          value={videoZoom}
          onChange={(e) => setVideoZoom(Number(e.target.value))}
          className="w-40 h-1 bg-gray-200 rounded-lg cursor-pointer"
        />
        <span className="text-gray-800 text-sm">
          {Math.round(videoZoom * 100)}%
        </span>
      </div>

      {/* Time display */}
      <div className="ml-auto flex items-center gap-2">
        <span className="text-gray-600 text-sm">Time:</span>
        <div className="flex items-center gap-1 bg-gray-200 rounded px-2 py-1">
          <span className="text-gray-800 text-sm font-medium">
            {formatTime(currentTime)}
          </span>
          <span className="text-gray-600 text-sm">/</span>
          <span className="text-gray-800 text-sm font-medium">
            {formatTime(totalDuration)}
          </span>
        </div>
      </div>
    </div>
  );
}

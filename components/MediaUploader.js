import { useState, useRef } from 'react';
import { Upload, Video, Music, Image as ImageIcon, ChevronDown } from 'lucide-react';

export default function MediaUploader({ onMediaUpload }) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [selectedType, setSelectedType] = useState('video');
  const fileInputRef = useRef(null);

  const handleTypeSelect = (type) => {
    setSelectedType(type);
    setIsDropdownOpen(false);
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      onMediaUpload(file, selectedType);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const getAcceptedTypes = () => {
    switch (selectedType) {
      case 'video':
        return 'video/*';
      case 'audio':
        return 'audio/*';
      case 'image':
        return 'image/*';
      default:
        return '';
    }
  };

  const getIcon = () => {
    switch (selectedType) {
      case 'video':
        return <Video className="w-5 h-5" />;
      case 'audio':
        return <Music className="w-5 h-5" />;
      case 'image':
        return <ImageIcon className="w-5 h-5" />;
      default:
        return null;
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <button
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
        >
          {getIcon()}
          <span className="capitalize">{selectedType}</span>
          <ChevronDown className="w-4 h-4" />
        </button>

        {isDropdownOpen && (
          <>
            {/* Click outside to close dropdown */}
            <div
              className="fixed inset-0 z-10"
              onClick={() => setIsDropdownOpen(false)}
            />
            <div className="absolute top-full left-0 mt-2 bg-gray-700 rounded-lg shadow-lg overflow-hidden z-20 min-w-[140px]">
              <button
                onClick={() => handleTypeSelect('video')}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-600 transition-colors text-white"
              >
                <Video className="w-5 h-5" />
                <span>Video</span>
              </button>
              <button
                onClick={() => handleTypeSelect('audio')}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-600 transition-colors text-white"
              >
                <Music className="w-5 h-5" />
                <span>Audio</span>
              </button>
              <button
                onClick={() => handleTypeSelect('image')}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-600 transition-colors text-white"
              >
                <ImageIcon className="w-5 h-5" />
                <span>Image</span>
              </button>
            </div>
          </>
        )}
      </div>

      <button
        onClick={() => fileInputRef.current?.click()}
        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
      >
        <Upload className="w-5 h-5" />
        <span>Upload {selectedType}</span>
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept={getAcceptedTypes()}
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  );
}

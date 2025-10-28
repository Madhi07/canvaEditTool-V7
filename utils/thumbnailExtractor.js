// Extract a single thumbnail from a video at a specific time (default: 1 second)
export const extractThumbnailFromVideo = (videoFile, timeInSeconds = 1) => {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;

    video.onloadedmetadata = () => {
      const seekTime = Math.min(timeInSeconds, video.duration - 0.1);
      video.currentTime = seekTime;
    };

    video.onseeked = () => {
      try {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              const thumbnailUrl = URL.createObjectURL(blob);
              resolve(thumbnailUrl);
            } else {
              reject(new Error("Failed to create thumbnail blob"));
            }

            // cleanup
            video.src = "";
            video.load();
          },
          "image/jpeg",
          0.7
        );
      } catch (error) {
        reject(error);
      }
    };

    video.onerror = () => {
      reject(new Error("Failed to load video for thumbnail extraction"));
    };

    video.src = URL.createObjectURL(videoFile);
  });
};

// Extract multiple evenly spaced thumbnails from a video
export const extractMultipleThumbnails = (videoFile, count = 5) => {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const thumbnails = [];

    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;

    let currentIndex = 0;
    let timePoints = [];

    video.onloadedmetadata = () => {
      const duration = video.duration;
      const interval = duration / (count + 1);

      for (let i = 1; i <= count; i++) {
        timePoints.push(i * interval);
      }

      if (timePoints.length > 0) {
        video.currentTime = timePoints[currentIndex];
      }
    };

    video.onseeked = () => {
      try {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              thumbnails.push(URL.createObjectURL(blob));
            }

            currentIndex++;
            if (currentIndex < timePoints.length) {
              video.currentTime = timePoints[currentIndex];
            } else {
              video.src = "";
              video.load();
              resolve(thumbnails);
            }
          },
          "image/jpeg",
          0.7
        );
      } catch (error) {
        reject(error);
      }
    };

    video.onerror = () => {
      reject(new Error("Failed to load video for thumbnail extraction"));
    };

    video.src = URL.createObjectURL(videoFile);
  });
};

// Generate a simple preview thumbnail for an image
export const getImageThumbnail = (imageFile) => {
  return Promise.resolve(URL.createObjectURL(imageFile));
};

// File: pages/api/audio.js

export default async function handler(req, res) {
  // Allow only GET requests
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: "Missing audio URL" });
  }

  try {
    // Fetch the remote audio file
    const response = await fetch(url);

    if (!response.ok) {
      return res
        .status(response.status)
        .json({ error: `Failed to fetch audio: ${response.status}` });
    }

    // Get the audio as an ArrayBuffer
    const arrayBuffer = await response.arrayBuffer();

    // Convert ArrayBuffer into a Node.js Buffer
    const buffer = Buffer.from(arrayBuffer);

    // Set proper headers for returning raw audio data
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Cache-Control", "public, max-age=3600");

    // Send the audio buffer directly
    res.status(200).send(buffer);
  } catch (error) {
    console.error("Error fetching audio:", error);
    res.status(500).json({ error: "Server error fetching audio" });
  }
}
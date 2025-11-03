"use client";
import { useEffect, useRef } from "react";

export default function AudioPlayer({ activeAudioClips = [], isPlaying, currentTime }) {
  const audioCtxRef = useRef(null);
  const sourcesRef = useRef(new Map()); // key: clip.id -> { buffer, sourceNode, gainNode }
  const startTimeRef = useRef(currentTime);

  // Initialize AudioContext once
  useEffect(() => {
    if (!audioCtxRef.current) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioCtxRef.current = new AudioContextClass();
    }
  }, []);

  // Helper to load audio buffer from URL
  const fetchAndDecodeAudio = async (url) => {
    const audioCtx = audioCtxRef.current;
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    return await audioCtx.decodeAudioData(arrayBuffer);
  };

  // Sync playback with active clips
  useEffect(() => {
    if (!audioCtxRef.current) return;
    const audioCtx = audioCtxRef.current;

    if (!isPlaying) {
      // Pause all currently playing sources
      audioCtx.suspend();
      return;
    } else {
      // Resume if suspended
      audioCtx.resume();
    }

    // Identify which clips should be playing
    const currentClips = new Set(activeAudioClips.map((clip) => clip.id));

    // Stop and remove inactive clips
    for (const [id, data] of sourcesRef.current.entries()) {
      if (!currentClips.has(id)) {
        try {
          data.sourceNode.stop();
        } catch {}
        sourcesRef.current.delete(id);
      }
    }

    // Start new clips if not already playing
    activeAudioClips.forEach(async (clip) => {
      if (sourcesRef.current.has(clip.id)) return;

      try {
        const buffer = await fetchAndDecodeAudio(clip.url);

        const sourceNode = audioCtx.createBufferSource();
        sourceNode.buffer = buffer;

        const gainNode = audioCtx.createGain();
        gainNode.gain.value = 1;

        sourceNode.connect(gainNode).connect(audioCtx.destination);

        // Compute offset within clip
        const offset = currentTime - clip.startTime + clip.trimStart;
        const duration = clip.duration - clip.trimStart - clip.trimEnd;

        const playbackStart = Math.max(0, offset);
        const remaining = duration - playbackStart;

        if (remaining <= 0) return;

        sourceNode.start(0, playbackStart, remaining);

        // Save reference for cleanup
        sourcesRef.current.set(clip.id, { buffer, sourceNode, gainNode });

        sourceNode.onended = () => {
          sourcesRef.current.delete(clip.id);
        };
      } catch (err) {
        console.warn("Error playing audio clip", clip.url, err);
      }
    });
  }, [activeAudioClips, isPlaying, currentTime]);

  // Cleanup all audio on unmount
  useEffect(() => {
    return () => {
      for (const data of sourcesRef.current.values()) {
        try {
          data.sourceNode.stop();
        } catch {}
      }
      sourcesRef.current.clear();
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
      }
    };
  }, []);

  return null;
}

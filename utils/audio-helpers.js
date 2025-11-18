// utils/audio-helpers.js
// Helpers to lazily create/resume a global AudioContext on first user gesture.
// This version attempts immediate creation first (works when called inside a user gesture),
// and only attaches one-time listeners if immediate creation isn't possible.

/**
 * Notes:
 * - Many playback calls happen inside the user's click handler. In that case we must
 *   create/resume the AudioContext *synchronously* inside that handler — attaching a
 *   document-level listener won't help because the original click already happened.
 * - This helper therefore tries to construct/resume immediately and only uses
 *   listeners as a fallback.
 */

let globalAudioContext = null;
let creatingPromise = null;

/** Try to synchronously create a new AudioContext (may throw) */
function tryCreateAudioContextSync() {
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    const ac = new Ctor();
    // ensure a master gain exists
    try {
      if (!ac._master) {
        const master = ac.createGain();
        master.gain.setValueAtTime(1, ac.currentTime);
        master.connect(ac.destination);
        ac._master = master;
      }
    } catch (e) {
      // ignore
    }
    return ac;
  } catch (err) {
    // creation can fail if browser forbids creation outside a user gesture.
    return null;
  }
}

/**
 * Ensure a global AudioContext exists and is resumed.
 * - First tries immediate creation (good when called inside a user gesture).
 * - If immediate creation isn't possible, attaches one-time pointer/keydown listeners
 *   that will create/resume upon the next user gesture.
 * - Returns Promise<AudioContext|null>
 */
export function ensureAudioContextOnGesture() {
  // If already created and not closed, return immediately
  if (globalAudioContext && globalAudioContext.state !== "closed") {
    return Promise.resolve(globalAudioContext);
  }

  // If creation already in progress, return that promise
  if (creatingPromise) return creatingPromise;

  // First attempt synchronous immediate creation — covers the common case where
  // this function is called from inside a user gesture handler (e.g., click Play).
  const immediate = tryCreateAudioContextSync();
  if (immediate) {
    // If it's suspended, try to resume (in user gesture this should succeed)
    creatingPromise = (async () => {
      globalAudioContext = immediate;
      try {
        if (globalAudioContext.state === "suspended") {
          await globalAudioContext.resume();
        }
      } catch (err) {
        // ignore resume error; but still return the context
        console.warn("AudioContext resume during immediate creation failed:", err);
      }
      creatingPromise = null;
      return globalAudioContext;
    })();
    return creatingPromise;
  }

  // If immediate creation failed (likely because this call is NOT within a user gesture),
  // attach one-time listeners and return a promise that resolves when a gesture happens.
  creatingPromise = new Promise((resolve) => {
    const createNow = async () => {
      try {
        if (!globalAudioContext) {
          const Ctor = window.AudioContext || window.webkitAudioContext;
          if (Ctor) {
            try {
              globalAudioContext = new Ctor();
            } catch (err) {
              console.error("AudioContext construction failed on gesture:", err);
              globalAudioContext = null;
            }
          }
        }

        if (globalAudioContext) {
          // create/connect master gain if missing
          try {
            if (!globalAudioContext._master) {
              const master = globalAudioContext.createGain();
              master.gain.setValueAtTime(1, globalAudioContext.currentTime);
              master.connect(globalAudioContext.destination);
              globalAudioContext._master = master;
            }
          } catch (err) {
            console.warn("Failed to create/connect master gain:", err);
          }

          // resume if suspended
          try {
            if (globalAudioContext.state === "suspended") {
              await globalAudioContext.resume();
            }
          } catch (err) {
            console.warn("AudioContext.resume() failed after gesture:", err);
          }
        }
      } catch (err) {
        console.error("ensureAudioContextOnGesture error:", err);
      } finally {
        // remove listeners (safe even if they were used once)
        document.removeEventListener("pointerdown", createNow);
        document.removeEventListener("keydown", createNow);
        creatingPromise = null;
        resolve(globalAudioContext);
      }
    };

    // Attach one-time listeners that will run on the next user gesture
    document.addEventListener("pointerdown", createNow, { once: true, passive: true });
    document.addEventListener("keydown", createNow, { once: true, passive: true });
  });

  return creatingPromise;
}

/**
 * Resume the given AudioContext if it is in 'suspended' state.
 * Safe to call; failures are caught and logged.
 */
export async function resumeIfSuspended(ac) {
  if (!ac) return;
  try {
    if (ac.state === "suspended") {
      await ac.resume();
    }
  } catch (err) {
    console.warn("resumeIfSuspended error:", err);
  }
}

/**
 * Return the current global AudioContext if it already exists (may be null).
 * Useful when you want to check/attach nodes but not force creation.
 */
export function getGlobalAudioContextIfExists() {
  return globalAudioContext;
}

/**
 * Optional: allow manual destruction of the global context (useful in tests).
 */
export async function closeGlobalAudioContext() {
  try {
    if (globalAudioContext) {
      try {
        await globalAudioContext.close();
      } catch (e) {
        // ignore
      }
      globalAudioContext = null;
    }
  } catch (e) {
    // ignore
  }
}

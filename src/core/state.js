export const state = {
  pollTimer: null,
  browser: {
    tasks: [],
    selectedTaskId: null,
    currentTask: null,
    segments: [],
    speakerMatches: [],
    audioBuffer: null,
    audioUrl: null,
    audioPlayable: false,
    pxPerSec: 80,
    playSegment: null,
  },
};

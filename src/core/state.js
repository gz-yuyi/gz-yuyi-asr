export const state = {
  pollTimer: null,
  hotwords: {
    items: [],
    loaded: false,
  },
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

import { create } from 'zustand'
import type { ReaderState } from '../types'
import { saveProgress } from '../services/db'

export interface ReaderStore extends ReaderState {
  loadBook: (bookId: string, paragraphs: string[], progress?: { currentParaIndex: number; currentCharOffset: number; totalListeningMs: number }) => void
  setCurrentParagraph: (index: number) => void
  setCurrentCharOffset: (offset: number) => void
  play: () => void
  pause: () => void
  stop: () => void
  setRate: (rate: number) => void
  setPitch: (pitch: number) => void
  setVoice: (uri: string) => void
  reset: () => void
}

const initialState: ReaderState = {
  bookId: null,
  paragraphs: [],
  cumulativeCharOffsets: [],
  currentParaIndex: 0,
  currentCharOffset: 0,
  isPlaying: false,
  isPaused: false,
  speechRate: 1.0,
  speechPitch: 1.0,
  selectedVoiceURI: '',
  totalListeningMs: 0,
  sessionStartMs: null,
}

// 计算累计字符偏移（O(n)，仅在加载书籍时执行一次）
function computeCumulativeOffsets(paragraphs: string[]): number[] {
  const offsets: number[] = []
  let sum = 0
  for (const p of paragraphs) {
    offsets.push(sum)
    sum += p.length
  }
  return offsets
}

export const useReaderStore = create<ReaderStore>((set, get) => ({
  ...initialState,

  loadBook: (bookId, paragraphs, progress) => {
    set({
      bookId,
      paragraphs,
      cumulativeCharOffsets: computeCumulativeOffsets(paragraphs),
      currentParaIndex: progress?.currentParaIndex ?? 0,
      currentCharOffset: progress?.currentCharOffset ?? 0,
      totalListeningMs: progress?.totalListeningMs ?? 0,
      isPlaying: false,
      isPaused: false,
      sessionStartMs: null,
    })
  },

  setCurrentParagraph: (index: number) => {
    if (index >= 0 && index < get().paragraphs.length) {
      set({ currentParaIndex: index, currentCharOffset: 0 })
    }
  },

  setCurrentCharOffset: (offset: number) => {
    set({ currentCharOffset: offset })
  },

  play: () => {
    const state = get()
    if (!state.bookId) return
    set({
      isPlaying: true,
      isPaused: false,
      sessionStartMs: state.sessionStartMs ?? Date.now(),
    })
  },

  pause: () => {
    const state = get()
    let added = 0
    if (state.sessionStartMs) {
      added = Date.now() - state.sessionStartMs
    }
    set({
      isPlaying: false,
      isPaused: true,
      totalListeningMs: state.totalListeningMs + added,
      sessionStartMs: null,
    })
    persistProgress({ ...get(), totalListeningMs: get().totalListeningMs })
  },

  stop: () => {
    const state = get()
    let added = 0
    if (state.sessionStartMs) {
      added = Date.now() - state.sessionStartMs
    }
    set({
      isPlaying: false,
      isPaused: false,
      totalListeningMs: state.totalListeningMs + added,
      sessionStartMs: null,
      currentCharOffset: 0,
    })
    persistProgress({ ...get(), totalListeningMs: get().totalListeningMs })
  },

  setRate: (rate: number) => {
    set({ speechRate: rate })
  },

  setPitch: (pitch: number) => {
    set({ speechPitch: pitch })
  },

  setVoice: (uri: string) => {
    set({ selectedVoiceURI: uri })
  },

  reset: () => {
    set(initialState)
  },
}))

function persistProgress(state: ReaderState) {
  if (!state.bookId) return
  saveProgress({
    bookId: state.bookId,
    currentParaIndex: state.currentParaIndex,
    currentCharOffset: state.currentCharOffset,
    totalListeningMs: state.totalListeningMs,
    lastReadAt: Date.now(),
  })
}

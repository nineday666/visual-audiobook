// ========== 书籍 ==========
export interface Book {
  id: string
  title: string
  author?: string
  format: 'txt' | 'epub'
  paragraphs: string[]
  coverColor: string
  addedAt: number
  totalChars: number
  progress?: ReadingProgress
}

// ========== 阅读进度 ==========
export interface ReadingProgress {
  bookId: string
  currentParaIndex: number
  currentCharOffset: number
  totalListeningMs: number
  lastReadAt: number
}

// ========== 应用设置 ==========
export interface AppSettings {
  speechRate: number
  speechPitch: number
  preferredVoiceURI: string
  fontSize: FontSize
  theme: Theme
}

export type FontSize = 'sm' | 'md' | 'lg' | 'xl'
export type Theme = 'light' | 'dark'

export const FONT_SIZE_MAP: Record<FontSize, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
  xl: 'text-xl',
}

// ========== 语音引擎抽象 ==========
export interface Voice {
  uri: string
  name: string
  lang: string
  isDefault: boolean
}

export interface SpeakOptions {
  rate: number
  pitch: number
  voiceURI?: string
}

export interface BoundaryEvent {
  charIndex: number
  charLength: number
  name: 'word' | 'sentence'
}

export interface SpeechEngine {
  speak(text: string, options: SpeakOptions, skipCancel?: boolean): void
  pause(): void
  resume(): void
  stop(): void
  onBoundary(cb: (e: BoundaryEvent) => void): void
  onEnd(cb: () => void): void
  onError(cb: (e: Error) => void): void
  onVoicesChanged(cb: () => void): void
  getVoices(): Promise<Voice[]>
  isSpeaking(): boolean
  isPaused(): boolean
}

// ========== 阅读器运行时状态 ==========
export interface ReaderState {
  bookId: string | null
  paragraphs: string[]
  cumulativeCharOffsets: number[]  // 每段落的累计字符偏移
  currentParaIndex: number
  currentCharOffset: number
  isPlaying: boolean
  isPaused: boolean
  speechRate: number
  speechPitch: number
  selectedVoiceURI: string
  totalListeningMs: number
  sessionStartMs: number | null
}

// 中文 TTS 大约每秒 4 个字符（1x 倍速基准）
export const CHARS_PER_SECOND = 4

// 估算总时长（秒）
export function estimateTotalSeconds(totalChars: number, rate: number): number {
  return totalChars / (CHARS_PER_SECOND * rate)
}

// 根据累计字符偏移和当前倍速估算已过秒数
export function estimateElapsedSeconds(
  cumulativeOffsets: number[],
  paraIndex: number,
  charOffset: number,
  rate: number,
): number {
  const baseOffset = cumulativeOffsets[paraIndex] ?? 0
  const totalOffset = baseOffset + charOffset
  return totalOffset / (CHARS_PER_SECOND * rate)
}

// 根据目标秒数反查段落索引
export function findParagraphBySeconds(
  cumulativeOffsets: number[],
  targetSeconds: number,
  rate: number,
): number {
  const targetOffset = targetSeconds * CHARS_PER_SECOND * rate
  for (let i = cumulativeOffsets.length - 1; i >= 0; i--) {
    if (cumulativeOffsets[i] <= targetOffset) return i
  }
  return 0
}

// ========== 上下文菜单 ==========
export interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  paraIndex: number
}

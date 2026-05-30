import type { SpeechEngine, SpeakOptions, BoundaryEvent, Voice } from '../types'

// 将浏览器原生 SpeechSynthesisVoice 转为我们的 Voice 类型
function mapVoices(voices: SpeechSynthesisVoice[]): Voice[] {
  return voices.map((v) => ({
    uri: v.voiceURI,
    name: v.name,
    lang: v.lang,
    isDefault: v.default,
  }))
}

/**
 * Web Speech API 实现
 * 封装浏览器原生的 SpeechSynthesis API
 */
export class WebSpeechEngine implements SpeechEngine {
  private boundaryCallback: ((e: BoundaryEvent) => void) | null = null
  private endCallback: (() => void) | null = null
  private errorCallback: ((e: Error) => void) | null = null
  private _paused = false
  private _speaking = false
  private voicesChangedCallback: (() => void) | null = null

  constructor() {
    // 持续监听语音列表变化（某些浏览器异步加载）
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.addEventListener('voiceschanged', () => {
        if (this.voicesChangedCallback) this.voicesChangedCallback()
      })
    }
  }

  onVoicesChanged(cb: () => void): void {
    this.voicesChangedCallback = cb
  }

  speak(text: string, options: SpeakOptions, skipCancel = false): void {
    const synth = window.speechSynthesis

    if (!skipCancel) {
      synth.cancel()
    }

    const utterance = new SpeechSynthesisUtterance('')
    utterance.rate = options.rate
    utterance.pitch = options.pitch
    utterance.lang = 'zh-CN'
    utterance.volume = 1
    utterance.text = text

    if (options.voiceURI) {
      const voices = synth.getVoices()
      const voice = voices.find((v) => v.voiceURI === options.voiceURI)
      if (voice) {
        utterance.voice = voice
      }
    }

    utterance.onboundary = (event) => {
      if (this.boundaryCallback) {
        this.boundaryCallback({
          charIndex: event.charIndex,
          charLength: event.charLength ?? 0,
          name: (event.name as 'word' | 'sentence') || 'word',
        })
      }
    }

    utterance.onend = () => {
      this._speaking = false
      this._paused = false
      if (this.endCallback) this.endCallback()
    }

    utterance.onerror = (event) => {
      if (event.error !== 'canceled' && event.error !== 'interrupted') {
        this._speaking = false
        this._paused = false
        if (this.errorCallback) {
          this.errorCallback(new Error(event.error))
        }
      }
    }

    this._speaking = true
    this._paused = false
    synth.speak(utterance)
  }

  pause(): void {
    window.speechSynthesis.pause()
    this._paused = true
  }

  resume(): void {
    window.speechSynthesis.resume()
    this._paused = false
    this._speaking = true
  }

  stop(): void {
    window.speechSynthesis.cancel()
    this._speaking = false
    this._paused = false
  }

  onBoundary(cb: (e: BoundaryEvent) => void): void {
    this.boundaryCallback = cb
  }

  onEnd(cb: () => void): void {
    this.endCallback = cb
  }

  onError(cb: (e: Error) => void): void {
    this.errorCallback = cb
  }

  isSpeaking(): boolean {
    return this._speaking
  }

  isPaused(): boolean {
    return this._paused
  }

  async getVoices(): Promise<Voice[]> {
    const synth = window.speechSynthesis

    // 先尝试直接获取
    let voices = synth.getVoices()
    if (voices.length > 0) return mapVoices(voices)

    // 重试：最多等 3 秒，每 300ms 检查一次
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 300))
      voices = synth.getVoices()
      if (voices.length > 0) return mapVoices(voices)
    }

    return []
  }
}

// 单例
let engineInstance: WebSpeechEngine | null = null

export function getSpeechEngine(): WebSpeechEngine {
  if (!engineInstance) {
    engineInstance = new WebSpeechEngine()
  }
  return engineInstance
}

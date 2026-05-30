// AudioContext 播放器 — 预缓冲、无缝播、真正可调倍速

type AudioState = 'idle' | 'playing' | 'paused'

interface QueuedItem {
  buffer: AudioBuffer
  paraIndex: number
}

interface PlayerCallbacks {
  onStart: (paraIndex: number) => void
  onEnd: (paraIndex: number) => void
  onProgress: (paraIndex: number, charOffset: number) => void
  onError: (err: Error) => void
}

export class AudioPlayer {
  private ctx: AudioContext | null = null
  private source: AudioBufferSourceNode | null = null
  private queue: QueuedItem[] = []
  private callbacks: PlayerCallbacks = {
    onStart: () => {},
    onEnd: () => {},
    onProgress: () => {},
    onError: () => {},
  }
  private _state: AudioState = 'idle'
  private _rate = 1.0
  private _currentParaIndex = -1
  private startTime = 0
  private startOffset = 0
  private progressTimer: ReturnType<typeof setInterval> | null = null
  // 每个段落的字符长度映射（用于进度估算）
  private paraCharLengths: Map<number, number> = new Map()

  get state(): AudioState {
    return this._state
  }

  get rate(): number {
    return this._rate
  }

  get currentParaIndex(): number {
    return this._currentParaIndex
  }

  setCallbacks(cb: Partial<PlayerCallbacks>): void {
    Object.assign(this.callbacks, cb)
  }

  setParaCharLength(index: number, length: number): void {
    this.paraCharLengths.set(index, length)
  }

  setRate(rate: number): void {
    this._rate = rate
    if (this.source) {
      this.source.playbackRate.value = rate
    }
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext()
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume()
    }
    return this.ctx
  }

  // 预加载音频缓冲
  async preload(index: number, audioBuffer: ArrayBuffer): Promise<void> {
    const ctx = this.ensureContext()
    try {
      const decoded = await ctx.decodeAudioData(audioBuffer.slice(0))
      this.queue.push({ buffer: decoded, paraIndex: index })
    } catch (err) {
      this.callbacks.onError(err instanceof Error ? err : new Error('音频解码失败'))
    }
  }

  // 开始播放（如果有缓冲就播，没有就等）
  play(startIndex: number): void {
    this._currentParaIndex = startIndex
    this._state = 'playing'
    this.tryPlayNext()
    this.startProgressTimer()
  }

  pause(): void {
    this._state = 'paused'
    if (this.ctx) {
      this.ctx.suspend()
    }
    this.stopProgressTimer()
  }

  resume(): void {
    if (this._state !== 'paused') return
    this._state = 'playing'
    if (this.ctx) {
      this.ctx.resume()
    }
    this.startProgressTimer()
  }

  stop(): void {
    this._state = 'idle'
    if (this.source) {
      try { this.source.stop() } catch {}
      this.source = null
    }
    this.queue = []
    this.stopProgressTimer()
  }

  // 清空队列，准备跳转
  clearQueue(): void {
    if (this.source) {
      try { this.source.stop() } catch {}
      this.source = null
    }
    this.queue = []
  }

  // === 内部 ===
  private tryPlayNext(): void {
    if (this._state !== 'playing') return

    // 在队列中找下一个段落
    const idx = this.queue.findIndex((q) => q.paraIndex === this._currentParaIndex)
    if (idx === -1) {
      // 还没缓冲好，50ms 后重试
      setTimeout(() => this.tryPlayNext(), 50)
      return
    }

    // 移除队列中之前的部分
    const item = this.queue[idx]
    this.queue = this.queue.slice(idx + 1)

    // 播放
    const ctx = this.ensureContext()
    this.source = ctx.createBufferSource()
    this.source.buffer = item.buffer
    this.source.playbackRate.value = this._rate
    this.source.connect(ctx.destination)

    this.startTime = ctx.currentTime
    this.startOffset = 0

    this.source.onended = () => {
      // 这一句播放完成 → 通知回调 → 播下一句
      const finishedIndex = this._currentParaIndex
      this.callbacks.onEnd(finishedIndex)

      if (this._state === 'playing') {
        this._currentParaIndex++
        this.tryPlayNext()
      }
    }

    this.source.start()
    this.callbacks.onStart(item.paraIndex)
  }

  private startProgressTimer(): void {
    this.stopProgressTimer()
    this.progressTimer = setInterval(() => {
      if (this._state !== 'playing' || this._currentParaIndex < 0) return

      const elapsed = this.ctx ? this.ctx.currentTime - this.startTime + this.startOffset : 0
      const charLength = this.paraCharLengths.get(this._currentParaIndex) || 100
      // 估算：audioDuration 对应的 chars 比例
      const currentBuffer = this.source?.buffer
      let progress = 0
      if (currentBuffer && currentBuffer.duration > 0) {
        progress = Math.min(1, elapsed * this._rate / currentBuffer.duration)
      }
      const charOffset = Math.floor(progress * charLength)
      this.callbacks.onProgress(this._currentParaIndex, Math.min(charOffset, charLength - 1))
    }, 150)
  }

  private stopProgressTimer(): void {
    if (this.progressTimer) {
      clearInterval(this.progressTimer)
      this.progressTimer = null
    }
  }

  destroy(): void {
    this.stop()
    if (this.ctx) {
      this.ctx.close()
      this.ctx = null
    }
  }
}

import { useEffect, useRef, useCallback, useState } from 'react'
import { useReaderStore } from '../stores/readerStore'
import { useSettingsStore } from '../stores/settingsStore'
import { getEdgeTts } from '../services/edge-tts'
import { AudioPlayer } from '../services/audio-player'
import { getSpeechEngine } from '../services/speech-engine'
import { CHARS_PER_SECOND } from '../types'

export function useSpeech() {
  // Refs for current state (avoids stale closures)
  const paragraphsRef = useRef<string[]>([])
  const currentIndexRef = useRef(0)
  const rateRef = useRef(1.0)
  const voiceRef = useRef('')
  const isPlayingRef = useRef(false)

  // Audio-based pipeline
  const playerRef = useRef<AudioPlayer | null>(null)
  const ttsRef = useRef(getEdgeTts())
  const useCloudRef = useRef(true) // 尝试云 TTS；失败则降级
  const prefetchingRef = useRef(new Set<number>())
  const [ttsStatus, setTtsStatus] = useState<'idle' | 'connecting' | 'cloud' | 'fallback'>('idle')

  // Web Speech fallback
  const engineRef = useRef(getSpeechEngine())
  const paragraphStartRef = useRef(0)

  // Zustand selectors
  const paragraphs = useReaderStore((s) => s.paragraphs)
  const currentParaIndex = useReaderStore((s) => s.currentParaIndex)
  const speechRate = useReaderStore((s) => s.speechRate)
  const speechPitch = useReaderStore((s) => s.speechPitch)
  const selectedVoiceURI = useReaderStore((s) => s.selectedVoiceURI)
  const isPlaying = useReaderStore((s) => s.isPlaying)
  const setCurrentParagraph = useReaderStore((s) => s.setCurrentParagraph)
  const setCurrentCharOffset = useReaderStore((s) => s.setCurrentCharOffset)
  const stop = useReaderStore((s) => s.stop)
  const pause = useReaderStore((s) => s.pause)
  const play = useReaderStore((s) => s.play)
  const settingsRate = useSettingsStore((s) => s.speechRate)

  // Sync to refs
  paragraphsRef.current = paragraphs
  currentIndexRef.current = currentParaIndex
  rateRef.current = speechRate || settingsRate || 1.0
  voiceRef.current = selectedVoiceURI
  isPlayingRef.current = isPlaying

  // === Cloud TTS + AudioPlayer pipeline ===
  const initPlayer = useCallback(() => {
    if (playerRef.current) return playerRef.current
    const player = new AudioPlayer()
    playerRef.current = player

    player.setCallbacks({
      onStart: (index) => {
        setCurrentParagraph(index)
      },
      onEnd: (index) => {
        // 预取下一个
        prefetchNext(index + 1)
      },
      onProgress: (index, charOffset) => {
        if (index === currentIndexRef.current) {
          setCurrentCharOffset(charOffset)
        }
      },
      onError: () => {
        // 云 TTS 失败 → 降级到 Web Speech
        useCloudRef.current = false
      },
    })

    return player
  }, [setCurrentParagraph, setCurrentCharOffset])

  // 预取段落音频
  const prefetchAudio = useCallback(async (index: number) => {
    if (index < 0 || index >= paragraphsRef.current.length) return
    if (prefetchingRef.current.has(index)) return
    prefetchingRef.current.add(index)

    const text = paragraphsRef.current[index]
    if (!text?.trim()) {
      prefetchingRef.current.delete(index)
      return
    }

    try {
      const tts = ttsRef.current
      const result = await tts.synthesize(text)
      const player = playerRef.current
      if (player) {
        player.setParaCharLength(index, text.length)
        await player.preload(index, result.audioBuffer)
        if (ttsStatus !== 'cloud') {
          setTtsStatus('cloud')
          console.log('✅ 云端 TTS 已就绪 — 使用 Microsoft Edge 神经网络语音')
        }
      }
    } catch (err) {
      console.warn('⚠️ 云 TTS 失败，降级到离线语音:', err)
      useCloudRef.current = false
      setTtsStatus('fallback')
    } finally {
      prefetchingRef.current.delete(index)
    }
  }, [])

  // 预取后续段落
  const prefetchNext = useCallback((fromIndex: number) => {
    for (let i = fromIndex; i < fromIndex + 3 && i < paragraphsRef.current.length; i++) {
      prefetchAudio(i)
    }
  }, [prefetchAudio])

  // 云 TTS 启动播放
  const startCloudPlayback = useCallback(async (index: number) => {
    useCloudRef.current = true
    setTtsStatus('connecting')
    const player = initPlayer()
    player.clearQueue()

    // 连接 TTS
    try {
      await ttsRef.current.connect()
    } catch {
      useCloudRef.current = false
      return false
    }

    currentIndexRef.current = index
    player.setRate(rateRef.current)

    // 预取当前及后续段落
    prefetchNext(index)
    player.play(index)

    return true
  }, [initPlayer, prefetchNext])

  // === Web Speech fallback (当前逻辑，精简版) ===
  const speakFallback = useCallback((index: number) => {
    const text = paragraphsRef.current[index]
    if (!text?.trim()) {
      currentIndexRef.current = index + 1
      setCurrentParagraph(index + 1)
      speakFallback(index + 1)
      return
    }
    paragraphStartRef.current = Date.now()
    setCurrentParagraph(index)

    engineRef.current.speak(text, {
      rate: rateRef.current,
      pitch: speechPitch,
      voiceURI: voiceRef.current || undefined,
    })
  }, [speechPitch, setCurrentParagraph])

  // Web Speech 事件
  useEffect(() => {
    const engine = engineRef.current
    engine.onBoundary((e) => setCurrentCharOffset(e.charIndex))
    engine.onEnd(() => {
      const next = currentIndexRef.current + 1
      if (next < paragraphsRef.current.length) {
        currentIndexRef.current = next
        speakFallback(next)
      } else {
        stop()
      }
    })
    engine.onError(() => pause())
    return () => { engine.stop() }
  }, [speakFallback, setCurrentCharOffset, stop, pause])

  // === 公开 API ===
  const startPlayback = useCallback(async (paraIndex?: number) => {
    const idx = paraIndex ?? currentIndexRef.current

    // 尝试云 TTS
    if (useCloudRef.current) {
      const ok = await startCloudPlayback(idx)
      if (ok) {
        play()
        return
      }
    }

    // 降级到 Web Speech
    currentIndexRef.current = idx
    play()
    speakFallback(idx)
  }, [startCloudPlayback, play, speakFallback])

  const pausePlayback = useCallback(() => {
    if (useCloudRef.current && playerRef.current) {
      playerRef.current.pause()
    } else {
      engineRef.current.pause()
    }
    pause()
  }, [pause])

  const resumePlayback = useCallback(() => {
    if (useCloudRef.current && playerRef.current) {
      playerRef.current.resume()
    } else {
      engineRef.current.resume()
    }
    play()
  }, [play])

  const stopPlayback = useCallback(() => {
    if (useCloudRef.current && playerRef.current) {
      playerRef.current.stop()
    } else {
      engineRef.current.stop()
    }
    stop()
  }, [stop])

  // 倍速变化 → 实时更新 playbackRate
  useEffect(() => {
    if (playerRef.current) {
      playerRef.current.setRate(rateRef.current)
    }
  }, [speechRate])

  // 清理
  useEffect(() => {
    return () => {
      playerRef.current?.destroy()
      ttsRef.current.disconnect()
    }
  }, [])

  // === Web Speech 进度定时器（仅兜底用） ===
  useEffect(() => {
    if (!isPlaying || useCloudRef.current) return
    const timer = setInterval(() => {
      if (!useReaderStore.getState().isPlaying) return
      const elapsed = (Date.now() - paragraphStartRef.current) / 1000
      const estimatedChars = Math.floor(elapsed * CHARS_PER_SECOND * rateRef.current)
      const idx = currentIndexRef.current
      const currentText = paragraphsRef.current[idx] || ''
      const maxOffset = Math.max(0, currentText.length - 1)
      const store = useReaderStore.getState()
      if (estimatedChars > store.currentCharOffset) {
        setCurrentCharOffset(Math.min(estimatedChars, maxOffset))
      }
    }, 200)
    return () => clearInterval(timer)
  }, [isPlaying, setCurrentCharOffset])

  return {
    isSpeaking: isPlaying,
    ttsStatus: ttsStatus,
    startPlayback,
    pausePlayback,
    resumePlayback,
    stopPlayback,
  }
}

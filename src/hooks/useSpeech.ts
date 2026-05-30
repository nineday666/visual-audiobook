import { useEffect, useRef, useCallback } from 'react'
import { getSpeechEngine } from '../services/speech-engine'
import { useReaderStore } from '../stores/readerStore'
import { useSettingsStore } from '../stores/settingsStore'
import { CHARS_PER_SECOND } from '../types'

export function useSpeech() {
  const engine = useRef(getSpeechEngine()).current

  // === 用 ref 保存最新值，避免引擎回调中的闭包延迟 ===
  const paragraphsRef = useRef<string[]>([])
  const currentIndexRef = useRef(0)
  const rateRef = useRef(1.0)
  const pitchRef = useRef(1.0)
  const voiceRef = useRef('')
  const isPlayingRef = useRef(false)
  const paragraphStartRef = useRef(0)

  // 同步 Zustand → refs
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

  paragraphsRef.current = paragraphs
  currentIndexRef.current = currentParaIndex
  rateRef.current = speechRate || settingsRate || 1.0
  pitchRef.current = speechPitch
  voiceRef.current = selectedVoiceURI
  isPlayingRef.current = isPlaying

  // === 直接播放指定段落 ===
  // skipCancel=true: 段落间连续播放，不 cancel（Android 上避免卡顿）
  const speakIndex = useCallback((index: number, skipCancel = false) => {
    const paras = paragraphsRef.current
    if (index >= paras.length) {
      engine.stop()
      stop()
      return
    }
    const text = paras[index]
    if (!text?.trim()) {
      currentIndexRef.current = index + 1
      setCurrentParagraph(index + 1)
      speakIndex(index + 1, skipCancel)
      return
    }

    currentIndexRef.current = index
    paragraphStartRef.current = Date.now()
    setCurrentParagraph(index)
    setCurrentCharOffset(0)

    engine.speak(text, {
      rate: rateRef.current,
      pitch: pitchRef.current,
      voiceURI: voiceRef.current || undefined,
    }, skipCancel)
  }, [engine, stop, setCurrentParagraph, setCurrentCharOffset])

  // === 引擎事件：在回调里直接用 ref 推进到下一段，不等 React ===
  useEffect(() => {
    engine.onBoundary((e) => {
      setCurrentCharOffset(e.charIndex)
    })

    engine.onEnd(() => {
      // 段落间连续播放，skipCancel=true 避免 cancel 延迟
      const next = currentIndexRef.current + 1
      if (next < paragraphsRef.current.length) {
        speakIndex(next, true)
      } else {
        engine.stop()
        stop()
      }
    })

    engine.onError((e) => {
      console.error('Speech error:', e)
      pause()
    })

    return () => {
      engine.stop()
    }
  }, [engine, speakIndex, setCurrentCharOffset, stop, pause])

  // === 播放/暂停控制 ===
  const startPlayback = useCallback((paraIndex?: number) => {
    if (paraIndex !== undefined) {
      currentIndexRef.current = paraIndex
    }
    play()
    speakIndex(paraIndex ?? currentIndexRef.current)
  }, [play, speakIndex])

  const pausePlayback = useCallback(() => {
    engine.pause()
    pause()
  }, [engine, pause])

  const resumePlayback = useCallback(() => {
    engine.resume()
    play()
  }, [engine, play])

  const stopPlayback = useCallback(() => {
    engine.stop()
    stop()
  }, [engine, stop])

  // === 倍速/音色变化时立即重新朗读 ===
  useEffect(() => {
    if (!isPlayingRef.current) return
    const idx = currentIndexRef.current
    const text = paragraphsRef.current[idx]
    if (!text?.trim()) return
    speakIndex(idx)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speechRate, selectedVoiceURI])

  // === 定时器：模拟进度（移动端无 onboundary 时的兜底） ===
  useEffect(() => {
    if (!isPlaying) return

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
    isSpeaking: engine.isSpeaking(),
    startPlayback,
    pausePlayback,
    resumePlayback,
    stopPlayback,
  }
}

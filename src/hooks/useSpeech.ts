import { useEffect, useRef, useCallback } from 'react'
import { useReaderStore } from '../stores/readerStore'
import { useSettingsStore } from '../stores/settingsStore'
import { getSpeechEngine } from '../services/speech-engine'
import { CHARS_PER_SECOND } from '../types'

export function useSpeech() {
  const engineRef = useRef(getSpeechEngine())
  const engine = engineRef.current

  // Refs — 引擎回调里读最新值
  const paragraphsRef = useRef<string[]>([])
  const currentIndexRef = useRef(0)
  const rateRef = useRef(1.0)
  const voiceRef = useRef('')
  const isPlayingRef = useRef(false)
  const queuedRef = useRef(new Set<number>()) // 已排队的段落
  const paraStartRef = useRef(0)

  const paragraphs = useReaderStore((s) => s.paragraphs)
  const currentParaIndex = useReaderStore((s) => s.currentParaIndex)
  const speechRate = useReaderStore((s) => s.speechRate)
  const speechPitch = useReaderStore((s) => s.speechPitch)
  const selectedVoiceURI = useReaderStore((s) => s.selectedVoiceURI)
  const isPlaying = useReaderStore((s) => s.isPlaying)
  const setCurrentParagraph = useReaderStore((s) => s.setCurrentParagraph)
  const setCurrentCharOffset = useReaderStore((s) => s.setCurrentCharOffset)
  const stopAction = useReaderStore((s) => s.stop)
  const pauseAction = useReaderStore((s) => s.pause)
  const playAction = useReaderStore((s) => s.play)
  const settingsRate = useSettingsStore((s) => s.speechRate)

  paragraphsRef.current = paragraphs
  currentIndexRef.current = currentParaIndex
  rateRef.current = speechRate || settingsRate || 1.0
  voiceRef.current = selectedVoiceURI
  isPlayingRef.current = isPlaying

  // 队列一句到 speechSynthesis（不 cancel，排队自然衔接）
  const queueOne = useCallback((index: number) => {
    if (index >= paragraphsRef.current.length) return
    if (queuedRef.current.has(index)) return
    const text = paragraphsRef.current[index]
    if (!text?.trim()) {
      queuedRef.current.add(index)
      queueOne(index + 1)
      return
    }
    queuedRef.current.add(index)

    const utter = new SpeechSynthesisUtterance(text)
    utter.rate = rateRef.current
    utter.pitch = speechPitch
    utter.lang = 'zh-CN'
    utter.volume = 1

    if (voiceRef.current) {
      const voices = speechSynthesis.getVoices()
      const v = voices.find((vv) => vv.voiceURI === voiceRef.current)
      if (v) utter.voice = v
    }

    utter.onboundary = (e) => {
      if (index === currentIndexRef.current) {
        setCurrentCharOffset(e.charIndex)
      }
    }

    utter.onstart = () => {
      if (index !== currentIndexRef.current) {
        useReaderStore.getState().setCurrentParagraph(index)
        paraStartRef.current = Date.now()
      }
    }

    utter.onend = () => {
      queuedRef.current.delete(index)
      // 补充队列：保持后面总有排队的
      const maxQueued = Math.max(...queuedRef.current, index)
      for (let i = maxQueued + 1; i <= index + 4 && i < paragraphsRef.current.length; i++) {
        queueOne(i)
      }
    }

    utter.onerror = () => {
      queuedRef.current.delete(index)
    }

    speechSynthesis.speak(utter)
  }, [speechPitch, setCurrentCharOffset])

  // === 引擎事件（仅 onboundary 用于高亮；段落推进由排队自动处理） ===
  useEffect(() => {
    engine.onBoundary((e) => {
      setCurrentCharOffset(e.charIndex)
    })
    // onEnd 不再需要——排队自动衔接
  }, [engine, setCurrentCharOffset])

  // === 公开 API ===
  const startPlayback = useCallback((paraIndex?: number) => {
    const idx = paraIndex ?? currentIndexRef.current

    // 清空旧队列
    speechSynthesis.cancel()
    queuedRef.current.clear()

    // 从目标段落开始排队（当前 + 后 3 段）
    for (let i = idx; i < idx + 4 && i < paragraphsRef.current.length; i++) {
      queueOne(i)
    }

    currentIndexRef.current = idx
    paraStartRef.current = Date.now()
    setCurrentParagraph(idx)
    setCurrentCharOffset(0)
    playAction()
  }, [queueOne, setCurrentParagraph, setCurrentCharOffset, playAction])

  const pausePlayback = useCallback(() => {
    speechSynthesis.pause()
    pauseAction()
  }, [pauseAction])

  const resumePlayback = useCallback(() => {
    speechSynthesis.resume()
    playAction()
  }, [playAction])

  const stopPlayback = useCallback(() => {
    speechSynthesis.cancel()
    queuedRef.current.clear()
    stopAction()
  }, [stopAction])

  // 倍速变化 → 清空重排（因为 rate 已写入每个 utterance）
  useEffect(() => {
    if (!isPlayingRef.current) return
    const idx = currentIndexRef.current
    speechSynthesis.cancel()
    queuedRef.current.clear()
    for (let i = idx; i < idx + 4 && i < paragraphsRef.current.length; i++) {
      queueOne(i)
    }
  }, [speechRate, queueOne])

  // === 进度定时器（onboundary 在移动端不可靠的兜底） ===
  useEffect(() => {
    if (!isPlaying) return
    const timer = setInterval(() => {
      if (!useReaderStore.getState().isPlaying) return
      const elapsed = (Date.now() - paraStartRef.current) / 1000
      const estimatedChars = Math.floor(elapsed * CHARS_PER_SECOND * rateRef.current)
      const store = useReaderStore.getState()
      const text = store.paragraphs[store.currentParaIndex] || ''
      const maxOffset = Math.max(0, text.length - 1)
      if (estimatedChars > store.currentCharOffset) {
        setCurrentCharOffset(Math.min(estimatedChars, maxOffset))
      }
    }, 200)
    return () => clearInterval(timer)
  }, [isPlaying, setCurrentCharOffset])

  return {
    isSpeaking: isPlaying,
    ttsStatus: 'fallback' as const,
    startPlayback,
    pausePlayback,
    resumePlayback,
    stopPlayback,
  }
}

import { useEffect, useRef, useCallback, useState } from 'react'
import { useReaderStore } from '../stores/readerStore'
import { useSettingsStore } from '../stores/settingsStore'
import { getEdgeTts, hasProxyUrl } from '../services/edge-tts'
import { AudioPlayer } from '../services/audio-player'
import { CHARS_PER_SECOND } from '../types'

type TtsMode = 'cloud' | 'local'

export function useSpeech() {
  // === 云端 / 本地 双模式 ===
  const [mode, setMode] = useState<TtsMode>('local')

  // === Refs ===
  const paragraphsRef = useRef<string[]>([])
  const currentIndexRef = useRef(0)
  const rateRef = useRef(1.0)
  const voiceRef = useRef('')
  const isPlayingRef = useRef(false)
  const queuedRef = useRef(new Set<number>())
  const paraStartRef = useRef(0)

  // Cloud: AudioPlayer + Edge TTS
  const playerRef = useRef<AudioPlayer | null>(null)
  const ttsRef = useRef(getEdgeTts())
  const fetchingRef = useRef(new Set<number>())

  // Zustand
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

  // === 本地模式：Web Speech 队列（不需要 cancel） ===
  const queueLocal = useCallback((index: number) => {
    if (index >= paragraphsRef.current.length) return
    if (queuedRef.current.has(index)) return
    const text = paragraphsRef.current[index]
    if (!text?.trim()) { queuedRef.current.add(index); queueLocal(index + 1); return }
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

    utter.onboundary = (e) => { if (index === currentIndexRef.current) setCurrentCharOffset(e.charIndex) }
    utter.onstart = () => {
      if (index !== currentIndexRef.current) { useReaderStore.getState().setCurrentParagraph(index); paraStartRef.current = Date.now() }
    }
    utter.onend = () => {
      queuedRef.current.delete(index)
      const maxQ = Math.max(...queuedRef.current, index)
      for (let i = maxQ + 1; i <= index + 4 && i < paragraphsRef.current.length; i++) queueLocal(i)
    }
    utter.onerror = () => queuedRef.current.delete(index)
    speechSynthesis.speak(utter)
  }, [speechPitch, setCurrentCharOffset])

  // === 云端模式：Edge TTS → AudioPlayer ===
  const initPlayer = useCallback((): AudioPlayer => {
    if (playerRef.current) return playerRef.current
    const p = new AudioPlayer()
    p.setCallbacks({
      onStart: (idx) => { setCurrentParagraph(idx); paraStartRef.current = Date.now() },
      onEnd: (idx) => prefetchCloud(idx + 1),
      onProgress: (idx, off) => { if (idx === currentIndexRef.current) setCurrentCharOffset(off) },
    })
    playerRef.current = p
    return p
  }, [setCurrentParagraph, setCurrentCharOffset])

  const fetchAndBuffer = useCallback(async (index: number) => {
    if (index < 0 || index >= paragraphsRef.current.length) return
    if (fetchingRef.current.has(index)) return
    const text = paragraphsRef.current[index]
    if (!text?.trim()) { fetchingRef.current.add(index); return }
    fetchingRef.current.add(index)
    try {
      const buf = await ttsRef.current.synthesize(text)
      const player = playerRef.current!
      player.setParaCharLength(index, text.length)
      await player.preload(index, buf)
    } catch { /* 忽略 */ }
  }, [])

  const prefetchCloud = useCallback((from: number) => {
    for (let i = from; i < from + 3 && i < paragraphsRef.current.length; i++) fetchAndBuffer(i)
  }, [fetchAndBuffer])

  // === 公开 API ===
  const startPlayback = useCallback(async (paraIndex?: number) => {
    const idx = paraIndex ?? currentIndexRef.current
    currentIndexRef.current = idx

    if (hasProxyUrl()) {
      // 云端模式
      setMode('cloud')
      speechSynthesis.cancel()
      queuedRef.current.clear()

      const player = initPlayer()
      player.clearQueue()
      player.setRate(rateRef.current)
      fetchingRef.current.clear()
      prefetchCloud(idx)
      player.play(idx)
      playAction()
    } else {
      // 本地模式
      setMode('local')
      speechSynthesis.cancel()
      queuedRef.current.clear()
      for (let i = idx; i < idx + 4 && i < paragraphsRef.current.length; i++) queueLocal(i)
      paraStartRef.current = Date.now()
      setCurrentParagraph(idx)
      setCurrentCharOffset(0)
      playAction()
    }
  }, [queueLocal, initPlayer, prefetchCloud, setCurrentParagraph, setCurrentCharOffset, playAction])

  const pausePlayback = useCallback(() => {
    if (mode === 'cloud' && playerRef.current) playerRef.current.pause()
    else speechSynthesis.pause()
    pauseAction()
  }, [mode, pauseAction])

  const resumePlayback = useCallback(() => {
    if (mode === 'cloud' && playerRef.current) playerRef.current.resume()
    else speechSynthesis.resume()
    playAction()
  }, [mode, playAction])

  const stopPlayback = useCallback(() => {
    if (mode === 'cloud' && playerRef.current) playerRef.current.stop()
    else { speechSynthesis.cancel(); queuedRef.current.clear() }
    stopAction()
  }, [mode, stopAction])

  // 倍速变化 → 实时生效（云端改 playbackRate，本地重排队）
  useEffect(() => {
    if (!isPlayingRef.current) return
    if (mode === 'cloud' && playerRef.current) {
      playerRef.current.setRate(rateRef.current)
    } else {
      const idx = currentIndexRef.current
      speechSynthesis.cancel()
      queuedRef.current.clear()
      for (let i = idx; i < idx + 4 && i < paragraphsRef.current.length; i++) queueLocal(i)
    }
  }, [speechRate, mode, queueLocal])

  // 进度定时器（手机兜底）
  useEffect(() => {
    if (!isPlaying || mode === 'cloud') return
    const timer = setInterval(() => {
      if (!useReaderStore.getState().isPlaying) return
      const elapsed = (Date.now() - paraStartRef.current) / 1000
      const estimatedChars = Math.floor(elapsed * CHARS_PER_SECOND * rateRef.current)
      const text = paragraphsRef.current[currentIndexRef.current] || ''
      const maxOffset = Math.max(0, text.length - 1)
      const store = useReaderStore.getState()
      if (estimatedChars > store.currentCharOffset) setCurrentCharOffset(Math.min(estimatedChars, maxOffset))
    }, 200)
    return () => clearInterval(timer)
  }, [isPlaying, mode, setCurrentCharOffset])

  // 清理
  useEffect(() => () => { playerRef.current?.destroy() }, [])

  return {
    isSpeaking: isPlaying,
    ttsMode: mode,
    startPlayback,
    pausePlayback,
    resumePlayback,
    stopPlayback,
  }
}

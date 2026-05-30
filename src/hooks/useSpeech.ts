import { useEffect, useRef, useCallback, useState } from 'react'
import { useReaderStore } from '../stores/readerStore'
import { useSettingsStore } from '../stores/settingsStore'
import { getEdgeTts, hasProxyUrl } from '../services/edge-tts'
import { AudioPlayer } from '../services/audio-player'
import { CHARS_PER_SECOND } from '../types'

const BATCH_SIZE = 50 // 每批次合并的段落数（减少切换次数）

type TtsMode = 'cloud' | 'local'

// 构建批次：把多个段落合并为一个 utterance 文本，记录每个段落在大文本中的起始字符位置
interface Batch {
  text: string
  paraOffsets: number[] // paraOffsets[i] = 段落 i 在 text 中的起始 charIndex
  startIndex: number    // 第一个段落在全文中的索引
}

function buildBatch(paragraphs: string[], fromIndex: number): Batch | null {
  let text = ''
  const paraOffsets: number[] = []
  let count = 0
  for (let i = fromIndex; i < paragraphs.length && count < BATCH_SIZE; i++) {
    const p = paragraphs[i]
    if (p.trim()) {
      paraOffsets.push(text.length)
      text += p + '\n\n'
      count++
    }
  }
  if (!text.trim()) return null
  return { text, paraOffsets, startIndex: fromIndex }
}

export function useSpeech() {
  const [mode, setMode] = useState<TtsMode>('local')

  const paragraphsRef = useRef<string[]>([])
  const currentIndexRef = useRef(0)
  const rateRef = useRef(1.0)
  const voiceRef = useRef('')
  const isPlayingRef = useRef(false)
  const paraStartRef = useRef(0)
  const globalStartTimeRef = useRef(0) // 批次开始播放的绝对时间
  const globalStartOffsetRef = useRef(0) // 批次开始时已读到的累计字符偏移

  // Cloud
  const playerRef = useRef<AudioPlayer | null>(null)
  const ttsRef = useRef(getEdgeTts())
  const fetchingRef = useRef(new Set<number>())
  const audioCacheRef = useRef(new Map<number, ArrayBuffer>())

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

  // 创建单个批次的 utterance
  const makeBatchUtter = useCallback((fromIndex: number) => {
    const batch = buildBatch(paragraphsRef.current, fromIndex)
    if (!batch) return null

    const utter = new SpeechSynthesisUtterance(batch.text)
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
      const offs = batch.paraOffsets
      let paraInBatch = 0
      for (let i = offs.length - 1; i >= 0; i--) {
        if (e.charIndex >= offs[i]) { paraInBatch = i; break }
      }
      const globalIndex = batch.startIndex + paraInBatch
      if (globalIndex !== currentIndexRef.current) {
        useReaderStore.getState().setCurrentParagraph(globalIndex)
        paraStartRef.current = Date.now()
      }
      const paraStart = offs[paraInBatch] ?? 0
      setCurrentCharOffset(e.charIndex - paraStart)
    }

    utter.onstart = () => {
      if (fromIndex === currentIndexRef.current) paraStartRef.current = Date.now()
    }

    // onend 里补充队列，保证总有下一批在等待
    utter.onend = () => {
      const nextFrom = fromIndex + BATCH_SIZE
      const nextBatch = buildBatch(paragraphsRef.current, nextFrom)
      if (nextBatch && isPlayingRef.current) {
        const nextU = makeBatchUtter(nextFrom)
        if (nextU) speechSynthesis.speak(nextU)
      } else {
        stopAction()
      }
    }

    return utter
  }, [speechPitch, setCurrentCharOffset, stopAction])

  // 启动本地播放：一次排队 3 个批次，确保前两个无间隔
  const speakBatch = useCallback((fromIndex: number) => {
    const u1 = makeBatchUtter(fromIndex)
    const u2 = makeBatchUtter(fromIndex + BATCH_SIZE)
    const u3 = makeBatchUtter(fromIndex + BATCH_SIZE * 2)

    if (!u1) return
    speechSynthesis.speak(u1)
    if (u2) speechSynthesis.speak(u2)
    if (u3) speechSynthesis.speak(u3)
  }, [makeBatchUtter])

  // === 云端模式 ===
  const initPlayer = useCallback((): AudioPlayer => {
    if (playerRef.current) return playerRef.current
    const p = new AudioPlayer()
    p.setCallbacks({
      onStart: (idx) => { setCurrentParagraph(idx); paraStartRef.current = Date.now() },
      onEnd: () => {},
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
    let buf = audioCacheRef.current.get(index)
    if (!buf) {
      try { buf = await ttsRef.current.synthesize(text); audioCacheRef.current.set(index, buf) } catch { return }
    }
    const player = playerRef.current!
    player.setParaCharLength(index, text.length)
    await player.preload(index, buf)
  }, [])

  const prefetchCloud = useCallback((from: number) => {
    for (let i = from; i < from + 4 && i < paragraphsRef.current.length; i++) fetchAndBuffer(i)
  }, [fetchAndBuffer])

  // === API ===
  const startPlayback = useCallback(async (paraIndex?: number) => {
    const idx = paraIndex ?? currentIndexRef.current
    currentIndexRef.current = idx

    if (hasProxyUrl()) {
      setMode('cloud')
      speechSynthesis.cancel()
      const player = initPlayer()
      player.clearQueue()
      player.setRate(rateRef.current)
      fetchingRef.current.clear()
      prefetchCloud(idx)
      player.play(idx)
      playAction()
    } else {
      setMode('local')
      speechSynthesis.cancel()
      const offsets = useReaderStore.getState().cumulativeCharOffsets
      globalStartTimeRef.current = Date.now()
      globalStartOffsetRef.current = offsets[idx] ?? 0
      speakBatch(idx)
      playAction()
    }
  }, [speakBatch, initPlayer, prefetchCloud, playAction])

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
    else speechSynthesis.cancel()
    stopAction()
  }, [mode, stopAction])

  // 倍速变化
  useEffect(() => {
    if (!isPlayingRef.current) return
    if (mode === 'cloud' && playerRef.current) {
      playerRef.current.setRate(rateRef.current)
    } else {
      const idx = currentIndexRef.current
      const offsets = useReaderStore.getState().cumulativeCharOffsets
      globalStartTimeRef.current = Date.now()
      globalStartOffsetRef.current = offsets[idx] ?? 0
      speechSynthesis.cancel()
      speakBatch(idx)
    }
  }, [speechRate, mode, speakBatch])

  // 进度定时器（手机端 onboundary 不可靠，用全局字符偏移估算段落位置）
  useEffect(() => {
    if (!isPlaying || mode === 'cloud') return
    const timer = setInterval(() => {
      if (!useReaderStore.getState().isPlaying) return
      const elapsed = (Date.now() - globalStartTimeRef.current) / 1000
      const globalOffset = globalStartOffsetRef.current + elapsed * CHARS_PER_SECOND * rateRef.current
      const offsets = useReaderStore.getState().cumulativeCharOffsets
      const paras = paragraphsRef.current

      // 找到当前全局字符位置对应的段落
      let newPara = currentIndexRef.current
      for (let i = offsets.length - 1; i >= 0; i--) {
        if (offsets[i] <= globalOffset) { newPara = i; break }
      }
      if (newPara < 0) newPara = 0
      if (newPara >= paras.length) newPara = paras.length - 1

      const paraStart = offsets[newPara] ?? 0
      const charOff = Math.max(0, Math.floor(globalOffset - paraStart))
      const maxOff = Math.max(0, (paras[newPara] || '').length - 1)

      const store = useReaderStore.getState()
      if (newPara !== store.currentParaIndex) {
        setCurrentParagraph(newPara)
      }
      if (charOff > store.currentCharOffset) {
        setCurrentCharOffset(Math.min(charOff, maxOff))
      }
    }, 200)
    return () => clearInterval(timer)
  }, [isPlaying, mode, setCurrentParagraph, setCurrentCharOffset])

  useEffect(() => () => { playerRef.current?.destroy() }, [])

  return { isSpeaking: isPlaying, ttsMode: mode, startPlayback, pausePlayback, resumePlayback, stopPlayback }
}

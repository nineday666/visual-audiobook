import { useEffect, useRef, useCallback, useState } from 'react'
import { useReaderStore } from '../stores/readerStore'
import { useSettingsStore } from '../stores/settingsStore'
import { getEdgeTts, hasProxyUrl } from '../services/edge-tts'
import { AudioPlayer } from '../services/audio-player'
import { CHARS_PER_SECOND } from '../types'

const BATCH_SIZE = 8 // 每批次合并的段落数

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
  // 批次内的段落偏移
  const batchOffsetsRef = useRef<number[]>([])
  const batchStartRef = useRef(0)

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

  // === 本地模式：批次合成 + 预排队，消除批次间隔 ===
  const speakBatch = useCallback((fromIndex: number) => {
    const batch = buildBatch(paragraphsRef.current, fromIndex)
    if (!batch) return

    // 只有第一个批次更新偏移引用；后续批次在 onboundary 里切换
    if (fromIndex === currentIndexRef.current || batchStartRef.current === 0) {
      batchOffsetsRef.current = batch.paraOffsets
      batchStartRef.current = batch.startIndex
    }

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
      const offs = batchOffsetsRef.current
      let paraInBatch = 0
      for (let i = offs.length - 1; i >= 0; i--) {
        if (e.charIndex >= offs[i]) { paraInBatch = i; break }
      }
      const globalIndex = batchStartRef.current + paraInBatch
      if (globalIndex !== currentIndexRef.current) {
        useReaderStore.getState().setCurrentParagraph(globalIndex)
        paraStartRef.current = Date.now()
      }
      const paraStart = offs[paraInBatch] ?? 0
      setCurrentCharOffset(e.charIndex - paraStart)
    }

    utter.onstart = () => {
      if (fromIndex === currentIndexRef.current) {
        paraStartRef.current = Date.now()
      }
    }

    // 不再在 onend 里播下一批——下面直接预排队
    let isLastBatch = false
    utter.onend = () => {
      if (isLastBatch) stopAction()
    }

    utter.onerror = () => {}

    speechSynthesis.speak(utter)

    // 立即排队下一批次（浏览器 speech queue 自动衔接，零间隔）
    const nextFrom = batch.startIndex + BATCH_SIZE
    if (nextFrom < paragraphsRef.current.length) {
      // 下一批次用新的批次偏移
      const nextBatch = buildBatch(paragraphsRef.current, nextFrom)
      if (nextBatch) {
        const nextUtter = new SpeechSynthesisUtterance(nextBatch.text)
        nextUtter.rate = rateRef.current
        nextUtter.pitch = speechPitch
        nextUtter.lang = 'zh-CN'
        nextUtter.volume = 1
        if (voiceRef.current) {
          const voices = speechSynthesis.getVoices()
          const v = voices.find((vv) => vv.voiceURI === voiceRef.current)
          if (v) nextUtter.voice = v
        }
        nextUtter.onboundary = (e) => {
          const offs = nextBatch.paraOffsets
          let paraInBatch = 0
          for (let i = offs.length - 1; i >= 0; i--) {
            if (e.charIndex >= offs[i]) { paraInBatch = i; break }
          }
          const globalIndex = nextBatch.startIndex + paraInBatch
          if (globalIndex !== currentIndexRef.current) {
            useReaderStore.getState().setCurrentParagraph(globalIndex)
            paraStartRef.current = Date.now()
          }
          const paraStart = offs[paraInBatch] ?? 0
          setCurrentCharOffset(e.charIndex - paraStart)
        }
        const thirdFrom = nextFrom + BATCH_SIZE
        if (thirdFrom >= paragraphsRef.current.length) isLastBatch = true
        nextUtter.onend = () => {
          if (thirdFrom >= paragraphsRef.current.length) stopAction()
        }
        speechSynthesis.speak(nextUtter)
      }
    } else {
      isLastBatch = true
    }
  }, [speechPitch, setCurrentCharOffset, stopAction])

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
      speechSynthesis.cancel()
      speakBatch(idx)
    }
  }, [speechRate, mode, speakBatch])

  // 进度定时器
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

  useEffect(() => () => { playerRef.current?.destroy() }, [])

  return { isSpeaking: isPlaying, ttsMode: mode, startPlayback, pausePlayback, resumePlayback, stopPlayback }
}

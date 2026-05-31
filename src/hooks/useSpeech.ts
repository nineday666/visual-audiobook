import { useEffect, useRef, useCallback, useState } from 'react'
import { useReaderStore } from '../stores/readerStore'
import { useSettingsStore } from '../stores/settingsStore'
import { getEdgeTts, hasProxyUrl } from '../services/edge-tts'
import { AudioPlayer } from '../services/audio-player'
import { CHARS_PER_SECOND } from '../types'

const BATCH_SIZE = 20 // 每批次段落数（避免 Android TTS 引擎溢出）

type TtsMode = 'cloud' | 'local'

// 构建批次：把多个段落合并为一个 utterance 文本，记录每个段落在大文本中的起始字符位置
interface Batch {
  text: string
  paraOffsets: number[] // paraOffsets[i] = 段落 i 在 text 中的起始 charIndex
  startIndex: number    // 第一个段落在全文中的索引
}

function buildBatch(paragraphs: string[], fromIndex: number, firstParaOffset = 0): Batch | null {
  let text = ''
  const paraOffsets: number[] = []
  let count = 0
  for (let i = fromIndex; i < paragraphs.length && count < BATCH_SIZE; i++) {
    const p = paragraphs[i]
    if (p.trim()) {
      paraOffsets.push(text.length)
      // 第一个段落可以从中间截断（恢复暂停位置）
      text += (i === fromIndex ? p.slice(firstParaOffset) : p) + '\n\n'
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
  const activeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const calibratedCpsRef = useRef(CHARS_PER_SECOND)
  const queuedBatchesRef = useRef(new Set<number>()) // 跟踪已排队的批次，避免重复

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
  const settingsLang = useSettingsStore((s) => s.language)

  paragraphsRef.current = paragraphs
  currentIndexRef.current = currentParaIndex
  rateRef.current = speechRate || settingsRate || 1.0
  voiceRef.current = selectedVoiceURI
  isPlayingRef.current = isPlaying

  // 创建单个批次的 utterance
  const makeBatchUtter = useCallback((fromIndex: number, firstParaOffset = 0) => {
    const batch = buildBatch(paragraphsRef.current, fromIndex, firstParaOffset)
    if (!batch) return null

    const utter = new SpeechSynthesisUtterance(batch.text)
    utter.rate = rateRef.current
    utter.pitch = speechPitch
    utter.lang = settingsLang
    utter.volume = 1
    if (voiceRef.current) {
      const voices = speechSynthesis.getVoices()
      const v = voices.find((vv) => vv.voiceURI === voiceRef.current)
      if (v) utter.voice = v
    }

    const startTime = Date.now()
    const startOffset = firstParaOffset // 第一个段落跳过的字符数
    const offsets = batch.paraOffsets
    const batchStart = batch.startIndex
    let lastBoundaryTime = 0 // onboundary 最后触发时间，超过 2s 则计时器接管

    const applyPosition = (ci: number) => {
      // ci 是 utterance 内的字符位置；第一个段落的实际全文位置 = startOffset + ci
      let paraInBatch = 0
      for (let i = offsets.length - 1; i >= 0; i--) {
        if (ci >= offsets[i]) { paraInBatch = i; break }
      }
      const globalIdx = batchStart + paraInBatch
      if (globalIdx >= paragraphsRef.current.length) return
      const store = useReaderStore.getState()
      if (globalIdx !== store.currentParaIndex) {
        setCurrentParagraph(globalIdx)
      }
      const paraStart = offsets[paraInBatch] ?? 0
      let off = Math.max(0, ci - paraStart)
      // 第一个段落需要加上跳过的偏移
      if (paraInBatch === 0 && startOffset > 0) {
        off += startOffset
      }
      const maxOff = Math.max(0, (paragraphsRef.current[globalIdx] || '').length - 1)
      if (off > store.currentCharOffset) {
        setCurrentCharOffset(Math.min(off, maxOff))
      }
    }

    utter.onboundary = (e) => {
      lastBoundaryTime = Date.now()
      applyPosition(e.charIndex)
    }

    utter.onstart = () => {
      if (activeTimerRef.current) clearInterval(activeTimerRef.current)
      activeTimerRef.current = setInterval(() => {
        // 检测音频是否意外停止（Android TTS 引擎可能静默挂掉）
        if (!speechSynthesis.speaking && !speechSynthesis.pending && isPlayingRef.current) {
          // 音频停了但状态还是"播放中"→ 强制推进下一批次
          if (activeTimerRef.current) clearInterval(activeTimerRef.current)
          const nextFrom = batchStart + BATCH_SIZE
          const nextBatch = buildBatch(paragraphsRef.current, nextFrom)
          if (nextBatch) {
            const nextU = makeBatchUtter(nextFrom)
            if (nextU) speechSynthesis.speak(nextU)
          } else {
            stopAction()
          }
          return
        }
        // onboundary 最近 2 秒内触发过 → 让它主导；否则计时器接管
        if (Date.now() - lastBoundaryTime < 2000) return
        const ci = Math.floor((Date.now() - startTime) / 1000 * calibratedCpsRef.current * rateRef.current)
        applyPosition(ci)
      }, 500)
    }

    utter.onend = () => {
      if (activeTimerRef.current) { clearInterval(activeTimerRef.current); activeTimerRef.current = null }
      if (lastBoundaryTime === 0) {
        const elapsed = (Date.now() - startTime) / 1000
        if (elapsed > 2) {
          const actualCps = batch.text.length / elapsed / rateRef.current
          calibratedCpsRef.current = calibratedCpsRef.current * 0.5 + actualCps * 0.5
        }
      }
      queuedBatchesRef.current.delete(batchStart)
      const nextFrom = batchStart + BATCH_SIZE
      // 防止重复排队
      if (!queuedBatchesRef.current.has(nextFrom)) {
        const nextBatch = buildBatch(paragraphsRef.current, nextFrom)
        if (nextBatch && isPlayingRef.current) {
          const nextU = makeBatchUtter(nextFrom)
          if (nextU) {
            queuedBatchesRef.current.add(nextFrom)
            speechSynthesis.speak(nextU)
          }
        } else if (!nextBatch) {
          stopAction()
        }
      }
    }

    utter.onerror = () => {
      if (activeTimerRef.current) { clearInterval(activeTimerRef.current); activeTimerRef.current = null }
    }

    return utter
  }, [speechPitch, setCurrentCharOffset, stopAction])

  // 启动本地播放：支持从段落中间恢复
  const speakBatch = useCallback((fromIndex: number, firstParaOffset = 0) => {
    queuedBatchesRef.current.clear()
    const u1 = makeBatchUtter(fromIndex, firstParaOffset)
    if (!u1) return
    queuedBatchesRef.current.add(fromIndex)
    speechSynthesis.speak(u1)
    const u2 = makeBatchUtter(fromIndex + BATCH_SIZE)
    if (u2) {
      queuedBatchesRef.current.add(fromIndex + BATCH_SIZE)
      speechSynthesis.speak(u2)
    }
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
      // 从暂停位置恢复：传递当前字符偏移
      const savedOffset = useReaderStore.getState().currentCharOffset
      speakBatch(idx, savedOffset > 0 ? savedOffset : 0)
      playAction()
    }
  }, [speakBatch, initPlayer, prefetchCloud, playAction])

  const pausePlayback = useCallback(() => {
    if (mode === 'cloud' && playerRef.current) playerRef.current.pause()
    else speechSynthesis.pause()
    pauseAction()
  }, [mode, pauseAction])

  const resumePlayback = useCallback(() => {
    if (mode === 'cloud' && playerRef.current) {
      playerRef.current.resume()
      playAction()
    } else {
      // 本地模式：取消暂停的语音，从断点重新开始
      const idx = currentIndexRef.current
      const offset = useReaderStore.getState().currentCharOffset
      speechSynthesis.cancel()
      queuedBatchesRef.current.clear()
      speakBatch(idx, offset > 0 ? offset : 0)
      playAction()
    }
  }, [mode, playAction, speakBatch])

  const stopPlayback = useCallback(() => {
    if (mode === 'cloud' && playerRef.current) playerRef.current.stop()
    else { speechSynthesis.cancel(); queuedBatchesRef.current.clear() }
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
      queuedBatchesRef.current.clear()
      speakBatch(idx)
    }
  }, [speechRate, mode, speakBatch])

  useEffect(() => {
    return () => {
      speechSynthesis.cancel()
      queuedBatchesRef.current.clear()
      playerRef.current?.destroy()
    }
  }, [])

  return { isSpeaking: isPlaying, ttsMode: mode, startPlayback, pausePlayback, resumePlayback, stopPlayback }
}

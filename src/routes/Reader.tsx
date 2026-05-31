import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getBook } from '../services/db'
import { useReaderStore } from '../stores/readerStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useSpeech } from '../hooks/useSpeech'
import { useMediaSession } from '../hooks/useMediaSession'
import { hasProxyUrl, setProxyUrl } from '../services/edge-tts'
import type { Book, ContextMenuState } from '../types'
import {
  FONT_SIZE_MAP,
  LINE_HEIGHT_MAP,
  CHARS_PER_SECOND,
  estimateTotalSeconds,
  estimateElapsedSeconds,
  findParagraphBySeconds,
} from '../types'
import { formatRate } from '../utils/format'
import Paragraph from '../components/reader/Paragraph'
import ContextMenu from '../components/common/ContextMenu'
import AudioControls from '../components/reader/AudioControls'

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export default function Reader() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [book, setBook] = useState<Book | null>(null)
  const [loading, setLoading] = useState(true)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false, x: 0, y: 0, paraIndex: 0,
  })
  const [timeInput, setTimeInput] = useState('')
  const [showProxyInput, setShowProxyInput] = useState(false)
  const [proxyUrlInput, setProxyUrlInput] = useState('')
  const [forceLocal, setForceLocal] = useState(false)
  const [userScrolled, setUserScrolled] = useState(false)
  const [showSettings, setShowSettings] = useState(false) // 用户手动滚动后停止自动跟随

  // === 精细 selector ===
  const currentParaIndex = useReaderStore((s) => s.currentParaIndex)
  const currentCharOffset = useReaderStore((s) => s.currentCharOffset)
  const cumulativeCharOffsets = useReaderStore((s) => s.cumulativeCharOffsets)
  const isPlaying = useReaderStore((s) => s.isPlaying)
  const speechRate = useReaderStore((s) => s.speechRate)

  const fontSize = useSettingsStore((s) => s.fontSize)
  const lineHeight = useSettingsStore((s) => s.lineHeight)
  const setLineHeight = useSettingsStore((s) => s.setLineHeight)
  const setFontSize = useSettingsStore((s) => s.setFontSize)
  const language = useSettingsStore((s) => s.language)
  const setLanguage = useSettingsStore((s) => s.setLanguage)
  const { startPlayback, pausePlayback, resumePlayback, stopPlayback, ttsMode } = useSpeech()
  useMediaSession()

  const paraRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // 加载书籍
  useEffect(() => {
    if (!id) return

    const { loadBook, reset, setVoice } = useReaderStore.getState()

    ;(async () => {
      const b = await getBook(id)
      if (!b) {
        navigate('/')
        return
      }
      setBook(b)
      loadBook(b.id, b.paragraphs, b.progress ? {
        currentParaIndex: b.progress.currentParaIndex,
        currentCharOffset: b.progress.currentCharOffset,
        totalListeningMs: b.progress.totalListeningMs,
      } : undefined)

      // 从设置恢复首选语音
      const settings = useSettingsStore.getState()
      if (settings.preferredVoiceURI) {
        setVoice(settings.preferredVoiceURI)
      }
      // 恢复上次倍速
      if (settings.speechRate && settings.speechRate !== 1.0) {
        useReaderStore.getState().setRate(settings.speechRate)
      }

      setLoading(false)
    })()

    return () => {
      reset()
    }
  }, [id, navigate])

  // 检测用户手动滚动
  const handleUserScroll = useCallback(() => {
    if (isPlaying) setUserScrolled(true)
  }, [isPlaying])

  // 返回当前位置
  const scrollToCurrent = useCallback(() => {
    setUserScrolled(false)
    const ref = paraRefs.current.get(currentParaIndex)
    if (ref) {
      ref.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [currentParaIndex])

  // 自动滚动（用户未手动滚动时才跟随）
  useEffect(() => {
    if (userScrolled) return
    const ref = paraRefs.current.get(currentParaIndex)
    if (ref && isPlaying) {
      ref.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [currentParaIndex, isPlaying, userScrolled])

  // === 时间进度计算 ===
  const totalChars = book?.totalChars ?? 0
  const effectiveRate = speechRate || 1.0
  const totalSeconds = estimateTotalSeconds(totalChars, effectiveRate)

  // 当前已过秒数（基于字符偏移估算）
  const currentSeconds = estimateElapsedSeconds(
    cumulativeCharOffsets, currentParaIndex, currentCharOffset, effectiveRate,
  )

  // 每秒刷新 UI（播放时 time 显示需要实时更新）
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!isPlaying) return
    const timer = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(timer)
  }, [isPlaying])

  // 长按处理
  const handleLongPress = useCallback((paraIndex: number, x: number, y: number) => {
    setContextMenu({ visible: true, x, y, paraIndex })
  }, [])

  const handleStartFromHere = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, visible: false }))
    const store = useReaderStore.getState()
    store.setCurrentParagraph(contextMenu.paraIndex)
    if (store.isPlaying) {
      stopPlayback()
      setTimeout(() => {
        useReaderStore.getState().setCurrentParagraph(contextMenu.paraIndex)
        startPlayback(contextMenu.paraIndex)
      }, 100)
    } else {
      startPlayback(contextMenu.paraIndex)
    }
  }, [contextMenu.paraIndex, startPlayback, stopPlayback])

  const handleTogglePlay = useCallback(() => {
    const store = useReaderStore.getState()
    if (store.isPlaying) {
      pausePlayback()
    } else if (store.isPaused) {
      resumePlayback()
    } else {
      startPlayback(store.currentParaIndex)
    }
  }, [startPlayback, pausePlayback, resumePlayback])

  const handleBack = useCallback(() => {
    if (useReaderStore.getState().isPlaying) {
      pausePlayback()
    }
    navigate('/')
  }, [pausePlayback, navigate])

  // 进度条拖动 — 秒数→段落+段内字符偏移（精确到秒）
  const handleProgressSeek = useCallback((targetSeconds: number) => {
    const store = useReaderStore.getState()
    const offsets = store.cumulativeCharOffsets
    const rate = store.speechRate || 1.0
    const idx = findParagraphBySeconds(offsets, targetSeconds, rate)

    // 计算段内字符偏移，确保跳转到精确位置而非段落开头
    const targetCharOffset = Math.floor(targetSeconds * CHARS_PER_SECOND * rate)
    const paraStartOffset = offsets[idx] ?? 0
    const withinParaOffset = Math.max(0, targetCharOffset - paraStartOffset)

    store.setCurrentParagraph(idx)
    store.setCurrentCharOffset(withinParaOffset)

    if (store.isPlaying) {
      stopPlayback()
      setTimeout(() => startPlayback(idx), 100)
    }
  }, [stopPlayback, startPlayback])

  // 输入时间跳转
  const handleTimeJump = useCallback(() => {
    const trimmed = timeInput.trim()
    if (!trimmed) return
    // 支持 "12:34" 或 "5:00" 或 "90" 格式
    let seconds = 0
    if (trimmed.includes(':')) {
      const parts = trimmed.split(':')
      const mins = parseInt(parts[0]) || 0
      const secs = parseInt(parts[1]) || 0
      seconds = mins * 60 + secs
    } else {
      seconds = parseInt(trimmed) || 0
    }
    if (seconds >= 0) {
      handleProgressSeek(seconds)
      setTimeInput('')
    }
  }, [timeInput, handleProgressSeek])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-slate-400 animate-pulse">加载书籍...</div>
      </div>
    )
  }

  if (!book) return null

  const isCurrentPara = (index: number) => index === currentParaIndex

  return (
    <div className="flex flex-col h-screen">
      {/* 顶栏 */}
      <header className="sticky top-0 z-20 bg-white/80 dark:bg-slate-950/80 backdrop-blur border-b border-slate-200 dark:border-slate-800 px-4 py-3 flex items-center gap-3">
        <button
          onClick={handleBack}
          className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-lg flex-shrink-0"
          aria-label="返回"
        >
          ←
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="font-medium text-sm truncate flex items-center gap-2">
            {book.title}
            {!forceLocal && ttsMode === 'cloud' && (
              <span className="text-[10px] px-1.5 py-0.5 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 rounded-full flex-shrink-0">云端</span>
            )}
          </h2>
          <p className="text-xs text-slate-400">
            {formatTime(currentSeconds)} / {formatTime(totalSeconds)} · {currentParaIndex + 1}/{book.paragraphs.length}段
          </p>
        </div>

        {/* 云端/离线切换 */}
        <button
          onClick={() => {
            if (forceLocal) {
              // 当前是强制离线 → 检查是否有代理URL
              if (hasProxyUrl()) {
                setForceLocal(false)
              } else {
                setShowProxyInput(!showProxyInput)
              }
            } else {
              // 当前允许云端 → 改为离线（移除代理URL使useSpeech生效）
              localStorage.removeItem('tts_proxy_url')
              setForceLocal(true)
            }
          }}
          className={`text-[10px] px-2 py-1 rounded-full flex-shrink-0 transition-colors ${
            !forceLocal && hasProxyUrl()
              ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
          }`}
          title={forceLocal ? '切换到云端 TTS' : '切换到离线语音'}
        >
          {!forceLocal && hasProxyUrl() ? '☁️' : '🔊'}
        </button>

        {/* 设置 */}
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-sm"
            aria-label="设置"
          >
            ⚙
          </button>
          {showSettings && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowSettings(false)} />
              <div className="absolute right-0 top-10 z-40 w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl p-3">
                {/* 字体大小 */}
                <div className="mb-3">
                  <p className="text-xs text-slate-500 mb-1.5">字体大小</p>
                  <div className="flex gap-1">
                    {(['sm', 'md', 'lg', 'xl'] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setFontSize(s)}
                        className={`flex-1 text-xs py-1 rounded-md transition-colors ${
                          fontSize === s
                            ? 'bg-blue-500 text-white'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                        }`}
                      >
                        {s === 'sm' ? '小' : s === 'md' ? '中' : s === 'lg' ? '大' : '特大'}
                      </button>
                    ))}
                  </div>
                </div>
                {/* 行距 */}
                <div className="mb-3">
                  <p className="text-xs text-slate-500 mb-1.5">行距</p>
                  <div className="flex gap-1">
                    {(['compact', 'normal', 'relaxed'] as const).map((lh) => (
                      <button
                        key={lh}
                        onClick={() => setLineHeight(lh)}
                        className={`flex-1 text-xs py-1 rounded-md transition-colors ${
                          lineHeight === lh
                            ? 'bg-blue-500 text-white'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                        }`}
                      >
                        {lh === 'compact' ? '紧' : lh === 'normal' ? '常' : '松'}
                      </button>
                    ))}
                  </div>
                </div>
                {/* 语言 */}
                <div>
                  <p className="text-xs text-slate-500 mb-1.5">朗读语言</p>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setLanguage('zh-CN')}
                      className={`flex-1 text-xs py-1 rounded-md transition-colors ${
                        language === 'zh-CN'
                          ? 'bg-blue-500 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      中文
                    </button>
                    <button
                      onClick={() => setLanguage('en-US')}
                      className={`flex-1 text-xs py-1 rounded-md transition-colors ${
                        language === 'en-US'
                          ? 'bg-blue-500 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      English
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </header>

      {/* 代理 URL 设置 */}
      {showProxyInput && (
        <div className="px-4 py-2 bg-blue-50 dark:bg-blue-950/30 border-b border-blue-200 dark:border-blue-800">
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="粘贴 Deno/Cloudflare Worker URL"
              value={proxyUrlInput}
              onChange={(e) => setProxyUrlInput(e.target.value)}
              className="flex-1 text-xs px-2 py-1.5 border border-blue-300 dark:border-blue-700 rounded bg-white dark:bg-slate-900 outline-none"
            />
            <button
              onClick={() => {
                if (proxyUrlInput.trim()) {
                  setProxyUrl(proxyUrlInput.trim())
                  setForceLocal(false)
                  setShowProxyInput(false)
                }
              }}
              className="text-xs px-3 py-1.5 bg-blue-500 text-white rounded hover:bg-blue-600 flex-shrink-0"
            >
              连接云端
            </button>
            <button
              onClick={() => setShowProxyInput(false)}
              className="text-xs px-2 py-1.5 text-slate-400 hover:text-slate-600 flex-shrink-0"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* 文本区域 */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-4 py-6"
        onScroll={handleUserScroll}
        onTouchMove={handleUserScroll}
      >
        <div className={`${FONT_SIZE_MAP[fontSize]} ${LINE_HEIGHT_MAP[lineHeight]}`}>
          {book.paragraphs.map((para, i) => (
            <Paragraph
              key={i}
              text={para}
              index={i}
              isActive={isCurrentPara(i)}
              charOffset={isCurrentPara(i) ? currentCharOffset : -1}
              paraRefs={paraRefs}
              onLongPress={handleLongPress}
            />
          ))}
        </div>

        <div className="h-32" />

        {/* 浮动返回按钮 */}
        {userScrolled && (
          <button
            onClick={scrollToCurrent}
            className="fixed bottom-32 right-4 z-30 px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white text-xs rounded-full shadow-lg transition-all animate-bounce"
          >
            📍 回到当前
          </button>
        )}
      </div>

      {/* 底栏 — 播放控制 */}
      <div className="sticky bottom-0 z-20 bg-white/90 dark:bg-slate-950/90 backdrop-blur border-t border-slate-200 dark:border-slate-800 px-4 py-3">
        {/* 时间进度条 */}
        <div className="mb-3 flex items-center gap-3">
          <span className="text-xs text-slate-500 w-10 text-right tabular-nums flex-shrink-0">
            {formatTime(currentSeconds)}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(1, Math.ceil(totalSeconds))}
            step={1}
            value={Math.floor(currentSeconds)}
            onChange={(e) => handleProgressSeek(parseInt(e.target.value))}
            className="flex-1 h-1 appearance-none bg-slate-200 dark:bg-slate-700 rounded-full cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500
              [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow"
          />
          <span className="text-xs text-slate-500 w-10 flex-shrink-0 tabular-nums">
            {formatTime(totalSeconds)}
          </span>
        </div>

        {/* 时间输入跳转 */}
        <div className="mb-3 flex items-center justify-center gap-2">
          <input
            type="text"
            inputMode="numeric"
            placeholder="输入时间跳转，如 1:30"
            value={timeInput}
            onChange={(e) => setTimeInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleTimeJump() }}
            className="w-44 text-xs px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 placeholder:text-slate-400 outline-none focus:border-blue-500 transition-colors"
          />
          <button
            onClick={handleTimeJump}
            className="text-xs px-3 py-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex-shrink-0"
          >
            跳转
          </button>
        </div>

        <AudioControls
          isPlaying={isPlaying}
          onTogglePlay={handleTogglePlay}
          onStop={stopPlayback}
          rate={speechRate || useSettingsStore.getState().speechRate}
          onRateChange={(rate) => {
            useReaderStore.getState().setRate(rate)
            useSettingsStore.getState().setSpeechRate(rate)
          }}
          disabled={!book}
        />

        <div className="text-center mt-2">
          <span className="text-xs text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">
            倍速 {formatRate(speechRate || useSettingsStore.getState().speechRate)}
          </span>
        </div>
      </div>

      <ContextMenu
        state={contextMenu}
        onClose={() => setContextMenu((prev) => ({ ...prev, visible: false }))}
        onStartFromHere={handleStartFromHere}
      />
    </div>
  )
}

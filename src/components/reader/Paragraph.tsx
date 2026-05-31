import { memo, useCallback, useRef, useEffect } from 'react'
import type { MutableRefObject } from 'react'
import { useLongPress } from '../../hooks/useLongPress'

interface Props {
  text: string
  index: number
  isActive: boolean
  charOffset: number
  paraRefs: MutableRefObject<Map<number, HTMLDivElement>>
  onLongPress: (paraIndex: number, x: number, y: number) => void
  markedWords?: Set<string>
  onMarkWord?: (word: string) => void
  isListeningMode?: boolean
  activeSentence?: string
  onSelectSentence?: (sentence: string, paraIndex: number, charStart: number) => void
}

// 按中英文标点切分句子
function splitSentences(text: string): string[] {
  // 匹配句末标点后跟空格或换行处切分
  return text
    .split(/(?<=[。！？.!?\n])\s*/)
    .flatMap((s) => s.split(/(?<=[;；]\s*)/)) // 分号也切开
    .filter((s) => s.trim())
}

// 按单词或汉字切分文本
function splitWords(text: string): string[] {
  // 英文按空格+标点切分，中文按字切分
  const parts: string[] = []
  let buf = ''
  for (const ch of text) {
    if (/[一-鿿]/.test(ch)) {
      // 中文：先把缓冲区清空，再独立成词
      if (buf.trim()) parts.push(buf.trim())
      buf = ''
      parts.push(ch)
    } else if (/\s/.test(ch)) {
      if (buf.trim()) parts.push(buf.trim())
      buf = ''
      parts.push(ch)
    } else {
      buf += ch
    }
  }
  if (buf.trim()) parts.push(buf.trim())
  return parts
}

function normalizeWord(w: string): string {
  return w.toLowerCase().replace(/[.,!?;:'"()\[\]{}，。！？；：""''（）【】\s]+/g, '').trim()
}

function Paragraph({ text, index, isActive, charOffset, paraRefs, onLongPress, markedWords, onMarkWord, isListeningMode, activeSentence, onSelectSentence }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (ref.current) {
      paraRefs.current.set(index, ref.current)
      return () => { paraRefs.current.delete(index) }
    }
  }, [index, paraRefs])

  const handleLongPress = useCallback(() => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect()
      onLongPress(index, rect.left + rect.width / 2, rect.top)
    }
  }, [index, onLongPress])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    onLongPress(index, e.clientX, e.clientY)
  }, [index, onLongPress])

  const longPressHandlers = useLongPress({ onLongPress: handleLongPress, delay: 500 })

  // 渲染文本：朗读高亮 + 词汇标记
  const renderText = () => {
    // 听力模式：按句子渲染 + 分词标记 + 朗读高亮
    if (isListeningMode && markedWords && onMarkWord) {
      const sentences = splitSentences(text)
      // 确定当前朗读字符位于哪个句子中
      let globalCharPos = 0
      return sentences.map((sentence, si) => {
        const sentenceStart = globalCharPos
        const sentenceLen = sentence.length
        globalCharPos += sentenceLen
        const words = splitWords(sentence)
        const sentenceKey = sentence.trim()
        const isSentenceActive = activeSentence === sentenceKey
        // 朗读高亮：精确到词级别
        const inThisSentence = isActive && charOffset >= sentenceStart && charOffset < sentenceStart + sentenceLen
        const relOffset = charOffset - sentenceStart // 句内字符偏移
        // 计算每个词在句内的字符范围
        let wordCharPos = 0
        const wordRanges = words.map((w) => {
          const start = wordCharPos
          wordCharPos += w.length
          return { start, end: wordCharPos, word: w }
        })
        const activeWordIdx = wordRanges.findIndex((r) => relOffset >= r.start && relOffset < r.end)
        return (
          <span
            key={si}
            className={`inline cursor-pointer rounded px-0.5 ${isSentenceActive ? 'bg-orange-200 dark:bg-orange-800/40 outline outline-1 outline-orange-400' : ''}`}
            onDoubleClick={(e) => { e.stopPropagation(); onSelectSentence?.(sentenceKey, index, sentenceStart) }}
            title={isSentenceActive ? '双击取消' : '双击选中此句复读'}
          >
            {words.map((w, i) => {
              const key = normalizeWord(w)
              if (!key) return <span key={i}>{w}</span>
              const isMarked = markedWords.has(key)
              const isReading = inThisSentence && i === activeWordIdx
              return (
                <span
                  key={i}
                  className={`cursor-pointer ${isReading ? 'word-highlight' : ''} ${isMarked ? 'bg-yellow-200 dark:bg-yellow-800/50 rounded px-0.5' : ''}`}
                  onClick={(e2) => { e2.stopPropagation(); onMarkWord(key) }}
                  title={isReading ? '正在朗读' : isMarked ? '点击取消标记' : '点击标记生词'}
                >
                  {w}
                </span>
              )
            })}
          </span>
        )
      })
    }

    // 听书模式：高亮当前朗读位置
    if (!isActive || charOffset < 0 || charOffset >= text.length) {
      return <span>{text}</span>
    }

    const before = text.slice(0, charOffset)
    const highlightLen = Math.min(8, text.length - charOffset)
    const highlight = text.slice(charOffset, charOffset + highlightLen)
    const after = text.slice(charOffset + highlightLen)

    return (
      <>
        <span>{before}</span>
        <span className="word-highlight">{highlight}</span>
        <span>{after}</span>
      </>
    )
  }

  return (
    <div
      ref={ref}
      className={`
        selectable mb-3 py-2 px-3 rounded-lg cursor-pointer
        ${isActive ? 'paragraph-active' : 'paragraph-normal hover:bg-slate-100 dark:hover:bg-slate-900/50'}
      `}
      {...longPressHandlers}
      onContextMenu={handleContextMenu}
    >
      {renderText()}
    </div>
  )
}

export default memo(Paragraph)

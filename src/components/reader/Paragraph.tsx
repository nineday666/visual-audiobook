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

function Paragraph({ text, index, isActive, charOffset, paraRefs, onLongPress, markedWords, onMarkWord, isListeningMode }: Props) {
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
    // 听力模式：分词渲染，支持点击标记
    if (isListeningMode && markedWords && onMarkWord) {
      const words = splitWords(text)
      return words.map((w, i) => {
        const key = normalizeWord(w)
        if (!key) return <span key={i}>{w}</span>
        const isMarked = markedWords.has(key)
        return (
          <span
            key={i}
            className={`cursor-pointer ${isMarked ? 'bg-yellow-200 dark:bg-yellow-800/50 rounded px-0.5' : ''}`}
            onClick={(e) => { e.stopPropagation(); onMarkWord(key) }}
            title={isMarked ? '点击取消标记' : '点击标记生词'}
          >
            {w}
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

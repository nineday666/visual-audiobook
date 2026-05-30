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
}

function Paragraph({ text, index, isActive, charOffset, paraRefs, onLongPress }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  // 注册 ref
  useEffect(() => {
    if (ref.current) {
      paraRefs.current.set(index, ref.current)
      return () => {
        paraRefs.current.delete(index)
      }
    }
  }, [index, paraRefs])

  const handleLongPress = useCallback(() => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect()
      onLongPress(index, rect.left + rect.width / 2, rect.top)
    }
  }, [index, onLongPress])

  // 右键（桌面端）也触发菜单
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    onLongPress(index, e.clientX, e.clientY)
  }, [index, onLongPress])

  const longPressHandlers = useLongPress({
    onLongPress: handleLongPress,
    delay: 500,
  })

  // 渲染文本：高亮当前朗读位置
  const renderText = () => {
    if (!isActive || charOffset < 0 || charOffset >= text.length) {
      return <span>{text}</span>
    }

    const before = text.slice(0, charOffset)
    // 高亮范围：从 charOffset 到下一个标点或词边界（~5字符）
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

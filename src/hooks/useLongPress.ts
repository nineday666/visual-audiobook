import { useCallback, useRef } from 'react'

interface UseLongPressOptions {
  onLongPress: () => void
  delay?: number
  moveThreshold?: number
}

export function useLongPress({
  onLongPress,
  delay = 600,
  moveThreshold = 20,
}: UseLongPressOptions) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startPosRef = useRef<{ x: number; y: number } | null>(null)
  const triggeredRef = useRef(false)

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      clear()
      triggeredRef.current = false
      const touch = e.touches[0]
      startPosRef.current = { x: touch.clientX, y: touch.clientY }
      timerRef.current = setTimeout(() => {
        triggeredRef.current = true
        onLongPress()
      }, delay)
    },
    [onLongPress, delay, clear]
  )

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!startPosRef.current) return
      const touch = e.touches[0]
      const dx = Math.abs(touch.clientX - startPosRef.current.x)
      const dy = Math.abs(touch.clientY - startPosRef.current.y)
      if (dx > moveThreshold || dy > moveThreshold) {
        clear()
      }
    },
    [moveThreshold, clear]
  )

  const onTouchEnd = useCallback(() => {
    clear()
  }, [clear])

  // Mouse support (for desktop)
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      clear()
      triggeredRef.current = false
      startPosRef.current = { x: e.clientX, y: e.clientY }
      timerRef.current = setTimeout(() => {
        triggeredRef.current = true
        onLongPress()
      }, delay)
    },
    [onLongPress, delay, clear]
  )

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!startPosRef.current) return
      const dx = Math.abs(e.clientX - startPosRef.current.x)
      const dy = Math.abs(e.clientY - startPosRef.current.y)
      if (dx > moveThreshold || dy > moveThreshold) {
        clear()
      }
    },
    [moveThreshold, clear]
  )

  const onMouseUp = useCallback(() => {
    clear()
  }, [clear])

  // 防止长按触发文本选择
  const onContextMenu = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (triggeredRef.current) {
      e.preventDefault()
    }
  }, [])

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onContextMenu,
  }
}

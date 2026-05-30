import { useEffect, useRef } from 'react'
import type { ContextMenuState } from '../../types'

interface Props {
  state: ContextMenuState
  onClose: () => void
  onStartFromHere: () => void
}

export default function ContextMenu({ state, onClose, onStartFromHere }: Props) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!state.visible) return

    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // 延迟绑定避免触发时的点击也关闭菜单
    setTimeout(() => document.addEventListener('click', handleClick), 0)
    return () => document.removeEventListener('click', handleClick)
  }, [state.visible, onClose])

  if (!state.visible) return null

  // 计算菜单位置（保持在屏幕内）
  const menuWidth = 200
  const menuHeight = 60
  const padding = 16

  const left = Math.min(state.x, window.innerWidth - menuWidth - padding)
  const top = Math.min(state.y, window.innerHeight - menuHeight - padding)

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl py-1 overflow-hidden animate-in zoom-in-95"
      style={{
        left: Math.max(padding, left),
        top: Math.max(padding, top),
        minWidth: menuWidth,
      }}
    >
      <button
        onClick={onStartFromHere}
        className="w-full text-left px-4 py-3 text-sm hover:bg-blue-50 dark:hover:bg-blue-950/50 transition-colors flex items-center gap-2"
      >
        <span>▶</span>
        <span>从此处开始朗读</span>
      </button>
      <button
        onClick={onClose}
        className="w-full text-left px-4 py-3 text-sm text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-2"
      >
        <span>✕</span>
        <span>取消</span>
      </button>
    </div>
  )
}

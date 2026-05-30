import { memo } from 'react'
import VoiceSelector from './VoiceSelector'

interface Props {
  isPlaying: boolean
  onTogglePlay: () => void
  onStop: () => void
  rate: number
  onRateChange: (rate: number) => void
  disabled: boolean
}

const RATE_PRESETS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0]

function AudioControls({ isPlaying, onTogglePlay, onStop, rate, onRateChange, disabled }: Props) {
  return (
    <div className="flex flex-col gap-3">
      {/* 主控按钮行 */}
      <div className="flex items-center justify-center gap-6">
        {/* 上一段 */}
        <button
          disabled={disabled}
          className="w-10 h-10 flex items-center justify-center text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 disabled:opacity-30 transition-colors text-lg"
          aria-label="上一段"
        >
          ⏮
        </button>

        {/* 播放/暂停 */}
        <button
          disabled={disabled}
          onClick={onTogglePlay}
          className={`
            w-14 h-14 rounded-full flex items-center justify-center text-white text-2xl
            transition-all active:scale-95 shadow-lg
            ${disabled ? 'bg-slate-400' : 'bg-blue-500 hover:bg-blue-600 hover:shadow-xl'}
          `}
          aria-label={isPlaying ? '暂停' : '播放'}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>

        {/* 停止 */}
        <button
          disabled={disabled}
          onClick={onStop}
          className="w-10 h-10 flex items-center justify-center text-slate-500 hover:text-red-500 disabled:opacity-30 transition-colors text-lg"
          aria-label="停止"
        >
          ⏹
        </button>

        {/* 下一段 */}
        <button
          disabled={disabled}
          className="w-10 h-10 flex items-center justify-center text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 disabled:opacity-30 transition-colors text-lg"
          aria-label="下一段"
        >
          ⏭
        </button>
      </div>

      {/* 倍速选择 */}
      <div className="flex items-center justify-center gap-1 flex-wrap">
        {RATE_PRESETS.map((r) => (
          <button
            key={r}
            disabled={disabled}
            onClick={() => onRateChange(r)}
            className={`
              px-2.5 py-1 text-xs rounded-full transition-all
              ${Math.abs(rate - r) < 0.01
                ? 'bg-blue-500 text-white shadow'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
              }
              disabled:opacity-30
            `}
          >
            {r}x
          </button>
        ))}
      </div>

      {/* 语音选择 */}
      <VoiceSelector disabled={disabled} />
    </div>
  )
}

export default memo(AudioControls)

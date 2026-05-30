import { memo } from 'react'
import type { Book } from '../../types'
import { formatDuration } from '../../utils/format'
import { getCoverStyle } from '../../utils/cover'

interface Props {
  book: Book
  onClick: () => void
  onDelete: () => void
}

function BookCard({ book, onClick, onDelete }: Props) {
  const progress = book.progress
  const totalParas = book.paragraphs.length
  const readParas = progress?.currentParaIndex ?? 0
  const percent = totalParas > 0 ? Math.round((readParas / totalParas) * 100) : 0
  const cover = getCoverStyle(book.title)

  // 取书名字的前 3 个字符作为封面文字
  const coverText = book.title.replace(/[《》「」『』\s]/g, '').slice(0, 3) || '📖'

  return (
    <div
      className="group relative rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden active:scale-[0.98] transition-transform cursor-pointer bg-white dark:bg-slate-900"
      onClick={onClick}
    >
      {/* 封面 */}
      <div
        className="relative h-28 flex items-center justify-center overflow-hidden"
        style={{ background: cover.bg }}
      >
        {/* 装饰图案 */}
        {cover.pattern === 'stripes' && (
          <div className="absolute inset-0 opacity-10">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="absolute bg-white rounded-full"
                style={{
                  width: `${60 + i * 30}%`,
                  height: '200%',
                  left: `${-20 + i * 25}%`,
                  top: '-50%',
                  transform: `rotate(${-30 + i * 15}deg)`,
                }}
              />
            ))}
          </div>
        )}
        {cover.pattern === 'dots' && (
          <div className="absolute inset-0 opacity-15">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="absolute bg-white rounded-full"
                style={{
                  width: `${12 + i * 8}px`,
                  height: `${12 + i * 8}px`,
                  left: `${10 + (i % 3) * 30}%`,
                  top: `${15 + Math.floor(i / 3) * 35}%`,
                }}
              />
            ))}
          </div>
        )}
        {cover.pattern === 'wave' && (
          <svg className="absolute inset-0 w-full h-full opacity-10" viewBox="0 0 200 120">
            {[0, 1, 2].map((i) => (
              <path
                key={i}
                d={`M0 ${40 + i * 20} Q50 ${20 + i * 20} 100 ${40 + i * 20} T200 ${40 + i * 20}`}
                fill="none"
                stroke="white"
                strokeWidth="3"
              />
            ))}
          </svg>
        )}

        {/* 书名首字 */}
        <span className="relative z-10 text-white font-bold drop-shadow-lg"
          style={{ fontSize: coverText.length > 2 ? '1.6rem' : '2.2rem' }}
        >
          {coverText}
        </span>

        {/* 底部渐变装饰线 */}
        <div className="absolute bottom-0 left-0 right-0 h-1 opacity-30"
          style={{ backgroundColor: cover.accent }}
        />
      </div>

      {/* 信息 */}
      <div className="p-3">
        <h3 className="font-medium text-sm truncate" title={book.title}>
          {book.title}
        </h3>
        <p className="text-xs text-slate-400 mt-1">
          {book.paragraphs.length} 段 · {book.format.toUpperCase()}
        </p>

        {percent > 0 && (
          <div className="mt-2">
            <div className="h-1 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${percent}%`, background: cover.bg }}
              />
            </div>
            <p className="text-xs text-slate-400 mt-1">
              已读 {percent}%
              {progress?.totalListeningMs
                ? ` · ${formatDuration(progress.totalListeningMs)}`
                : ''}
            </p>
          </div>
        )}
      </div>

      {/* 删除 */}
      <button
        className="absolute top-2 right-2 w-7 h-7 bg-black/40 hover:bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center text-xs"
        onClick={(e) => {
          e.stopPropagation()
          if (confirm(`确定删除《${book.title}》吗？`)) onDelete()
        }}
        title="删除"
      >
        ✕
      </button>
    </div>
  )
}

export default memo(BookCard)

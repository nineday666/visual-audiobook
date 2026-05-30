import type { Book } from '../../types'
import { formatDuration } from '../../utils/format'

interface Props {
  book: Book
  onClick: () => void
  onDelete: () => void
}

export default function BookCard({ book, onClick, onDelete }: Props) {
  const progress = book.progress
  const totalParas = book.paragraphs.length
  const readParas = progress?.currentParaIndex ?? 0
  const percent = totalParas > 0 ? Math.round((readParas / totalParas) * 100) : 0

  return (
    <div
      className="group relative bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden active:scale-[0.98] transition-transform cursor-pointer"
      onClick={onClick}
    >
      {/* 封面色块 */}
      <div className={`h-24 bg-gradient-to-br ${book.coverColor} flex items-center justify-center`}>
        <span className="text-white/80 text-4xl font-bold">{book.title.charAt(0)}</span>
      </div>

      {/* 信息 */}
      <div className="p-3">
        <h3 className="font-medium text-sm truncate" title={book.title}>
          {book.title}
        </h3>
        <p className="text-xs text-slate-400 mt-1">
          {book.paragraphs.length} 段 · {book.format.toUpperCase()}
        </p>

        {/* 进度 */}
        {percent > 0 && (
          <div className="mt-2">
            <div className="h-1 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all"
                style={{ width: `${percent}%` }}
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

      {/* 删除按钮 */}
      <button
        className="absolute top-2 right-2 w-7 h-7 bg-black/40 hover:bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center text-xs"
        onClick={(e) => {
          e.stopPropagation()
          if (confirm(`确定删除《${book.title}》吗？`)) {
            onDelete()
          }
        }}
        title="删除"
      >
        ✕
      </button>
    </div>
  )
}

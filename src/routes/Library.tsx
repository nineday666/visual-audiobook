import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAllBooks, deleteBook, updateBookOrders } from '../services/db'
import { parseFile } from '../services/parser'
import { addBook as addBookToDb } from '../services/db'
import type { Book } from '../types'
import FileDropZone from '../components/common/FileDropZone'
import BookCard from '../components/library/BookCard'
import { getCoverStyle } from '../utils/cover'

export default function Library() {
  const [books, setBooks] = useState<Book[]>([])
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<number | null>(null) // 仅用于 UI 高亮
  const navigate = useNavigate()
  const dragFromRef = useRef<number | null>(null)
  const dropTargetRef = useRef<number | null>(null) // 实时值，dragEnd 直接用

  const refreshBooks = useCallback(async () => {
    const all = await getAllBooks()
    setBooks(all)
  }, [])

  useEffect(() => {
    refreshBooks()
  }, [refreshBooks])

  const handleImport = async (files: FileList | File[]) => {
    const fileList = Array.isArray(files) ? files : Array.from(files)
    setImportError('')

    for (const file of fileList) {
      try {
        setImporting(true)
        const parsed = await parseFile(file)
        const book: Book = {
          ...parsed,
          coverColor: getCoverStyle(parsed.title).bg,
        }
        await addBookToDb(book)
        await refreshBooks()
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '解析失败'
        setImportError(`${file.name}: ${msg}`)
      } finally {
        setImporting(false)
      }
    }
  }

  const handleDelete = async (id: string) => {
    await deleteBook(id)
    await refreshBooks()
  }

  // === 拖拽排序 ===
  const handleDragStart = (e: React.DragEvent, index: number) => {
    dragFromRef.current = index
    dropTargetRef.current = null
    setDragIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', '')
    const el = e.currentTarget as HTMLElement
    setTimeout(() => { el.style.opacity = '0.4' }, 0)
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    dropTargetRef.current = index // ref 即时更新
    setDropTarget(index) // state 用于 UI 高亮
  }

  const handleDragLeave = () => {
    dropTargetRef.current = null
    setDropTarget(null)
  }

  const handleDragEnd = (e: React.DragEvent) => {
    ;(e.currentTarget as HTMLElement).style.opacity = '1'
    setDragIndex(null)
    setDropTarget(null)

    const from = dragFromRef.current
    const to = dropTargetRef.current // 用 ref 而不是 state
    dragFromRef.current = null
    dropTargetRef.current = null

    if (from === null || to === null || to === from) return

    const reordered = [...books]
    const [moved] = reordered.splice(from, 1)
    reordered.splice(to, 0, moved)
    setBooks(reordered)

    const orders = reordered.map((b, i) => ({ id: b.id, sortOrder: i }))
    updateBookOrders(orders)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDropTarget(null)
  }

  return (
    <div className="flex flex-col min-h-screen">
      <header className="sticky top-0 z-10 bg-white/80 dark:bg-slate-950/80 backdrop-blur border-b border-slate-200 dark:border-slate-800 px-4 py-4">
        <h1 className="text-xl font-bold text-center">📖 可视化听书</h1>
      </header>

      <div className="p-4">
        <FileDropZone onImport={handleImport} importing={importing} />
        {importError && (
          <p className="text-red-500 text-sm mt-2">{importError}</p>
        )}
      </div>

      <main className="flex-1 px-4 pb-4">
        {books.length === 0 ? (
          <div className="text-center text-slate-400 mt-16">
            <div className="text-6xl mb-4">📚</div>
            <p className="text-lg">还没有书籍</p>
            <p className="text-sm mt-1">点击上方区域导入 txt 或 epub 文件</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {books.map((book, i) => (
              <div
                key={book.id}
                draggable
                onDragStart={(e) => handleDragStart(e, i)}
                onDragOver={(e) => handleDragOver(e, i)}
                onDragLeave={handleDragLeave}
                onDragEnd={handleDragEnd}
                onDrop={handleDrop}
                className={`
                  transition-all duration-200
                  ${dragIndex === i ? 'opacity-40 scale-95' : ''}
                  ${dropTarget === i && dropTarget !== dragIndex ? 'translate-y-1' : ''}
                `}
              >
                <BookCard
                  book={book}
                  onClick={() => navigate(`/read/${book.id}`)}
                  onDelete={() => handleDelete(book.id)}
                />
              </div>
            ))}
          </div>
        )}
      </main>

      <footer className="text-center text-xs text-slate-400 py-4 border-t border-slate-200 dark:border-slate-800">
        支持 txt / epub 格式 · 长按拖动排序
      </footer>
    </div>
  )
}

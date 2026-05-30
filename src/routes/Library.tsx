import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAllBooks, deleteBook } from '../services/db'
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
  const navigate = useNavigate()

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

  return (
    <div className="flex flex-col min-h-screen">
      {/* 顶栏 */}
      <header className="sticky top-0 z-10 bg-white/80 dark:bg-slate-950/80 backdrop-blur border-b border-slate-200 dark:border-slate-800 px-4 py-4">
        <h1 className="text-xl font-bold text-center">📖 可视化听书</h1>
      </header>

      {/* 导入区域 */}
      <div className="p-4">
        <FileDropZone onImport={handleImport} importing={importing} />
        {importError && (
          <p className="text-red-500 text-sm mt-2">{importError}</p>
        )}
      </div>

      {/* 书籍列表 */}
      <main className="flex-1 px-4 pb-4">
        {books.length === 0 ? (
          <div className="text-center text-slate-400 mt-16">
            <div className="text-6xl mb-4">📚</div>
            <p className="text-lg">还没有书籍</p>
            <p className="text-sm mt-1">点击上方区域导入 txt 或 epub 文件</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {books.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                onClick={() => navigate(`/read/${book.id}`)}
                onDelete={() => handleDelete(book.id)}
              />
            ))}
          </div>
        )}
      </main>

      {/* 底栏信息 */}
      <footer className="text-center text-xs text-slate-400 py-4 border-t border-slate-200 dark:border-slate-800">
        支持 txt / epub 格式 · 离线可用
      </footer>
    </div>
  )
}

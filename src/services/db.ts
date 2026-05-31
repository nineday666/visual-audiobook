import Dexie, { type Table } from 'dexie'
import type { Book, ReadingProgress, AppSettings } from '../types'

class AudiobookDB extends Dexie {
  books!: Table<Book, string>
  readingProgress!: Table<ReadingProgress, string>
  settings!: Table<AppSettings, string>

  constructor() {
    super('VisualAudiobook')
    this.version(2).stores({
      books: 'id, title, addedAt, sortOrder',
      readingProgress: 'bookId, lastReadAt',
      settings: 'id',
    }).upgrade(async (tx) => {
      // 给已有书籍补充 sortOrder
      const books = await tx.table('books').toArray()
      for (let i = 0; i < books.length; i++) {
        await tx.table('books').update(books[i].id, { sortOrder: i })
      }
    })
  }
}

export const db = new AudiobookDB()

// ========== 书籍操作 ==========
export async function addBook(book: Book): Promise<void> {
  // 新书排在最前面
  const count = await db.books.count()
  book.sortOrder = -count // 负数确保新书排最前
  await db.books.put(book)
}

export async function getAllBooks(): Promise<Book[]> {
  const books = await db.books.orderBy('sortOrder').toArray()
  for (const book of books) {
    book.progress = await db.readingProgress.get(book.id)
  }
  return books
}

export async function updateBookOrders(orders: { id: string; sortOrder: number }[]): Promise<void> {
  await db.transaction('rw', db.books, async () => {
    for (const { id, sortOrder } of orders) {
      await db.books.update(id, { sortOrder })
    }
  })
}

export async function getBook(id: string): Promise<Book | undefined> {
  const book = await db.books.get(id)
  if (book) {
    book.progress = await db.readingProgress.get(id)
  }
  return book
}

export async function deleteBook(id: string): Promise<void> {
  await db.books.delete(id)
  await db.readingProgress.delete(id)
}

// ========== 进度操作 ==========
export async function saveProgress(progress: ReadingProgress): Promise<void> {
  progress.lastReadAt = Date.now()
  await db.readingProgress.put(progress)
}

export async function getProgress(bookId: string): Promise<ReadingProgress | undefined> {
  return db.readingProgress.get(bookId)
}

// ========== 设置操作 ==========
export async function getSettings(): Promise<AppSettings> {
  const existing = await db.settings.get('singleton')
  if (existing) return existing as unknown as AppSettings

  const settings: AppSettings = {
    speechRate: 1.0,
    speechPitch: 1.0,
    preferredVoiceURI: '',
    audiobookVoiceURI: '',
    listeningVoiceURI: '',
    language: 'zh-CN',
    appMode: 'audiobook',
    translationMode: 'off',
    fontSize: 'md',
    lineHeight: 'normal',
    theme: 'light',
  }
  await db.settings.put({ ...settings, id: 'singleton' } as AppSettings & { id: string })
  return settings
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<void> {
  const current = await getSettings()
  const merged = { ...current, ...settings, id: 'singleton' as const }
  // Dexie expects the id field; our AppSettings doesn't have it, but the table schema does
  await db.settings.put(merged as unknown as AppSettings & { id: string })
}

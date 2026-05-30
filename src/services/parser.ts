import type { Book } from '../types'

// 兼容所有浏览器的 UUID 生成
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// 解析文件为 Book 对象
export async function parseFile(file: File): Promise<Omit<Book, 'coverColor'>> {
  const ext = file.name.split('.').pop()?.toLowerCase()
  const format = ext === 'epub' ? 'epub' : 'txt'

  let paragraphs: string[]

  if (format === 'epub') {
    const buffer = await file.arrayBuffer()
    paragraphs = await parseEpub(buffer)
  } else {
    const text = await file.text()
    paragraphs = parseTextToParagraphs(text)
  }

  return {
    id: generateUUID(),
    title: file.name.replace(/\.\w+$/, ''),
    format,
    paragraphs,
    addedAt: Date.now(),
    sortOrder: 0,
    totalChars: paragraphs.reduce((sum, p) => sum + p.length, 0),
  }
}

// 将文本按段落分割
function parseTextToParagraphs(text: string): string[] {
  const raw = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split(/\n\n+/)

  const paragraphs: string[] = []
  for (const block of raw) {
    const trimmed = block.trim()
    if (!trimmed) continue

    if (trimmed.length > 300) {
      const sub = splitLongParagraph(trimmed)
      paragraphs.push(...sub)
    } else {
      paragraphs.push(trimmed)
    }
  }

  return paragraphs.filter((p) => p.replace(/[\s\p{P}]/gu, '').length > 0)
}

// 长段落按句子边界二次切割
function splitLongParagraph(text: string): string[] {
  const result: string[] = []
  let current = ''
  const sentences = text.split(/(?<=[。！？；!?;])/)

  for (const s of sentences) {
    if ((current + s).length > 300 && current) {
      result.push(current.trim())
      current = s
    } else {
      current += s
    }
  }
  if (current.trim()) {
    result.push(current.trim())
  }
  return result.length > 0 ? result : [text]
}

// 解析 EPUB 文件
async function parseEpub(buffer: ArrayBuffer): Promise<string[]> {
  const epubModule = await import('epubjs')
  const EPUB = epubModule.Book
  // Book 构造函数接受 string URL 或 BookOptions；ArrayBuffer 需通过 open() 传入
  const book = new EPUB({} as Record<string, unknown>)
  await book.open(buffer)
  await book.ready

  try {
    // loaded.spine 实际返回 Spine 实例（非数组），spineItems 是内部数组
    const spine = await book.loaded.spine
    const items = (spine as unknown as { spineItems?: Array<{ href?: string; url?: string }> }).spineItems

    if (!items || items.length === 0) {
      throw new Error('未能解析 EPUB 目录')
    }

    const sections: string[] = []

    for (const item of items) {
      const href = item.href || item.url
      if (!href) continue

      // 跳过导航文件和图片/CSS等非文本资源
      const ext = href.split('.').pop()?.toLowerCase() || ''
      if (href.includes('nav') || ['jpg', 'jpeg', 'png', 'gif', 'svg', 'css', 'js'].includes(ext)) {
        continue
      }

      try {
        const raw = await book.load(href)
        let text = ''

        if (typeof raw === 'string') {
          // 纯文本字符串（TXT 之类）
          text = stripHtml(raw)
        } else if (raw && typeof raw === 'object') {
          // epubjs 对 XHTML/HTML/XML 返回 Document 对象
          const doc = raw as { documentElement?: { innerHTML?: string; textContent?: string }; body?: { innerHTML?: string; textContent?: string } }
          if (doc.documentElement) {
            // Document 对象 → 提取 innerHTML 后去除标签
            text = stripHtml(doc.documentElement.innerHTML || doc.documentElement.textContent || '')
          } else if (doc.body) {
            text = stripHtml(doc.body.innerHTML || doc.body.textContent || '')
          } else {
            // 最后的兜底
            text = stripHtml(String(raw))
          }
        }

        if (text.trim()) {
          sections.push(text)
        }
      } catch {
        // 跳过无法加载的章节
      }
    }

    if (sections.length === 0) {
      throw new Error('未能从 EPUB 中提取到文本内容')
    }

    return parseTextToParagraphs(sections.join('\n\n'))
  } finally {
    book.destroy()
  }
}

// HTML 标签剥离
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, '')
}

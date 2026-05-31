// DeepSeek 翻译服务 —— API Key 存在浏览器 localStorage，不上传

const DEEPSEEK_API = 'https://api.deepseek.com/chat/completions'

// 内存 + localStorage 双重缓存
const cache = new Map<string, string>()

function getCacheKey(bookId: string): string {
  return `tr_${bookId}`
}

// 从 localStorage 恢复缓存
export function loadCache(bookId: string): void {
  try {
    const saved = localStorage.getItem(getCacheKey(bookId))
    if (saved) {
      const data = JSON.parse(saved) as Record<string, string>
      for (const [k, v] of Object.entries(data)) {
        if (!cache.has(k)) cache.set(k, v)
      }
    }
  } catch {}
}

function getApiKey(): string {
  return localStorage.getItem('deepseek_api_key') || ''
}

export function setApiKey(key: string): void {
  localStorage.setItem('deepseek_api_key', key.trim())
}

export function hasApiKey(): boolean {
  return getApiKey().length > 0
}

// 翻译一段文本
export async function translateText(text: string): Promise<string> {
  const trimmed = text.trim()
  if (!trimmed) return ''

  // 检查缓存
  const cached = cache.get(trimmed)
  if (cached) return cached

  const key = getApiKey()
  if (!key) throw new Error('请先设置 DeepSeek API Key')

  // 检测主要语言
  const chineseChars = (trimmed.match(/[一-鿿]/g) || []).length
  const isChinese = chineseChars > trimmed.length * 0.3
  const prompt = isChinese
    ? `Translate to English. Return ONLY the translation, no explanation:\n\n${trimmed}`
    : `翻译成中文。只返回译文，不要解释：\n\n${trimmed}`

  const resp = await fetch(DEEPSEEK_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      temperature: 0.3,
    }),
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`翻译请求失败: ${resp.status} ${err}`)
  }

  const data = await resp.json()
  let result = data.choices?.[0]?.message?.content?.trim() || ''

  // 检测翻译失败：结果和原文一样 = 没翻译
  if (result === trimmed || result.length < 2) {
    result = '翻译失败'
  }

  // 缓存（失败结果也缓存，避免重复请求）
  cache.set(trimmed, result)
  return result
}

// 批量翻译 — 一次 API 调用翻 5 句，省钱
export async function translateBatch(texts: string[]): Promise<Map<string, string>> {
  const results = new Map<string, string>()
  const uncached: string[] = []

  for (const t of texts) {
    const trimmed = t.trim()
    if (!trimmed) continue
    if (cache.has(trimmed)) {
      results.set(trimmed, cache.get(trimmed)!)
    } else {
      uncached.push(trimmed)
    }
  }

  // 5句一批
  const BATCH = 5
  for (let i = 0; i < uncached.length; i += BATCH) {
    const batch = uncached.slice(i, i + BATCH)
    try {
      const batchResults = await translateBatchOnce(batch)
      for (const [orig, trans] of batchResults) {
        cache.set(orig, trans)
        results.set(orig, trans)
      }
    } catch {
      for (const t of batch) {
        results.set(t, '翻译失败')
        cache.set(t, '翻译失败')
      }
    }
    if (i + BATCH < uncached.length) {
      await new Promise((r) => setTimeout(r, 100))
    }
  }

  return results
}

async function translateBatchOnce(texts: string[]): Promise<Map<string, string>> {
  const key = getApiKey()
  if (!key) throw new Error('No API key')

  // 检测语言
  const sample = texts[0] || ''
  const chineseChars = (sample.match(/[一-鿿]/g) || []).length
  const isChinese = chineseChars > sample.length * 0.3

  const numbered = texts.map((t, i) => `[${i + 1}] ${t}`).join('\n')
  const prompt = isChinese
    ? `Translate each numbered sentence to English. Return EXACTLY in format:\n[1] translation\n[2] translation\n...\nNo extra text:\n\n${numbered}`
    : `将以下每句翻译成中文。严格按格式返回：\n[1] 译文\n[2] 译文\n...\n不要多余文字：\n\n${numbered}`

  const resp = await fetch(DEEPSEEK_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1000,
      temperature: 0.3,
    }),
  })

  if (!resp.ok) throw new Error(`API error ${resp.status}`)

  const data = await resp.json()
  const result = data.choices?.[0]?.message?.content?.trim() || ''

  // 解析 `[1] xxx` 格式
  const map = new Map<string, string>()
  const lines = result.split('\n')
  for (let i = 0; i < texts.length; i++) {
    const idx = i + 1
    let found = ''
    for (const line of lines) {
      const m = line.match(new RegExp(`^\\[${idx}\\]\\s*(.+)`))
      if (m) { found = m[1].trim(); break }
    }
    if (found && found !== texts[i]) {
      map.set(texts[i], found)
    } else {
      map.set(texts[i], '翻译失败')
    }
  }

  return map
}

// 保存给定 bookId 的缓存到 localStorage
export function saveCache(bookId: string): void {
  try {
    const obj: Record<string, string> = {}
    for (const [k, v] of cache) obj[k] = v
    localStorage.setItem(getCacheKey(bookId), JSON.stringify(obj))
  } catch {}
}

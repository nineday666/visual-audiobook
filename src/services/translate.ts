// DeepSeek 翻译服务 —— API Key 存在浏览器 localStorage，不上传

const DEEPSEEK_API = 'https://api.deepseek.com/chat/completions'

// 内存缓存：key = sentence, value = translation
const cache = new Map<string, string>()

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

// 批量翻译（并发控制）
export async function translateBatch(texts: string[]): Promise<Map<string, string>> {
  const results = new Map<string, string>()
  const toFetch: string[] = []

  for (const t of texts) {
    const trimmed = t.trim()
    if (!trimmed) continue
    if (cache.has(trimmed)) {
      results.set(trimmed, cache.get(trimmed)!)
    } else {
      toFetch.push(trimmed)
    }
  }

  // 逐个翻译（避免并发过高）
  for (const t of toFetch) {
    try {
      const r = await translateText(t)
      results.set(t, r)
    } catch {
      results.set(t, '')
    }
    // 小延迟避免触发限流
    await new Promise((r) => setTimeout(r, 200))
  }

  return results
}

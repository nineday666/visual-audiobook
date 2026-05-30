// Microsoft Edge TTS 客户端 — 通过 Cloudflare Worker 代理
// Worker 代码在项目根目录 worker.js，部署到 Cloudflare Workers
// 获取 Worker URL 后设置 localStorage: tts_proxy_url = "https://xxx.workers.dev"

function getProxyUrl(): string {
  return localStorage.getItem('tts_proxy_url') || ''
}

export function setProxyUrl(url: string): void {
  localStorage.setItem('tts_proxy_url', url)
}

export function hasProxyUrl(): boolean {
  return !!getProxyUrl()
}

export class EdgeTtsService {
  async synthesize(text: string): Promise<ArrayBuffer> {
    const url = getProxyUrl()
    if (!url) throw new Error('未配置 TTS 代理 URL')

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })

    if (!resp.ok) throw new Error(`TTS proxy error: ${resp.status}`)
    return resp.arrayBuffer()
  }
}

let instance: EdgeTtsService | null = null

export function getEdgeTts(): EdgeTtsService {
  if (!instance) instance = new EdgeTtsService()
  return instance
}

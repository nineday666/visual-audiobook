// Cloudflare Worker — Edge TTS 代理
// 接收 text，返回 MP3 音频

// 注意：如果 WebSocket 报错，改用 Deno Deploy 方案
// Cloudflare Workers 需要 compatibility_date >= 2024-01-01

export default {
  async fetch(request) {
    // CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      })
    }

    if (request.method !== 'POST') {
      return new Response('POST with {"text":"..."} JSON', { status: 405 })
    }

    try {
      const { text } = await request.json()
      if (!text) return new Response('Missing text', { status: 400 })

      // 长文本分块：每块 ≤ 500 字符，避免 TTS 单次请求过长
      const chunks = splitText(text, 500)
      const audioParts = []
      for (const chunk of chunks) {
        const audio = await synthesizeEdgeTts(chunk)
        audioParts.push(new Uint8Array(audio))
      }

      // 合并所有音频块
      const totalLen = audioParts.reduce((s, a) => s + a.length, 0)
      const merged = new Uint8Array(totalLen)
      let offset = 0
      for (const part of audioParts) { merged.set(part, offset); offset += part.length }

      return new Response(merged.buffer, {
        headers: {
          'Content-Type': 'audio/mpeg',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=3600',
        },
      })
    } catch (err) {
      return new Response(err.message, { status: 500 })
    }
  },
}

async function synthesizeEdgeTts(text) {
  const wsUrl = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4'

  const ws = new WebSocket(wsUrl)
  const chunks = []
  let done = false

  const config = {
    context: {
      synthesis: {
        audio: {
          metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false },
          outputFormat: 'audio-16khz-32kbitrate-mono-mp3',
        },
      },
    },
  }

  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="zh-CN"><voice name="zh-CN-XiaoxiaoNeural">${escapeXml(text)}</voice></speak>`

  return new Promise((resolve, reject) => {
    ws.onopen = () => {
      ws.send(`X-RequestId:${crypto.randomUUID()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${JSON.stringify(config)}`)

      setTimeout(() => {
        ws.send(`X-RequestId:${crypto.randomUUID()}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n${ssml}`)
      }, 100)
    }

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        if (event.data.includes('turn.end')) {
          done = true
          ws.close()
        }
      } else if (event.data instanceof ArrayBuffer) {
        // 跳过 HTTP header 前缀
        let data = new Uint8Array(event.data)
        const headerEnd = findHeaderEnd(data)
        if (headerEnd > 0) data = data.slice(headerEnd)
        if (data.length > 0) chunks.push(data)
      }
    }

    ws.onclose = () => {
      const total = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0))
      let offset = 0
      for (const c of chunks) { total.set(c, offset); offset += c.length }
      resolve(total.buffer)
    }

    ws.onerror = (err) => reject(new Error('WebSocket error'))

    setTimeout(() => reject(new Error('Timeout')), 20000)
  })
}

function findHeaderEnd(data) {
  for (let i = 0; i < data.length - 3; i++) {
    if (data[i] === 0x0d && data[i + 1] === 0x0a && data[i + 2] === 0x0d && data[i + 3] === 0x0a) return i + 4
  }
  return 0
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

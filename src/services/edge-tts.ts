// Microsoft Edge TTS WebSocket 客户端
// 免费、无需 API Key，使用 Edge 浏览器的 Read Aloud 接口

const WS_URL =
  'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4'

const VOICE = 'zh-CN-XiaoxiaoNeural' // 中文女声晓晓

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

interface TtsResult {
  audioBuffer: ArrayBuffer
  duration: number
}

export class EdgeTtsService {
  private ws: WebSocket | null = null
  private onAudioReady: ((result: TtsResult) => void) | null = null
  private pendingResolve: (() => void) | null = null
  private ready = false
  private audioChunks: ArrayBuffer[] = []

  async connect(): Promise<void> {
    if (this.ready) return
    this.ready = true // 只尝试一次

    return new Promise((resolve) => {
      const ws = new WebSocket(WS_URL)
      this.ws = ws
      this.pendingResolve = resolve

      ws.binaryType = 'arraybuffer'

      ws.onopen = () => {
        // 发送配置
        const config = {
          context: {
            synthesis: {
              audio: {
                metadataoptions: {
                  sentenceBoundaryEnabled: false,
                  wordBoundaryEnabled: false,
                },
                outputFormat: 'audio-16khz-32kbitrate-mono-mp3',
              },
            },
          },
        }
        ws.send(
          `X-RequestId:${generateId()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${JSON.stringify(config)}`
        )
      }

      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          // 文本响应：服务端就绪确认或错误
          if (event.data.includes('turn.end')) {
            // 当前语音合成完毕
            if (this.onAudioReady && this.audioChunks.length > 0) {
              const total = new Uint8Array(
                this.audioChunks.reduce((s, c) => s + c.byteLength, 0)
              )
              let offset = 0
              for (const chunk of this.audioChunks) {
                total.set(new Uint8Array(chunk), offset)
                offset += chunk.byteLength
              }
              this.audioChunks = []
              this.onAudioReady({
                audioBuffer: total.buffer as ArrayBuffer,
                duration: 0, // 由 AudioContext 解码后获取
              })
            }
          }
          // Path:turn.start 表示语音开始
        } else if (event.data instanceof ArrayBuffer) {
          // 二进制音频数据
          if (event.data.byteLength > 2) {
            // 跳过 header（前几个字节是格式头）
            this.audioChunks.push(event.data.slice(2))
          }
        }

        // 首次收到响应表示连接成功
        if (this.pendingResolve) {
          this.pendingResolve()
          this.pendingResolve = null
        }
      }

      ws.onerror = () => {
        this.ready = false
        this.pendingResolve?.()
        this.pendingResolve = null
      }

      ws.onclose = () => {
        this.ready = false
      }

      // 超时
      setTimeout(() => {
        if (this.pendingResolve) {
          this.ready = false
          this.pendingResolve()
          this.pendingResolve = null
        }
      }, 5000)
    })
  }

  async synthesize(text: string): Promise<TtsResult> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.ready = false
      await this.connect()
    }

    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('TTS 连接失败，使用离线语音'))
        return
      }

      this.audioChunks = []
      this.onAudioReady = resolve

      const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="zh-CN"><voice name="${VOICE}">${escapeXml(text)}</voice></speak>`

      const requestId = generateId()
      this.ws!.send(
        `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n${ssml}`
      )

      // 超时保护
      setTimeout(() => {
        if (this.onAudioReady === resolve) {
          this.onAudioReady = null
          reject(new Error('TTS 请求超时'))
        }
      }, 15000)
    })
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
      this.ready = false
    }
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// 单例
let instance: EdgeTtsService | null = null

export function getEdgeTts(): EdgeTtsService {
  if (!instance) {
    instance = new EdgeTtsService()
  }
  return instance
}

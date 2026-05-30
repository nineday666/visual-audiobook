// Deno Deploy — Edge TTS 代理
// Deno 原生支持 WebSocket，无障碍连微软 TTS
// 部署：dash.deno.com → New Playground → 粘贴 → Deploy

import { escapeXml } from "https://deno.land/x/escape/mod.ts";

// 如果 escapeXml 不可用，使用内置版本
function escape(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const WS_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4';

async function synthesize(text) {
  const ws = new WebSocket(WS_URL);
  const chunks = [];

  const config = {
    context: {
      synthesis: {
        audio: {
          metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false },
          outputFormat: 'audio-16khz-32kbitrate-mono-mp3',
        },
      },
    },
  };

  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="zh-CN"><voice name="zh-CN-XiaoxiaoNeural">${escape(text)}</voice></speak>`;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { try { ws.close(); } catch {}; reject(new Error('Timeout')); }, 15000);

    ws.onopen = () => {
      ws.send(`X-RequestId:${crypto.randomUUID()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${JSON.stringify(config)}`);
      setTimeout(() => {
        ws.send(`X-RequestId:${crypto.randomUUID()}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n${ssml}`);
      }, 100);
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        if (event.data.includes('turn.end')) {
          clearTimeout(timer);
          ws.close();
        }
      } else if (event.data instanceof ArrayBuffer) {
        let data = new Uint8Array(event.data);
        // 跳过 HTTP header 前缀 \r\n\r\n
        const h = findHeader(data);
        if (h > 0) data = data.slice(h);
        if (data.length > 0) chunks.push(data);
      }
    };

    ws.onclose = () => {
      const total = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
      let off = 0;
      for (const c of chunks) { total.set(c, off); off += c.length; }
      resolve(total.buffer);
    };

    ws.onerror = () => { clearTimeout(timer); reject(new Error('WS error')); };
  });
}

function findHeader(d) {
  for (let i = 0; i < d.length - 3; i++) {
    if (d[i] === 0x0d && d[i+1] === 0x0a && d[i+2] === 0x0d && d[i+3] === 0x0a) return i + 4;
  }
  return 0;
}

// ── HTTP 入口 ──
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response('Send POST with JSON: {"text":"..."}', { status: 405 });
  }

  try {
    const { text } = await req.json();
    if (!text) return new Response('Missing text', { status: 400 });

    // 分块合成（每块 ≤ 500 字符），然后合并
    const CHUNK = 500;
    const pieces = [];
    for (let i = 0; i < text.length; i += CHUNK) {
      pieces.push(text.slice(i, i + CHUNK));
    }

    const parts = [];
    for (const piece of pieces) {
      const audio = await synthesize(piece);
      parts.push(new Uint8Array(audio));
    }

    const totalLen = parts.reduce((s, a) => s + a.length, 0);
    const merged = new Uint8Array(totalLen);
    let offset = 0;
    for (const p of parts) { merged.set(p, offset); offset += p.length; }

    return new Response(merged.buffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return new Response(err.message, { status: 500 });
  }
});

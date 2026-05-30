import { useEffect, useCallback } from 'react'
import { useReaderStore } from '../stores/readerStore'

export function useMediaSession() {
  const bookId = useReaderStore((s) => s.bookId)
  const paragraphs = useReaderStore((s) => s.paragraphs)
  const currentParaIndex = useReaderStore((s) => s.currentParaIndex)
  const isPlaying = useReaderStore((s) => s.isPlaying)
  const play = useReaderStore((s) => s.play)
  const pause = useReaderStore((s) => s.pause)
  const setCurrentParagraph = useReaderStore((s) => s.setCurrentParagraph)

  const setupMediaSession = useCallback(() => {
    if (!('mediaSession' in navigator)) return

    // 设置锁屏信息
    const title = paragraphs[currentParaIndex]?.slice(0, 50) || '可视化听书'
    navigator.mediaSession.metadata = new MediaMetadata({
      title: title.length > 30 ? title.slice(0, 30) + '...' : title,
      artist: '可视化听书',
      album: bookId ? '正在朗读' : '',
    })

    // 操作处理
    navigator.mediaSession.setActionHandler('play', () => {
      play()
    })
    navigator.mediaSession.setActionHandler('pause', () => {
      pause()
    })
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      const prev = Math.max(0, currentParaIndex - 1)
      setCurrentParagraph(prev)
    })
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      const next = Math.min(paragraphs.length - 1, currentParaIndex + 1)
      setCurrentParagraph(next)
    })
    navigator.mediaSession.setActionHandler('seekbackward', () => {
      const prev = Math.max(0, currentParaIndex - 3)
      setCurrentParagraph(prev)
    })
    navigator.mediaSession.setActionHandler('seekforward', () => {
      const next = Math.min(paragraphs.length - 1, currentParaIndex + 3)
      setCurrentParagraph(next)
    })
  }, [paragraphs, currentParaIndex, bookId, play, pause, setCurrentParagraph])

  // 播放状态变化时更新 metadata
  useEffect(() => {
    if (isPlaying) {
      setupMediaSession()
    }

    // 更新播放状态
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'
    }
  }, [isPlaying, currentParaIndex, setupMediaSession])
}

// 格式化听书时长
export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)

  if (hours > 0) {
    return `${hours}小时${minutes}分钟`
  }
  if (minutes > 0) {
    return `${minutes}分钟`
  }
  return '不到1分钟'
}

// 格式化倍数
export function formatRate(rate: number): string {
  return `${rate.toFixed(1)}x`
}

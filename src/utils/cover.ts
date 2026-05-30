// 从书名生成一致的封面配色
export interface CoverStyle {
  bg: string       // 背景渐变
  accent: string   // 装饰色
  text: string     // 文字色
  pattern: 'stripes' | 'dots' | 'wave' | 'none'
}

// 粉彩渐变色板
const PALETTES = [
  { from: '#6366f1', to: '#8b5cf6', accent: '#a78bfa' },  // 紫
  { from: '#0ea5e9', to: '#06b6d4', accent: '#22d3ee' },  // 青
  { from: '#10b981', to: '#14b8a6', accent: '#2dd4bf' },  // 绿
  { from: '#f59e0b', to: '#ef4444', accent: '#f97316' },  // 橙红
  { from: '#ec4899', to: '#8b5cf6', accent: '#c084fc' },  // 粉紫
  { from: '#3b82f6', to: '#1d4ed8', accent: '#60a5fa' },  // 蓝
  { from: '#14b8a6', to: '#0d9488', accent: '#5eead4' },  // 深青
  { from: '#f97316', to: '#dc2626', accent: '#fb923c' },  // 橙
]

const PATTERNS: CoverStyle['pattern'][] = ['stripes', 'dots', 'wave', 'none', 'stripes', 'dots']

// 根据字符串生成稳定的哈希值
function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

export function getCoverStyle(title: string): CoverStyle {
  const h = hashString(title)
  const palette = PALETTES[h % PALETTES.length]
  const pattern = PATTERNS[h % PATTERNS.length]

  return {
    bg: `linear-gradient(135deg, ${palette.from}, ${palette.to})`,
    accent: palette.accent,
    text: 'rgba(255,255,255,0.9)',
    pattern,
  }
}

// 生成 CSS 背景样式
export function coverBgStyle(title: string): React.CSSProperties {
  const style = getCoverStyle(title)
  return {
    background: style.bg,
    color: style.text,
  }
}

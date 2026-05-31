import { memo, useEffect, useState, useCallback } from 'react'
import { getSpeechEngine } from '../../services/speech-engine'
import type { Voice } from '../../types'
import { useReaderStore } from '../../stores/readerStore'
import { useSettingsStore } from '../../stores/settingsStore'

interface Props {
  disabled: boolean
}

function VoiceSelector({ disabled }: Props) {
  const [voices, setVoices] = useState<Voice[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const selectedVoiceURI = useReaderStore((s) => s.selectedVoiceURI)
  const setVoice = useReaderStore((s) => s.setVoice)
  const language = useSettingsStore((s) => s.language)
  const appMode = useSettingsStore((s) => s.appMode)
  const setAudiobookVoice = useSettingsStore((s) => s.setAudiobookVoice)
  const setListeningVoice = useSettingsStore((s) => s.setListeningVoice)

  const loadVoices = useCallback(() => {
    setLoading(true)
    getSpeechEngine().getVoices().then((v) => {
      // 先按当前语言过滤，匹配的排前
      const langPrefix = language === 'zh-CN' ? 'zh' : 'en'
      const matched = v.filter((voice) => voice.lang.startsWith(langPrefix))
      const others = v.filter((voice) => !voice.lang.startsWith(langPrefix))
      setVoices([...matched, ...others])
      setLoading(false)
    })
  }, [language])

  useEffect(() => {
    loadVoices()
    const engine = getSpeechEngine()
    engine.onVoicesChanged(() => loadVoices())
  }, [loadVoices])

  // 语言切换时重新加载语音列表
  useEffect(() => {
    loadVoices()
  }, [language, loadVoices])

  // 点击按钮时：展开列表 或 重试加载
  const handleClick = useCallback(() => {
    if (voices.length === 0 && !loading) {
      loadVoices()
    }
    setExpanded(!expanded)
  }, [voices.length, loading, expanded, loadVoices])

  const handleSelect = useCallback((uri: string) => {
    setVoice(uri)
    useSettingsStore.getState().setPreferredVoice(uri)
    if (appMode === 'listening') {
      setListeningVoice(uri)
    } else {
      setAudiobookVoice(uri)
    }
    setExpanded(false)
  }, [setVoice, appMode, setAudiobookVoice, setListeningVoice])

  const currentVoice = voices.find((v) => v.uri === selectedVoiceURI)
  const displayName: string = loading
    ? '加载中...'
    : currentVoice?.name || '系统默认语音'
  const hasChoices = voices.length > 0

  // 如果只有一个语音且未选择，自动选上
  useEffect(() => {
    if (voices.length === 1 && !selectedVoiceURI) {
      setVoice(voices[0].uri)
    }
  }, [voices, selectedVoiceURI, setVoice])

  return (
    <div className="relative">
      <button
        disabled={disabled || (!hasChoices && !loading)}
        onClick={handleClick}
        className="w-full text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 disabled:opacity-30 transition-colors flex items-center justify-center gap-1"
      >
        🔊 {displayName}
        {hasChoices && (expanded ? ' ▲' : ' ▼')}
      </button>

      {expanded && (
        <div className="absolute bottom-full left-0 right-0 mb-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl max-h-48 overflow-y-auto z-30">
          {voices.length === 0 ? (
            <div className="px-3 py-4 text-xs text-slate-400 text-center">
              暂无可用语音
              <br />
              <span className="text-slate-500">使用系统默认引擎朗读</span>
            </div>
          ) : (
            voices.map((v) => (
              <button
                key={v.uri}
                onClick={() => handleSelect(v.uri)}
                className={`
                  w-full text-left px-3 py-2 text-xs transition-colors
                  ${v.uri === selectedVoiceURI
                    ? 'bg-blue-50 dark:bg-blue-950 text-blue-600'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                  }
                `}
              >
                <div className="font-medium">{v.name}</div>
                <div className="text-slate-400">{v.lang}{v.isDefault ? ' · 默认' : ''}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export default memo(VoiceSelector)

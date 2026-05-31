import { create } from 'zustand'
import type { AppSettings, FontSize, LineHeight, Theme, TtsLanguage, AppMode } from '../types'
import { getSettings, saveSettings } from '../services/db'

interface SettingsStore extends AppSettings {
  loaded: boolean
  load: () => Promise<void>
  setSpeechRate: (rate: number) => void
  setSpeechPitch: (pitch: number) => void
  setPreferredVoice: (uri: string) => void
  setLanguage: (lang: TtsLanguage) => void
  setAppMode: (mode: AppMode) => void
  setFontSize: (size: FontSize) => void
  setLineHeight: (lh: LineHeight) => void
  setTheme: (theme: Theme) => void
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  loaded: false,
  speechRate: 1.0,
  speechPitch: 1.0,
  preferredVoiceURI: '',
  language: 'zh-CN',
  appMode: 'audiobook',
  fontSize: 'md',
  lineHeight: 'normal',
  theme: 'light',

  load: async () => {
    if (get().loaded) return
    const s = await getSettings()
    set({ ...s, loaded: true })
  },

  setSpeechRate: (rate: number) => {
    set({ speechRate: rate })
    saveSettings({ speechRate: rate })
  },

  setSpeechPitch: (pitch: number) => {
    set({ speechPitch: pitch })
    saveSettings({ speechPitch: pitch })
  },

  setPreferredVoice: (uri: string) => {
    set({ preferredVoiceURI: uri })
    saveSettings({ preferredVoiceURI: uri })
  },

  setLanguage: (lang: TtsLanguage) => {
    set({ language: lang })
    saveSettings({ language: lang })
  },

  setAppMode: (mode: AppMode) => {
    set({ appMode: mode })
    saveSettings({ appMode: mode })
  },

  setFontSize: (size: FontSize) => {
    set({ fontSize: size })
    saveSettings({ fontSize: size })
  },

  setLineHeight: (lh: LineHeight) => {
    set({ lineHeight: lh })
    saveSettings({ lineHeight: lh })
  },

  setTheme: (theme: Theme) => {
    set({ theme })
    document.documentElement.classList.toggle('dark', theme === 'dark')
    saveSettings({ theme })
  },
}))

import { useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import { useSettingsStore } from './stores/settingsStore'
import Library from './routes/Library'
import Reader from './routes/Reader'
import ErrorBoundary from './components/common/ErrorBoundary'

function App() {
  const load = useSettingsStore((s) => s.load)
  const loaded = useSettingsStore((s) => s.loaded)
  const theme = useSettingsStore((s) => s.theme)

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-slate-400 animate-pulse">加载中...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen max-w-lg mx-auto flex flex-col">
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Library />} />
          <Route path="/read/:id" element={<Reader />} />
        </Routes>
      </ErrorBoundary>
    </div>
  )
}

export default App

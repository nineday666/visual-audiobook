import { useRef, useCallback, useState, type DragEvent } from 'react'

interface Props {
  onImport: (files: FileList | File[]) => void
  importing: boolean
}

export default function FileDropZone({ onImport, importing }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      if (e.dataTransfer.files.length > 0) {
        onImport(e.dataTransfer.files)
      }
    },
    [onImport]
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        onImport(e.target.files)
        e.target.value = ''
      }
    },
    [onImport]
  )

  return (
    <div
      className={`
        relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer
        transition-all duration-200
        ${dragOver
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 scale-[1.02]'
          : 'border-slate-300 dark:border-slate-700 hover:border-blue-400 hover:bg-slate-50 dark:hover:bg-slate-900/50'
        }
        ${importing ? 'opacity-50 pointer-events-none' : ''}
      `}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".txt,.epub"
        multiple
        className="hidden"
        onChange={handleChange}
      />

      {importing ? (
        <div className="flex flex-col items-center gap-2">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-slate-500">正在解析...</span>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <span className="text-3xl">📂</span>
          <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
            点击或拖拽文件到此处
          </span>
          <span className="text-xs text-slate-400">
            支持 .txt / .epub 格式
          </span>
        </div>
      )}
    </div>
  )
}

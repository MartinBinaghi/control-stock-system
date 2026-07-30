import { useState } from 'react'
import { Moon, Sun } from 'lucide-react'

// El <html> ya trae la clase correcta desde el script inline de index.html.
export default function ThemeToggle({ className = '' }: { className?: string }) {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  function toggle() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('theme', next ? 'dark' : 'light')
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={dark ? 'Modo claro' : 'Modo oscuro'}
      aria-label={dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      className={`p-2 rounded-md border-2 border-transparent cursor-pointer text-soft hover:text-ink hover:bg-sunken ${className}`}
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  )
}

import { useEffect, useState } from 'react'
import { ClipboardList, FileText, LogOut } from 'lucide-react'
import { api, clearToken, getToken, type Branch, type Profile } from './lib/api'
import { CarpiHead } from './components/Carpi'
import ThemeToggle from './components/ThemeToggle'
import Login from './pages/Login'
import Mostrador from './pages/Mostrador'
import Remitos from './pages/Remitos'
import Dashboard from './pages/Dashboard'

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [tab, setTab] = useState<'mostrador' | 'remitos'>('mostrador')
  const [loading, setLoading] = useState(true)
  const [branchName, setBranchName] = useState('')

  useEffect(() => {
    if (!getToken()) {
      setLoading(false)
      return
    }
    api<Profile>('/me')
      .then(setProfile)
      .catch(() => clearToken())
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (profile?.role !== 'encargado') return
    api<Branch[]>('/branches')
      .then((bs) => setBranchName(bs.find((b) => b.id === profile.branch_id)?.name ?? ''))
      .catch(() => {})
  }, [profile])

  function logout() {
    clearToken()
    setProfile(null)
  }

  if (loading) return null
  if (!profile) return <Login onLogin={setProfile} />
  if (profile.role === 'admin') return <Dashboard onLogout={logout} />

  const tabClass = (active: boolean) =>
    `font-pixel flex items-center gap-1.5 px-3 py-1.5 rounded-md border-2 cursor-pointer transition-colors duration-150 ${
      active
        ? 'bg-accent text-on-accent border-line shadow-px-sm'
        : 'border-transparent text-soft hover:text-ink hover:bg-sunken'
    }`

  return (
    <div className="min-h-screen">
      <header className="bg-surface border-b-2 border-line flex items-center justify-between gap-2 px-4 py-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <CarpiHead size={42} />
          <div className="min-w-0">
            <h1 className="font-pixel font-bold text-lg leading-tight text-accent">STOCKCITO</h1>
            <p className="text-xs text-soft truncate">
              {[branchName, profile.name].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
        <nav className="flex gap-1.5 items-center shrink-0">
          <button onClick={() => setTab('mostrador')} className={tabClass(tab === 'mostrador')}>
            <ClipboardList size={16} /> Mostrador
          </button>
          <button onClick={() => setTab('remitos')} className={tabClass(tab === 'remitos')}>
            <FileText size={16} /> Remitos
          </button>
          <ThemeToggle />
          <button
            onClick={logout}
            title="Salir"
            aria-label="Salir"
            className="p-2 rounded-md cursor-pointer text-soft hover:text-ink hover:bg-sunken"
          >
            <LogOut size={16} />
          </button>
        </nav>
      </header>
      <main className="max-w-3xl mx-auto p-4">{tab === 'mostrador' ? <Mostrador /> : <Remitos />}</main>
    </div>
  )
}

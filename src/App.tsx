import { useEffect, useState } from 'react'
import { ClipboardList, FileText, LogOut } from 'lucide-react'
import { api, clearToken, getToken, type Branch, type Profile } from './lib/api'
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

  return (
    <div className="min-h-screen bg-amber-50">
      <header className="bg-amber-700 text-white flex items-center justify-between gap-2 px-4 py-2.5 shadow">
        <div className="min-w-0">
          <h1 className="font-bold text-lg leading-tight">Stockcito</h1>
          <p className="text-xs text-amber-200 truncate">
            {[branchName, profile.name].filter(Boolean).join(' · ')}
          </p>
        </div>
        <nav className="flex gap-2 shrink-0">
          <button
            onClick={() => setTab('mostrador')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded ${tab === 'mostrador' ? 'bg-amber-900' : 'hover:bg-amber-800'}`}
          >
            <ClipboardList size={16} /> Mostrador
          </button>
          <button
            onClick={() => setTab('remitos')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded ${tab === 'remitos' ? 'bg-amber-900' : 'hover:bg-amber-800'}`}
          >
            <FileText size={16} /> Remitos
          </button>
          <button onClick={logout} title="Salir" aria-label="Salir" className="px-2 hover:bg-amber-800 rounded">
            <LogOut size={16} />
          </button>
        </nav>
      </header>
      <main className="max-w-3xl mx-auto p-4">{tab === 'mostrador' ? <Mostrador /> : <Remitos />}</main>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { ClipboardList, FileText, LogOut } from 'lucide-react'
import { api, clearToken, getToken, type Profile } from './lib/api'
import Login from './pages/Login'
import Mostrador from './pages/Mostrador'
import Remitos from './pages/Remitos'
import Dashboard from './pages/Dashboard'

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [tab, setTab] = useState<'mostrador' | 'remitos'>('mostrador')
  const [loading, setLoading] = useState(true)

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

  function logout() {
    clearToken()
    setProfile(null)
  }

  if (loading) return null
  if (!profile) return <Login onLogin={setProfile} />
  if (profile.role === 'admin') return <Dashboard onLogout={logout} />

  return (
    <div className="min-h-screen bg-amber-50">
      <header className="bg-amber-700 text-white flex items-center justify-between px-4 py-3 shadow">
        <h1 className="font-bold text-lg">Control de Stock</h1>
        <nav className="flex gap-2">
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
          <button onClick={logout} className="px-2 hover:bg-amber-800 rounded" title="Salir">
            <LogOut size={16} />
          </button>
        </nav>
      </header>
      <main className="max-w-3xl mx-auto p-4">{tab === 'mostrador' ? <Mostrador /> : <Remitos />}</main>
    </div>
  )
}

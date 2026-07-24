import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ClipboardList, FileText, LogOut } from 'lucide-react'
import { supabase, type Profile } from './lib/supabase'
import Login from './pages/Login'
import Mostrador from './pages/Mostrador'
import Remitos from './pages/Remitos'
import Dashboard from './pages/Dashboard'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [tab, setTab] = useState<'mostrador' | 'remitos'>('mostrador')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) {
      setProfile(null)
      return
    }
    supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => setProfile(data))
  }, [session])

  if (loading) return null
  if (!session) return <Login />
  if (!profile) return <p className="p-8 text-center text-gray-500">Cargando perfil…</p>
  if (profile.role === 'admin') return <Dashboard profile={profile} />

  return (
    <div className="min-h-screen bg-amber-50">
      <header className="bg-amber-700 text-white flex items-center justify-between px-4 py-3 shadow">
        <h1 className="font-bold text-lg">Di Polo Pastas</h1>
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
          <button onClick={() => supabase.auth.signOut()} className="px-2 hover:bg-amber-800 rounded" title="Salir">
            <LogOut size={16} />
          </button>
        </nav>
      </header>
      <main className="max-w-3xl mx-auto p-4">
        {tab === 'mostrador' ? (
          <Mostrador branchId={profile.branch_id!} />
        ) : (
          <Remitos branchId={profile.branch_id!} />
        )}
      </main>
    </div>
  )
}

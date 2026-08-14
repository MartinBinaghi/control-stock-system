import { useEffect, useState, type FormEvent } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { api, setToken, type Profile } from '../lib/api'
import Carpi from '../components/Carpi'
import ThemeToggle from '../components/ThemeToggle'

// Una sola pantalla pública: login, registro de admins, y los dos links que
// llegan por email (?verify= activa la cuenta, ?invite= pide elegir contraseña).

export default function Login({ onLogin }: { onLogin: (p: Profile) => void }) {
  const [mode, setMode] = useState<'login' | 'signup' | 'invite'>('login')
  const [inviteToken, setInviteToken] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const verify = params.get('verify')
    const invite = params.get('invite')
    if (verify)
      api('/verify', { method: 'POST', body: JSON.stringify({ token: verify }) })
        .then(() => setNotice('Cuenta verificada. Ya podés iniciar sesión.'))
        .catch((e) => setError((e as Error).message))
    if (invite) {
      setInviteToken(invite)
      setMode('invite')
    }
    if (verify || invite) history.replaceState(null, '', location.pathname)
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (mode === 'signup') {
        await api('/signup', { method: 'POST', body: JSON.stringify({ name, email, password }) })
        setNotice('Te enviamos un email con el link para verificar tu cuenta.')
        setMode('login')
      } else if (mode === 'invite') {
        await api('/accept-invite', { method: 'POST', body: JSON.stringify({ token: inviteToken, password }) })
        setNotice('Contraseña creada. Iniciá sesión con tu email.')
        setMode('login')
      } else {
        const loginReq = () =>
          api<{ token: string; profile: Profile }>('/login', {
            method: 'POST',
            body: JSON.stringify({ email, password }),
          })
        const { token, profile } = await loginReq().catch(async (firstErr) => {
          await new Promise((r) => setTimeout(r, 1000))
          return loginReq().catch(() => {
            throw firstErr
          })
        })
        setToken(token)
        onLogin(profile)
        return
      }
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <ThemeToggle className="fixed top-3 right-3" />
      <form onSubmit={submit} className="card p-8 w-full max-w-md space-y-4">
        <div className="flex flex-col items-center gap-2">
          <Carpi size={168} pose={showPassword ? 'peeking' : 'open'} />
          <h1 className="font-pixel font-bold text-3xl text-accent tracking-wide">STOCKCITO</h1>
          <p className="text-sm text-soft text-center">
            {mode === 'signup'
              ? 'Crear cuenta de administrador'
              : mode === 'invite'
                ? 'Elegí tu contraseña'
                : 'Carpi lleva la cuenta del stock'}
          </p>
        </div>
        {mode === 'signup' && (
          <input
            required
            placeholder="Tu nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input w-full"
          />
        )}
        {mode !== 'invite' && (
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input w-full"
          />
        )}
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            required
            minLength={mode === 'login' ? undefined : 6}
            placeholder={mode === 'login' ? 'Contraseña' : 'Contraseña (mínimo 6)'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input w-full pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            title={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            className="absolute inset-y-0 right-0 px-3 flex items-center text-soft hover:text-ink cursor-pointer"
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        {error && <p className="text-danger text-sm bg-danger-soft border-2 border-danger/40 rounded-md p-2">{error}</p>}
        {notice && <p className="text-ok text-sm bg-ok-soft border-2 border-ok/40 rounded-md p-2">{notice}</p>}
        <button disabled={busy} className="btn btn-primary w-full py-2">
          {busy ? 'Enviando…' : mode === 'signup' ? 'Crear cuenta' : mode === 'invite' ? 'Guardar contraseña' : 'Ingresar'}
        </button>
        {mode !== 'invite' && (
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'signup' : 'login')
              setError('')
              setNotice('')
            }}
            className="w-full text-sm text-accent hover:underline cursor-pointer"
          >
            {mode === 'login' ? 'Crear una cuenta nueva' : 'Ya tengo cuenta — iniciar sesión'}
          </button>
        )}
      </form>
    </div>
  )
}

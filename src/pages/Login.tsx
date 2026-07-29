import { useEffect, useState, type FormEvent } from 'react'
import { api, setToken, type Profile } from '../lib/api'

// Una sola pantalla pública: login, registro de admins, y los dos links que
// llegan por email (?verify= activa la cuenta, ?invite= pide elegir contraseña).

export default function Login({ onLogin }: { onLogin: (p: Profile) => void }) {
  const [mode, setMode] = useState<'login' | 'signup' | 'invite'>('login')
  const [inviteToken, setInviteToken] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
        const { token, profile } = await api<{ token: string; profile: Profile }>('/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
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
    <div className="min-h-screen bg-amber-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-lg p-8 w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold text-center text-amber-800">Stockcito</h1>
        <p className="text-sm text-gray-500 text-center">
          {mode === 'signup' ? 'Crear cuenta de administrador' : mode === 'invite' ? 'Elegí tu contraseña' : 'Iniciar sesión'}
        </p>
        {mode === 'signup' && (
          <input
            required
            placeholder="Tu nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border rounded-lg px-3 py-2"
          />
        )}
        {mode !== 'invite' && (
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border rounded-lg px-3 py-2"
          />
        )}
        <input
          type="password"
          required
          minLength={mode === 'login' ? undefined : 6}
          placeholder={mode === 'login' ? 'Contraseña' : 'Contraseña (mínimo 6)'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border rounded-lg px-3 py-2"
        />
        {error && <p className="text-red-700 text-sm bg-red-50 rounded-lg p-2">{error}</p>}
        {notice && <p className="text-green-700 text-sm bg-green-50 rounded-lg p-2">{notice}</p>}
        <button
          disabled={busy}
          className="w-full bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-white font-semibold rounded-lg py-2"
        >
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
            className="w-full text-sm text-amber-800 hover:underline"
          >
            {mode === 'login' ? 'Crear una cuenta nueva' : 'Ya tengo cuenta — iniciar sesión'}
          </button>
        )}
      </form>
    </div>
  )
}

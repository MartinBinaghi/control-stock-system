# Plan de Mejoras de Seguridad — Stockcito (S1-S5のみ)

**Fecha:** 2026-08-05  
**Rama:** `feat/mejoras-de-seguridad`  
**Alcance:** Solo S1–S5 del TO-DO.md + A1 (Security Headers) + A2 (Account Lockout) por ser complementos naturales

---

## Resumen de Tareas (S1-S5 + A1 + A2)

| ID | Tarea | Severidad | Esfuerzo | Prioridad |
|----|-------|-----------|----------|-----------|
| **S1** | Access Token 15min + Refresh Token rotativo (7d) + Revocación BD | 🔴 ALTO | 🟡 MEDIO | **P0** |
| **S2** | SSE sin token en URL (Cookie HttpOnly) | 🟡 MEDIO | 🟡 MEDIO | **P0** |
| **S3** | Rate limiting en `/login`, `/signup`, `/verify`, `/accept-invite` | 🟡 MEDIO | 🟢 BAJO | **P0** |
| **S4** | Password policy + zxcvbn + HaveIBeenPwned | 🟡 MEDIO | 🟡 MEDIO | **P1** |
| **S5** | Expiración token verificación email (24h) + cleanup job | 🟡 MEDIO | 🟢 BAJO | **P1** |
| **A1** | Security Headers (Helmet: CSP, HSTS, X-Frame-Options, etc.) | *Nuevo* | 🟢 BAJO | **P0** |
| **A2** | Account Lockout (5 intentos fallidos → 15 min) | *Nuevo* | 🟢 BAJO | **P0** |

---

## Orden de Implementación (Lógico, no estricto)

1. **S3** Rate limiting — rápido, bajo riesgo, impacto inmediato
2. **A1** Security Headers (Helmet) — rápido, protege toda la app
3. **A2** Account Lockout — complementa S3, mismo endpoint `/login`
4. **S1** Access/Refresh tokens — cambio arquitectónico mayor
5. **S2** SSE con cookies HttpOnly — requiere S1 funcionando
6. **S4** Password policy + zxcvbn + HIBP — valida en signup/login/accept-invite
7. **S5** Email token expiry (24h) + job limpieza — BD + endpoints

---

## Detalle Técnico por Tarea

---

### S3: Rate Limiting (`express-rate-limit`)

**Deps:** `npm i express-rate-limit @types/express-rate-limit`

**En `server/index.ts`:**
```typescript
import rateLimit from 'express-rate-limit'

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones, intente más tarde' }
})

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos, intente en 15 minutos' },
  skipSuccessfulRequests: true
})

app.use('/api/', apiLimiter)
app.post('/api/login', authLimiter, ...)
app.post('/api/signup', authLimiter, ...)
app.post('/api/verify', authLimiter, ...)
app.post('/api/accept-invite', authLimiter, ...)
// Nota: /api/refresh se añade cuando se implemente S1
```

---

### A1: Security Headers (Helmet)

**Deps:** `npm i helmet @types/helmet`

**En `server/index.ts` (al inicio, antes de rutas):**
```typescript
import helmet from 'helmet'

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'wss:', 'https://api.pwnedpasswords.com'],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  noSniff: true,
  xssFilter: true,
  frameguard: { action: 'deny' }
}))

// Dev: CSP relajada para HMR
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:")
    next()
  })
}
```

---

### A2: Account Lockout (5 intentos → 15 min)

**BD (`schema.sql`):**
```sql
alter table users add column failed_login_attempts int not null default 0;
alter table users add column locked_until timestamptz;
create index on users (locked_until) where locked_until is not null;
```

**En `server/index.ts` → `/api/login`:**
```typescript
// Verificar bloqueo ANTES de verificar password
if (u.locked_until && u.locked_until > new Date()) {
  const mins = Math.ceil((u.locked_until.getTime() - Date.now()) / 60000)
  return res.status(429).json({ error: `Cuenta bloqueada. Intente en ${mins} minutos.` })
}

if (!verifyPassword(password, u.password_hash)) {
  const attempts = u.failed_login_attempts + 1
  const updates = ['failed_login_attempts = $1']
  const params = [attempts]
  if (attempts >= 5) {
    updates.push('locked_until = $2')
    params.push(new Date(Date.now() + 15 * 60 * 1000))
  }
  params.push(u.id)
  await pool.query(`update users set ${updates.join(', ')} where id = $${params.length}`, params)
  return res.status(401).json({ error: 'Email o contraseña incorrectos' })
}

// Login exitoso: resetear
await pool.query('update users set failed_login_attempts = 0, locked_until = null where id = $1', [u.id])
```

---

### S1: Access Token (15min) + Refresh Token Rotativo (7d)

**BD (`schema.sql`):**
```sql
create table refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users on delete cascade,
  token_hash text not null,
  user_agent text,
  ip_address inet,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by uuid references refresh_tokens
);
create index on refresh_tokens (user_id);
create index on refresh_tokens (token_hash);
```

**En `server/auth.ts` (añadir):**
```typescript
import { randomBytes, scryptSync } from 'node:crypto'

export function generateAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET!, { expiresIn: '15m' })
}

export function generateRefreshToken(): string {
  return randomBytes(48).toString('hex')  // 384 bits
}

export function hashRefreshToken(token: string): string {
  const salt = randomBytes(16).toString('hex')
  return salt + ':' + scryptSync(token, salt, 64).toString('hex')
}

export function verifyRefreshTokenHash(token: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  return timingSafeEqual(scryptSync(token, salt, 64), Buffer.from(hash, 'hex'))
}
```

**Endpoints nuevos en `server/index.ts`:**

```typescript
// POST /api/login — ahora devuelve access + refresh (cookie HttpOnly)
app.post('/api/login', authLimiter, async (req, res) => {
  // ... verificación password ...
  const accessToken = generateAccessToken(u.id)
  const refreshToken = generateRefreshToken()
  const refreshHash = hashRefreshToken(refreshToken)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  
  await pool.query(
    `insert into refresh_tokens (user_id, token_hash, user_agent, ip_address, expires_at) 
     values ($1, $2, $3, $4, $5)`,
    [u.id, refreshHash, req.headers['user-agent'] ?? '', req.ip ?? '', expiresAt]
  )

  const COOKIE_OPTS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/'
  }
  res.cookie('refreshToken', refreshToken, { ...COOKIE_OPTS, maxAge: 7 * 24 * 60 * 60 * 1000 })
  res.cookie('accessToken', accessToken, { ...COOKIE_OPTS, maxAge: 15 * 60 * 1000 })

  res.json({ token: accessToken, profile: { ... } })
})

// POST /api/refresh — rota refresh token
app.post('/api/refresh', authLimiter, async (req, res) => {
  const refreshToken = req.cookies?.refreshToken
  if (!refreshToken) return res.status(401).json({ error: 'No refresh token' })

  const { rows } = await pool.query(
    `select id, user_id, token_hash, expires_at, revoked_at 
     from refresh_tokens where expires_at > now() and revoked_at is null`
  )
  const match = rows.find(r => verifyRefreshTokenHash(refreshToken, r.token_hash))
  if (!match) return res.status(401).json({ error: 'Refresh token inválido o revocado' })

  // Rotar: revocar actual, crear nuevo
  const newRefreshToken = generateRefreshToken()
  const newRefreshHash = hashRefreshToken(newRefreshToken)
  const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  
  await pool.query(
    `update refresh_tokens set revoked_at = now(), replaced_by = $1 where id = $2`,
    [newRefreshToken, match.id]  // simplificado; en realidad insertar nuevo row
  )
  await pool.query(
    `insert into refresh_tokens (user_id, token_hash, user_agent, ip_address, expires_at, replaced_by)
     values ($1, $2, $3, $4, $5, $6)`,
    [match.user_id, newRefreshHash, req.headers['user-agent'] ?? '', req.ip ?? '', newExpiresAt, match.id]
  )

  const accessToken = generateAccessToken(match.user_id)
  const COOKIE_OPTS = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' as const, path: '/' }
  res.cookie('refreshToken', newRefreshToken, { ...COOKIE_OPTS, maxAge: 7 * 24 * 60 * 60 * 1000 })
  res.cookie('accessToken', accessToken, { ...COOKIE_OPTS, maxAge: 15 * 60 * 1000 })
  res.json({ token: accessToken })
})

// POST /api/logout — revoca refresh token actual
app.post('/api/logout', async (req, res) => {
  const refreshToken = req.cookies?.refreshToken
  if (refreshToken) {
    const { rows } = await pool.query(
      `select id, token_hash from refresh_tokens where expires_at > now() and revoked_at is null`
    )
    const match = rows.find(r => verifyRefreshTokenHash(refreshToken, r.token_hash))
    if (match) await pool.query('update refresh_tokens set revoked_at = now() where id = $1', [match.id])
  }
  res.clearCookie('refreshToken', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/' })
  res.clearCookie('accessToken', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/' })
  res.json({ ok: true })
})

// Middleware authed actualizado: lee accessToken de cookie primero
function authed(fn: ...) {
  return async (req, res) => {
    const token = req.cookies?.accessToken 
      ?? /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] 
      ?? String(req.query.token ?? '')
    // ... resto igual
  }
}
```

**Frontend (`src/lib/api.ts`):**
```typescript
export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch('/api' + path, {
    ...options,
    credentials: 'include',  // ¡Crucial para cookies!
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  if (res.status === 401) {
    const body = await res.json().catch(() => ({}))
    if (body.error === 'Token expirado' || body.code === 'TOKEN_EXPIRED') {
      const refreshRes = await fetch('/api/refresh', { method: 'POST', credentials: 'include' })
      if (refreshRes.ok) {
        // Reintentar request original
        return fetch('/api' + path, { ...options, credentials: 'include', headers: { 'Content-Type': 'application/json', ...options.headers } })
          .then(r => r.json())
      }
    }
  }
  if (!res.ok) throw new Error(...)
  return res.json()
}

export const clearToken = async () => {
  await fetch('/api/logout', { method: 'POST', credentials: 'include' })
}
```

**`src/pages/Login.tsx`:** Eliminar `setToken` localStorage, `onLogin` recibe profile del response.

---

### S2: SSE sin Token en URL (Cookies)

**En `server/index.ts`:** `/api/events` ya usa middleware `authed` que ahora lee cookie → **no cambios extra necesarios**.

**En `src/pages/Dashboard.tsx`:**
```tsx
// Antes: const es = new EventSource('/api/events?token=' + getToken())
// Ahora:
const es = new EventSource('/api/events', { withCredentials: true })
```

---

### S4: Password Policy + zxcvbn + HaveIBeenPwned

**Deps:** `npm i zxcvbn @types/zxcvbn`

**En `server/auth.ts` (añadir):**
```typescript
import zxcvbn from 'zxcvbn'
import { createHash } from 'node:crypto'

export interface PasswordStrength {
  score: number
  feedback: string[]
  warning: string | null
}

export function checkPasswordStrength(password: string): PasswordStrength {
  const result = zxcvbn(password)
  return { score: result.score, feedback: result.feedback.suggestions, warning: result.feedback.warning }
}

export const MIN_PASSWORD_SCORE = 3

export async function checkPwned(password: string): Promise<boolean> {
  const hash = createHash('sha1').update(password).digest('hex').toUpperCase()
  const prefix = hash.slice(0, 5), suffix = hash.slice(5)
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, { signal: AbortSignal.timeout(3000) })
    const text = await res.text()
    return text.split('\n').some(line => line.split(':')[0] === suffix && parseInt(line.split(':')[1]) > 0)
  } catch { return false } // Fail-open: si API falla, no bloquear
}
```

**En `server/index.ts` → `/api/signup`, `/api/accept-invite` (y opcionalmente `/api/login` para cambio password futuro):**
```typescript
const strength = checkPasswordStrength(password)
if (strength.score < MIN_PASSWORD_SCORE) {
  return res.status(400).json({ error: 'Contraseña muy débil', details: strength.feedback })
}
if (await checkPwned(password)) {
  return res.status(400).json({ error: 'Esta contraseña apareció en filtraciones. Elija otra.' })
}
```

**Frontend (`Login.tsx`):** Añadir medidor visual de fortaleza (usar `zxcvbn` en cliente via CDN o bundle).

---

### S5: Email Token Expiry (24h) + Cleanup Job

**BD (`schema.sql`):**
```sql
alter table users add column token_expires_at timestamptz;
update users set token_expires_at = created_at + interval '24 hours' where token is not null and token_expires_at is null;
```

**En `server/index.ts`:**

- **`/api/signup`** y **`/api/invite`**: al crear usuario, `token_expires_at = new Date(Date.now() + 24*60*60*1000)`
- **`/api/verify`**: `where token = $1 and role = 'admin' and token_expires_at > now()`
- **`/api/accept-invite`**: `where token = $1 and role = 'encargado' and token_expires_at > now()`

**Nuevo archivo `server/cleanup-tokens.ts`:**
```typescript
import pg from 'pg'
try { process.loadEnvFile() } catch {}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
await pool.query(`update users set token = null, token_expires_at = null where token is not null and token_expires_at < now()`)
await pool.end()
console.log('Tokens expirados limpiados')
```
Ejecutar via cron diario: `0 3 * * * node server/cleanup-tokens.ts`

---

## Archivos a Modificar (Resumen)

| Archivo | Cambios |
|---------|---------|
| `server/schema.sql` | +refresh_tokens, +token_expires_at, +failed_login_attempts, +locked_until |
| `server/index.ts` | Rate limit, Helmet, Account Lockout, Login/Refresh/Logout, Signup/Invite con expiry, SSE via cookie |
| `server/auth.ts` | Token pair, hash refresh, password strength, pwned check |
| `server/cleanup-tokens.ts` | Nuevo: job limpieza tokens email |
| `src/lib/api.ts` | `credentials: 'include'`, auto-refresh en 401, `clearToken` llama `/api/logout` |
| `src/pages/Login.tsx` | Quitar localStorage token, medidor fortaleza password, logout llama API |
| `src/pages/Dashboard.tsx` | SSE con `withCredentials: true` |
| `package.json` | +express-rate-limit, helmet, zxcvbn, cookie-parser, @types/* |

---

## Verificación (Definition of Done)

- [ ] `npm run build` ✅
- [ ] **S3:** 6 requests a `/api/login` en <15 min → 429
- [ ] **A2:** 5 passwords mal → 429 "Cuenta bloqueada 15 min"
- [ ] **A1:** Headers CSP, HSTS, X-Frame-Options, Referrer-Policy presentes
- [ ] **S1:** Login → access 15min, refresh 7d en cookies HttpOnly; 16min después → auto-refresh transparente
- [ ] **S1:** `/api/logout` revoca refresh token, limpia cookies
- [ ] **S2:** Dashboard SSE conecta sin `?token=`, recibe alertas en vivo
- [ ] **S4:** Password score <3 → 400 con feedback; pwned → 400
- [ ] **S5:** Signup → email token expira 24h; verify con token viejo → 400 "Link expirado"
- [ ] **S5:** `node server/cleanup-tokens.ts` limpia tokens expirados

---

## Riesgos Conocidos

| Riesgo | Mitigación |
|--------|------------|
| Refresh rotation rompe sesiones | Probar en staging; mantener compatibilidad Bearer header temporal |
| Cookies no funcionan en proxy | Verificar `SameSite=Strict` + `Secure` en HTTPS real (Caddy/nginx) |
| HIBP API lenta/cae | Timeout 3s + fail-open (no bloquear si falla) |
| CSP rompe Vite HMR | CSP relajada en `NODE_ENV !== 'production'` |

---

¿Procedemos con la implementación? Puedo empezar con **S3 + A1 + A2** (rápidos, alto impacto) y seguir con **S1 + S2 + S4 + S5**.
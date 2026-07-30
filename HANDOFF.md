# Handoff — Stockcito (control-stock-system)

Contexto para retomar en una sesión nueva de Claude Code. Generado 2026-07-30.

## ⚠️ Lo más importante: estado de las ramas

El rediseño visual completo **está a salvo y terminado en la rama `cambios-esteticos`**
(último commit `aa3d655 "carpi funcionando"`). No se perdió nada.

Hoy la sesión anterior cambió de rama:
`cambios-esteticos` → `main` → creó `cambios-en-pestaña-admin` (nueva, parte de `main`,
que está en el commit `5a76447`, **anterior** al rediseño).

Por eso ahora mismo el working tree (rama `cambios-en-pestaña-admin`) tiene el diseño
genérico viejo (ámbar, sin Carpi, sin toggle de tema, `src/components/Carpi.tsx` ni
siquiera existe en esta rama). Esto es **esperado**, no un bug ni una reversión accidental.

- Si la próxima sesión es para **seguir con el rediseño**: `git checkout cambios-esteticos`.
- Si es para **trabajar en la pestaña admin** (a juzgar por el nombre de la rama): quedarse
  acá, pero tener en cuenta que esta rama todavía no tiene el rediseño — en algún momento
  va a hacer falta mergear/rebasear `cambios-esteticos` para unificar ambos trabajos.
- Dato aparte: existe además `remotes/origin/fix/general` con commits sueltos (botones
  editar/borrar producto, columna nueva en `products`) que no están mergeados en ninguna
  rama local activa. Puede ser trabajo de otra sesión/dispositivo — revisar antes de asumir
  que se perdió o que hay que rehacerlo.

## Qué es el proyecto

React 19 + Vite 6 + TypeScript + Tailwind v4 + Express + Postgres. Sistema de control de
stock multi-sucursal. Roles: `admin` (panel completo, `Dashboard.tsx`) y `encargado`
(vista simple: `Mostrador.tsx` + `Remitos.tsx`, con tabs en `App.tsx`).

## El rediseño (rama `cambios-esteticos`)

### Decisiones de diseño (ya cerradas con el usuario, no volver a preguntar)
- Estética "retro pixel" profesional-amigable: negro/carbón + naranja.
- Mascota: capybara pixel-art llamado **Carpi**, con chaleco reflectante y libreta/clipboard.
- Tema claro + oscuro con toggle (oscuro por default).
- Intensidad **híbrida**: fuente pixel (Pixelify Sans, self-hosted) solo en logo/títulos/botones;
  sans-serif normal para tablas y datos densos.
- Nombre de la app se mantiene: "Stockcito".

### Archivos clave (en `cambios-esteticos`)
- `src/index.css` — tokens de diseño como custom properties CSS (`--base`, `--surface`,
  `--ink`, `--accent`, etc.), mapeados a utilidades Tailwind vía `@theme inline`. Clases
  `.card`, `.panel`, `.btn`/`.btn-primary`/`.btn-ghost`, `.input`. Flip claro/oscuro con
  clase `.dark` en `<html>`.
- `index.html` — script inline pre-paint que setea `.dark` leyendo `localStorage` (default
  oscuro), evita flash de tema incorrecto.
- `src/components/ThemeToggle.tsx` — botón sol/luna, togglea `.dark` + `localStorage`.
- `src/components/Carpi.tsx` — la mascota. Pixel art hecho a mano: grid de 66×66
  caracteres → color hex → `<rect>` SVG por píxel (`shapeRendering="crispEdges"`).
  - `GRID_OPEN` (base), `GRID_CLOSED` (blink, sin usar aún), `GRID_PEEKING` (ojo asimétrico,
    se usa cuando la contraseña está visible), `GRID_COVERED` (pata tapando ojos) —
    **tiene un bug conocido y sin arreglar** en las filas 19-24 (corrompe la zona de la
    nariz/máscara). Está deshabilitado, documentado con comentarios `ponytail:` en el
    archivo. Si se quiere retomar la animación "se tapa los ojos", hay que rehacer esas filas.
  - `POSES` map + `export type CarpiPose`. `CarpiHead` = crop chico para el header/logo.
- `src/pages/Login.tsx` — usa `<Carpi size={168} pose={showPassword ? 'peeking' : 'open'} />`
  (el `'open'` en vez de `'covered'` es el fix del bug de la nariz reportado por el usuario).
  Toggle mostrar/ocultar contraseña con iconos `Eye`/`EyeOff` de `lucide-react`.
- `src/pages/Mostrador.tsx`, `Remitos.tsx`, `Dashboard.tsx`, `App.tsx` — reescritos con las
  clases de tokens nuevas (`.card`, `.panel`, `.input`, `.btn`, `text-danger`, `text-ok`),
  `font-pixel` en headers.
- `public/fonts/pixelify-sans.woff2` — fuente self-hosted.
- `public/icons/icon-192.png`, `icon-512.png` — regenerados desde el grid de Carpi.
- `vite.config.ts` — `theme_color`/`background_color` del manifest PWA actualizados.
- `*.pixil` en la raíz (`Carpi.pixil`, `carpi_nuevo.pixil`, `Carpi grande.pixil`,
  `Carpi espiando.pixil`) — archivos del usuario editados en pixilart.com, ya reconstruidos
  pixel a pixel dentro de `Carpi.tsx`. No tocar/borrar, son de él.

## Metodología / técnicas usadas (no son skills formales de Claude Code, son
## workflows que armamos ad-hoc y conviene reusar si se vuelve a tocar Carpi)

1. **Formato `.pixil` de Pixilart**: JSON con `frames[].layers[].src` como PNG en base64.
   No hay documentación oficial, se reverse-engineerió por prueba y error.
2. **Encoder/decoder PNG a mano** (sin dependencias): RGBA tipo 6, `zlib.deflateSync`,
   CRC32 manual — para generar íconos PWA y `.pixil`, y para decodificar los `.pixil` que
   el usuario edita y re-sube (el decoder tiene que revertir el filtrado por scanline
   correctamente — None/Sub/Up/Average/Paeth — un primer intento naive daba basura).
3. **Patching por diff, nunca a mano**: cada pose alternativa de Carpi se genera como
   `replaceRows(GRID_OPEN, {fila: nuevoContenido, ...})`, calculado programáticamente
   contra una extracción fresca del archivo real (regex sobre el `.tsx` actual) — nunca
   retipeando el grid de memoria, eso ya causó bugs de transcripción más de una vez.
4. **Calibración de alineación por fuerza bruta**: cuando el usuario reexporta un `.pixil`
   editado, el canvas suele ganar padding transparente extra (ej. 66×66 → 70×70) y no
   siempre es simétrico. Se prueban todos los offsets candidatos `(padX, padY)` y se toma
   el que minimiza el diff de píxeles contra el grid conocido, en vez de asumir centrado.
5. **Verificación visual real**: `mcp__claude-in-chrome__*` para levantar la app, loguearse
   (seteando `localStorage.stockcito_token` o pegándole a `/api/login` directo) y comparar
   screenshots contra lo esperado.

No se invocó ningún `/skill` formal en esta sesión (la única skill global disponible es
`graphify`, no se usó).

## Pendiente / no resuelto
- Bug de `GRID_COVERED` (filas 19-24) sin arreglar, solo evitado (ver arriba).
- Unificar `cambios-esteticos` con lo que se haga en `cambios-en-pestaña-admin` (y
  eventualmente `origin/fix/general`) en algún momento — nadie pidió esto todavía,
  no asumir un merge sin que el usuario lo pida.

## Nota sobre `.gitignore` / datos de prueba
Ya se le explicó al usuario que **no** hay que sacar nada del `.gitignore` para compartir
datos de prueba con un compañero: `.env`/`.env.local` deben seguir ignorados (tienen
`DATABASE_URL` con password y `JWT_SECRET`), y los datos seed viven en Postgres, no en
archivos versionables. La forma correcta es que el compañero corra `server/seed.ts` (o el
script de seed que corresponda) contra su propio Postgres local.

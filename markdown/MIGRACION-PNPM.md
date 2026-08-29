# Migración de npm a pnpm

Este proyecto dejó de usar `npm` y pasó a **pnpm**. Motivo: los ataques de "supply chain" (paquetes infectados que salen en las noticias cada dos por tres) suelen ejecutarse vía scripts `postinstall` que corren automáticamente al instalar. pnpm **bloquea esos scripts por default** y solo los corre si los aprobamos explícitamente uno por uno — npm los corre siempre, sin preguntar. El registro de paquetes sigue siendo el mismo (`npmjs.org`), así que no cambia nada del código ni de las dependencias, solo la herramienta que instala.

## 1. Instalar pnpm

Elegí una opción:

**Opción A — Corepack (viene con Node, es la forma "oficial")**
```bash
corepack enable pnpm
corepack use pnpm@latest
```
> En Windows puede fallar con un error de permisos (`EPERM ... C:\Program Files\nodejs\pnpm`) porque intenta escribir en una carpeta de sistema. Si te pasa eso, saltá a la opción B — no hace falta correr nada como administrador.

**Opción B — Instalar vía npm (última vez que lo vas a usar)**
```bash
npm install -g pnpm
```

Verificá que quedó instalado:
```bash
pnpm --version
```

## 2. Actualizar tu copia local del proyecto

```bash
git pull                          # traer los cambios de la migración
rm -rf node_modules package-lock.json   # si te quedó el package-lock.json viejo (ya no debería estar en el repo)
pnpm install
```

Si `pnpm install` te pide aprobar algún script de instalación (mensaje tipo `Ignored build scripts: ...`), es la protección funcionando — **no lo aprueves a ciegas**. `esbuild` ya está aprobado en `pnpm-workspace.yaml` (viene commiteado, no hace falta hacer nada con ese). Si aparece un paquete *distinto* pidiendo permiso, avisame antes de aprobarlo para revisarlo juntos.

## 3. Comandos nuevos

Todo lo que antes era `npm run algo` ahora es `pnpm algo` (sin el `run`):

| Antes | Ahora |
|---|---|
| `npm install` | `pnpm install` |
| `npm run dev` | `pnpm dev` |
| `npm run dev:server` | `pnpm dev:server` |
| `npm run build` | `pnpm build` |
| `npm start` | `pnpm start` |

## 4. De ahora en más

- **No uses `npm install` en este proyecto** — te va a regenerar un `package-lock.json` que no corresponde y puede generar conflictos con `pnpm-lock.yaml` (el lockfile real ahora es ese).
- Si agregás una dependencia nueva, usá `pnpm add <paquete>` (o `pnpm add -D <paquete>` para devDependencies), no `npm install <paquete>`.
- `pnpm-lock.yaml` se commitea igual que se commiteaba `package-lock.json` antes — no lo borres ni lo pongas en `.gitignore`.

Cualquier duda o si algo no arranca después de migrar, avisame.

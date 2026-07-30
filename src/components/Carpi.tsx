// Carpi, el carpincho de Stockcito: pixel art dibujado como grilla SVG.
// Cada carácter de una fila es un píxel; '.' es transparente.
// Hay 4 poses de ojos (para reaccionar al mostrar/ocultar contraseña en el login):
// 'open' (mirando), 'closed' (parpadeo), 'covered' (se tapa los ojos con la pata)
// y 'peeking' (espiando, ceja levantada — para cuando la contraseña está visible).
// 'covered' tiene un bug visual en la máscara/nariz — no está en uso, ver GRID_COVERED.
const COLORS: Record<string, string> = {
  o: '#33261a', // contorno
  f: '#c08a4d', // pelaje
  d: '#96683a', // pelaje oscuro / mascara facial / patas
  b: '#e8926e', // rubor
  v: '#ff7a1f', // chaleco reflectante
  w: '#d95f00', // sombra del chaleco
  r: '#c3c9bd', // franja reflectante
  p: '#f7f1de', // libreta
  l: '#9c9483', // renglones
  k: '#000000', // ojo espiando (pupila pura, distinta del contorno)
}

// Grilla base 66x66 (el diseño original de 22x22 escalado x3, con más detalle en los ojos).
const GRID_OPEN = [
  '............ooooooooo........................ooooooooo............',
  '............ooooooooo........................ooooooooo............',
  '............ooooooooo........................ooooooooo............',
  '.........oooddddddooo........................oooddddddooo.........',
  '.........oooddddddooo........................oooddddddooo.........',
  '.........oooddddddooo........................oooddddddooo.........',
  '.........oooooooooooooooooooooooooooooooooooooooooooooooo.........',
  '.........oooooooooooooooooooooooooooooooooooooooooooooooo.........',
  '.........oooooooooooooooooooooooooooooooooooooooooooooooo.........',
  '......oooffffffffffffffffffffffffffffffffffffffffffffffffooo......',
  '......oooffffffffffffffffffffffffffffffffffffffffffffffffooo......',
  '......oooffffffffffffffffffffffffffffffffffffffffffffffffooo......',
  '......oooffffffffffffffffffffffffffffffffffffffffffffffffooo......',
  '......oooffffffffffffffffffffffffffffffffffffffffffffffffooo......',
  '......oooffffffffffffffffffffffffffffffffffffffffffffffffooo......',
  '......oooffffffooooooffffffffffffffffffffffffooooooffffffooo......',
  '......oooffffffooooooffffffffffffffffffffffffooooooffffffooo......',
  '......oooffffffooooooffffffffffffffffffffffffooooooffffffooo......',
  '......ooofffbbbfffffffffddddddddddddddddddfffffffffbbbfffooo......',
  '......ooofffbbbfffffffffddddddddddddddddddfffffffffbbbfffooo......',
  '......ooofffbbbfffffffffddddddddddddddddddfffffffffbbbfffooo......',
  '......ooofffffffffffffffddddoddddddddoddddfffffffffffffffooo......',
  '......ooofffffffffffffffdddoooddddddooodddfffffffffffffffooo......',
  '......ooofffffffffffffffdddoooddddddooodddfffffffffffffffooo......',
  '......ooofffffffffffffffddddddddddddddddddfffffffffffffffooo......',
  '......ooofffffffffffffffddddddddddddddddddfffffffffffffffooo......',
  '......ooofffffffffffffffddddddddddddddddddfffffffffffffffooo......',
  '......ooofffffffffffffffffffffoooooofffffffffffffffffffffooo......',
  '......ooofffffffffffffffffffffoooooofffffffffffffffffffffooo......',
  '......ooofffffffffffffffffffffoooooofffffffffffffffffffffooo......',
  '......ooovvvrrrrrrvvvvvvvvvffffffffffffvvvvvvvvvrrrrrrvvvooo......',
  '......ooovvvrrrrrrvvvvvvvvvffffffffffffvvvvvvvvvrrrrrrvvvooo......',
  '......ooovvvrrrrrrvvvvvvvvvffffffffffffvvvvvvvvvrrrrrrvvvooo......',
  '...ooovvvvvvrrrrrrvvvvvvvvvvvvffffffvvvvvvvvvvvvrrrrrrvvvvvvooo...',
  '...ooovvvvvvrrrrrrvvvvvvvvvvvvffffffvvvvvvvvvvvvrrrrrrvvvvvvooo...',
  '...ooovvvvvvrrrrrrvvvvvvvvvvvvffffffvvvvvvvvvvvvrrrrrrvvvvvvooo...',
  '...ooovvvvvvrrrrrrvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvrrrrrrvvvvvvooo...',
  '...ooovvvvvvrrrrrrvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvrrrrrrvvvvvvooo...',
  '...ooovvvvvvrrrrrrvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvrrrrrrvvvvvvooo...',
  '...ooovvvvvvrrrrrroooppppopppopppopppopppopppooorrrrrrvvvvvvooo...',
  '...ooovvvvvvrrrrrroooppppopppopppopppopppopppooorrrrrrvvvvvvooo...',
  '...ooovvvvvvrrrrrroooppppopppopppopppopppopppooorrrrrrvvvvvvooo...',
  '...ooovvvvvvrrrrrroooppppppppppppppppppppppppooorrrrrrvvvvvvooo...',
  '...ooovvvvvvrrrrrroooppppppppppppppppppppppppooorrrrrrvvvvvvooo...',
  '...ooovvvvvvrrrrrroooppppppppppppppppppppppppooorrrrrrvvvvvvooo...',
  '...ooovvvvvvrrrrrrooopppllllllllllllllllllpppooorrrrrrvvvvvvooo...',
  '...ooovvvvvvrrrrrrooopppllllllllllllllllllpppooorrrrrrvvvvvvooo...',
  '...ooovvvvvvrrrrrrooopppllllllllllllllllllpppooorrrrrrvvvvvvooo...',
  '...ooovvvvvvrrrrrroooppppppppppppppppppppppppooorrrrrrvvvvvvooo...',
  '...ooovvvvvvrrrrrroooppppppppppppppppppppppppooorrrrrrvvvvvvooo...',
  '...ooovvvvvvrrrrrroooppppppppppppppppppppppppooorrrrrrvvvvvvooo...',
  '...ooovvvvvvrrrrrroooppplllllllllppppppppppppooorrrrrrvvvvvvooo...',
  '...ooovvvvvvrrrddddddppplllllllllppppppppppppddddddrrrvvvvvvooo...',
  '...ooovvvvvvrrrddddddppplllllllllppppppppppppddddddrrrvvvvvvooo...',
  '...ooowwwwwwwwwddddddppppppppppppppppppppppppddddddwwwwwwwwwooo...',
  '...ooowwwwwwwwwddddddppppppppppppppppppppppppddddddwwwwwwwwwooo...',
  '...ooowwwwwwwwwddddddppppppppppppppppppppppppddddddwwwwwwwwwooo...',
  '...oooffffffffffffoooppppppppppppppppppppppppoooffffffffffffooo...',
  '...oooffffffffffffoooppppppppppppppppppppppppoooffffffffffffooo...',
  '...oooffffffffffffooooooooooooooooooooooooooooooffffffffffffooo...',
  '......ooofffffffffdddddddddffffffffffffdddddddddfffffffffooo......',
  '......ooofffffffffdddddddddffffffffffffdddddddddfffffffffooo......',
  '......ooofffffffffdddddddddffffffffffffdddddddddfffffffffooo......',
  '.........oooooooooooooooooooooooooooooooooooooooooooooooo.........',
  '.........oooooooooooooooooooooooooooooooooooooooooooooooo.........',
  '.........oooooooooooooooooooooooooooooooooooooooooooooooo.........',
]

const GRID_CLOSED = replaceRows(GRID_OPEN, {
  21: '......ooofffffffffffffffddddddddddddddddddfffffffffffffffooo......',
  23: '......ooofffffffffffffffddddddddddddddddddfffffffffffffffooo......',
})

// Carpi espiando: como GRID_OPEN pero con una ceja levantada asimétrica (ojo
// oculto detrás de la oreja izquierda) — pose pícara para cuando la contraseña
// está visible en el login.
const GRID_PEEKING = replaceRows(GRID_OPEN, {
  17: '......oooffffffppkkppffffffffffffffffffffffffooooooffffffooo......',
})

// ponytail: bug conocido — el parche pisa la máscara/nariz y se ve mal (marco +
// rayitas en vez de ojos). No está en uso (Login.tsx usa 'open' mientras tanto).
// Arreglar el parche de filas 19-24 antes de volver a usar esta pose.
const GRID_COVERED = replaceRows(GRID_OPEN, {
  19: '......ooofffbbbfffffffffdddooddddooddddoodfffffffffbbbfffooo......',
  20: '......ooofffbbbfffffffffdooooooooooooooooofffffffffbbbfffooo......',
  21: '......ooofffffffffffffffdodddddddddddddddofffffffffffffffooo......',
  22: '......ooofffffffffffffffdodddddddddddddddofffffffffffffffooo......',
  23: '......ooofffffffffffffffdodddddddddddddddofffffffffffffffooo......',
  24: '......ooofffffffffffffffdooooooooooooooooofffffffffffffffooo......',
})

function replaceRows(grid: string[], patch: Record<number, string>): string[] {
  return grid.map((row, i) => patch[i] ?? row)
}

const POSES = { open: GRID_OPEN, closed: GRID_CLOSED, covered: GRID_COVERED, peeking: GRID_PEEKING } as const
export type CarpiPose = keyof typeof POSES

function Pixels({ rows }: { rows: string[] }) {
  return (
    <>
      {rows.flatMap((row, y) =>
        [...row].map((c, x) =>
          c === '.' ? null : <rect key={`${x}.${y}`} x={x} y={y} width="1" height="1" fill={COLORS[c]} />,
        ),
      )}
    </>
  )
}

/** Carpi de cuerpo entero, con chaleco y libreta. Cambia de pose con la prop `pose`. */
export default function Carpi({
  size = 132,
  pose = 'open',
  title = 'Carpi, el carpincho de Stockcito',
}: {
  size?: number
  pose?: CarpiPose
  title?: string
}) {
  return (
    <svg viewBox="0 0 66 66" width={size} height={size} shapeRendering="crispEdges" role="img" aria-label={title}>
      <Pixels rows={POSES[pose]} />
    </svg>
  )
}

/** Solo la cabeza (siempre con ojos abiertos), para usar de logo en el header. */
const HEAD = [...GRID_OPEN.slice(0, 30), GRID_OPEN[6]!]
export function CarpiHead({ size = 36 }: { size?: number }) {
  return (
    <svg viewBox="0 0 66 31" width={size} height={size * (31 / 66)} shapeRendering="crispEdges" aria-hidden="true">
      <Pixels rows={HEAD} />
    </svg>
  )
}

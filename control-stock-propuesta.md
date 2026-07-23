Actúa como un Senior Full-Stack Architect y Lead Developer. Vamos a construir desde cero la primera fase del sistema **Di Polo Pastas - Sistema Integral de Control de Stock Multi-Sucursal**.

### 🚀 Visión General del Proyecto
Es una solución para una franquicia gastronómica con múltiples puntos de venta. El objetivo es controlar el stock en tiempo real, registrar mermas, auditar movimientos por encargado y validar remitos en PDF emitidos por la fábrica contra el conteo físico del local.

---

### 🛠️ Arquitectura y Stack Tecnológico
1. **Frontend**: React + Vite + Tailwind CSS + Lucide Icons.
2. **PWA**: `@vite-pwa/plugin-pwa` para comportamiento nativo de escritorio (PC/Windows) y mobile (iOS/Android) en modo `standalone` (sin barra de navegador).
3. **Backend & DB**: Supabase (PostgreSQL, Supabase Auth, Row Level Security - RLS, y Supabase Realtime).
4. **Modo de Operación**: Strictly Online (sin complejidad offline-first).
5. **Parser de PDFs**: `pdf-parse` o parser ligero en JS para extraer texto de remitos digitales nativos.

---

### 🗄️ Esquema de Base de Datos Recomendado (PostgreSQL / Supabase)

Crea e implementa los scripts SQL con RLS (Row Level Security) para las siguientes tablas:

1. **`branches`** (Sucursales): `id`, `name`, `address`, `created_at`.
2. **`profiles`** (Usuarios/Roles): `id` (FK auth.users), `email`, `role` ('admin' | 'encargado'), `branch_id` (FK branches, NULL si es admin).
3. **`products`** (Catálogo global): `id`, `name`, `category`, `unit`, `min_stock_threshold`, `created_at`.
4. **`inventory`** (Stock actual por sucursal): `id`, `branch_id`, `product_id`, `current_stock`, `updated_at`.
5. **`stock_movements`** (Historial e Auditoría): `id`, `branch_id`, `product_id`, `type` ('ingreso_manual', 'egreso_manual', 'merma', 'remito_fabrica'), `quantity`, `manager_name` (string obligatorio), `reason` (string para mermas), `created_at`.
6. **`remitos`**: `id`, `branch_id`, `pdf_name`, `status` ('correcto', 'con_incongruencia'), `manager_name`, `created_at`.
7. **`remito_items`**: `id`, `remito_id`, `product_id`, `expected_qty`, `actual_qty`, `discrepancy_qty`.
8. **`alerts`**: `id`, `branch_id`, `product_id`, `type` ('stock_critico', 'desvio_remito'), `message`, `resolved` (boolean), `created_at`.

---

### 🔐 Seguridad y Políticas RLS (Row Level Security)
* **Perfil Admin (Dueño)**: Puede leer/escribir/editar todas las tablas de todas las sucursales.
* **Perfil Encargado**: Solo puede consultar y registrar datos donde `branch_id` coincida con su `branch_id` asignado.

---

### 🧩 Módulos Clave a Implementar (Fase por Fase)

#### 1. Autenticación y Layout PWA
* Login mediante Supabase Auth.
* Detectar rol del usuario al ingresar.
* Configuración de Manifest PWA (`vite-plugin-pwa`) con soporte para instalación en escritorio/mobile, iconos y colores de marca.

#### 2. Gestión Manual de Stock y Mermas (Pantalla Mostrador)
* Selector o lista rápida de productos de la sucursal.
* Modal para registro de **Entrada/Salida**.
* Modal obligatorio para **Mermas** (con selector de causa: vencimiento, cadena de frío, rotura, etc.).
* Campo **obligatorio**: "Nombre del Encargado" en cada transacción.

#### 3. Módulo de Procesamiento de Remitos PDF
* Input para subir archivo PDF de la fábrica.
* Extracción de texto y mapeo por patrones (Producto -> Cantidad Esperada).
* Tabla comparativa para que el encargado ingrese el **Conteo Físico Real**.
* Si `Cantidad Físico != Cantidad Esperada`:
  * Marcar incongruencia visual en rojo.
  * Generar un registro en la tabla `alerts`.
  * Notificar vía Supabase Realtime al panel del Administrador.

#### 4. Panel Administrador (Dashboard Global)
* Muestra el stock consolidado de todas las sucursales.
* Consola de Alertas en tiempo real (mermas severas, quiebres de stock, desvíos de remitos).
* Filtros de búsqueda avanzada por: Sucursal, Producto, Rango de Fechas y Rango Horario.

---

### 🚀 Tu Primera Tarea
Por favor, genera la estructura del proyecto en React + Vite + Tailwind, la configuración del plugin PWA y los scripts SQL completos de Supabase con sus correspondientes políticas RLS para iniciar el desarrollo.
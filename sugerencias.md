# Funciones sugeridas desde sistema de facturación antiguo

Análisis de capturas del sistema de facturación actualmente en desuso, filtrado por lo que tiene sentido para un sistema de **gestión de stock** (sin POS de venta).

## Alta prioridad

### Proveedores
Tabla y edición de proveedores con:
- Código, nombre, razón social
- Tipo de IVA, CUIT
- Contacto, teléfono, fax, email
- Dirección completa
- Cuentas contables asociadas

Hoy no existe ningún registro de proveedores. Asociar productos a su proveedor permitiría trazabilidad de compra.

### Unidades de medida
Tabla de unidades normalizadas con una marcada como default:
- BOBINA, KILO, LITRO, METRO, UNIDAD, etc.

Actualmente `unit` en productos es un string libre. Una tabla permite consistencia y evita errores de tipeo.

### Categorías y Subcategorías
Clasificación jerárquica de productos:
- Categoría padre
- Subcategoría hija

Actualmente `category` en productos es un string plano. Una jerarquía permitiría filtros más granulares y reportes por grupo.

### Marcas
Tabla de marcas de productos. Actualmente no existe. Útil para:
- Filtrar stock por marca
- Agrupar productos del mismo fabricante

### Código de barras / Código en proveedor
Campos adicionales en el producto:
- **Código de barras**: para lectura con escáner
- **Código en proveedor**: referencia que usa el proveedor para identificar el artículo

## Media prioridad

### Compras a proveedores
Registro de facturas/órdenes de compra:
- Seleccionar proveedor
- Agregar artículos con cantidad, costo unitario, IVA, descuento
- Al confirmar, ingresa stock automáticamente

Esto cerraría el ciclo completo: **compra → stock → consumo/remito → alerta**. Actualmente el stock solo se modifica manualmente o por movimientos internos.

### Stock por ubicación / depósito
Múltiples ubicaciones físicas dentro de una sucursal:
- Ventas (gondola)
- Depósito 1, Depósito 2, etc.

Hoy el stock se maneja a nivel sucursal. Permitir sub-ubicaciones daría más precisión en inventario.

### Punto de reposición por proveedor
El campo `min_stock_threshold` existe, pero se podría complementar con:
- Proveedor sugerido para reposición
- Cantidad mínima de compra por pedido
- Tiempo de entrega estimado del proveedor

## Baja prioridad (más de facturación)

### Listas de precios múltiples
Varias listas de precio por producto:
- CONTADO, LISTA 1, LISTA 2, LISTA 3...
- Cada lista con costo + descuento, margen, precio calculado, precio de venta

Relevante si en algún momento se quiere valorizar el stock o calcular precios de transferencia entre sucursales, pero más propio de un sistema POS.

### Composición del precio
Desglose detallado del precio final:
- Costo base
- Descuento %
- Flete %
- Alícuota
- Impuestos internos %

Útil para cálculo de costos real, pero se superpone con lo que ya hace el sistema de procesos y recetas.

### Ficha técnica
Tab adicional en el artículo para:
- Especificaciones técnicas
- Ofertas vigentes
- Notas internas

De bajo impacto para gestión de stock puro.

### Clasificación de clientes
El sistema viejo tiene "Clasificación de Clientes" en sus tablas maestras. No aplica a un sistema de stock interno (no hay clientes).

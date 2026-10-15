# Prueba manual: cancelar y rechazar dos solicitudes técnicas

## Resultado final recibido — 15/10/2026

Miguel aporta results y preflight completos tras las cancelaciones manuales:

- Ambos UUIDs fijos existen con `status=cancelled` y estado final esperado.
- Evento/payload originales correctos,1/500/EUR cada uno, sin aviso de pago ni
  aprobación, con fecha de cierre y `closed_by_protected_admin=true`,0tickets.
- Se conservan2pedidos pagados y4tickets previos. Ambas huellas coinciden EXACTAS
  con el preflight inicial: pagados `b052deae4b649f7843804e7c6c12ec1e`, tickets
  `5eed8356b2617a803271e530ea7212e7`. `closure_fixture_count=2`.

**Prueba manual de cancelación cerrada con evidencia de capturas de Miguel.**
No recrear, reabrir ni borrar los registros. El protocolo de abajo queda como
histórico, no como tarea pendiente ni instrucción de repetir escrituras. Esta
evidencia no certifica Production, otros compradores/roles, concurrencia alojada,
grants/cuerpos completos o un recorrido comprador `/ticket` no capturado.

## Cambio vigente: cancelar ambas, sin rechazo separado

Miguel ha simplificado el producto a aceptar o cancelar. Las dos solicitudes de
esta guía YA existen: su captura verifica ambas pendientes, payload/evento exactos,
1/500/EUR cada una, sin aviso/aprobación/fecha de cierre y cero tickets. **No volver
a ejecutar el script de creación ni crear sustitutas.** Los pasos de creación y
rechazo de abajo son históricos y quedan sustituidos por este bloque:

1. En `/admin/requests`, localizar `PRUEBA CIERRE - CANCELAR`; probar `Cancelar
   solicitud` → `Volver sin cambios`, después cancelar y confirmar.
2. En `PRUEBA CIERRE - RECHAZAR` (nombre histórico inmutable), usar también
   `Cancelar solicitud` → `Confirmar cancelación`. Ya no hay botón «Rechazar».
3. El archivo `order-closure-results.readonly.sql` ya espera `cancelled` en AMBAS
   filas. Ejecutar ese contenido actualizado; no reutilizar una copia vieja.
4. Repetir preflight y comparar cifras/huellas iniciales; no tocar los dos pedidos
   confirmados/cuatro tickets anteriores. Este resultado final ya fue recibido arriba.

No se cambian datos/snapshot ni SQL alojado con esta simplificación. Se conserva
la compatibilidad de estados/RPC históricos, no son nuevas acciones de la app.

## Estado y alcance

Miguel pidió preparar esta prueba el15/10/2026. **Preparación y ejecución manual
completadas; estados finales y conservación verificados mediante sus capturas.**
Las funciones alojadas tienen existencia/modos/permisos esperados según su captura;
eso no acredita el recorrido firmado. No hay herramienta Supabase de ejecución
directa en esta sesión: los pasos alojados son manuales y sus resultados se revisan.

**Preflight manual recibido (capturas de Miguel):** evento
`diwo-technical-test-20261012`, UUID técnico correcto, `is_published=true`,
`sales_time_reached=true`, `not_real_event=true`;2pedidos pagados/4tickets previos,
`closure_fixture_count=0`. Huella de pedidos pagados:
`b052deae4b649f7843804e7c6c12ec1e`; huella de tickets:
`5eed8356b2617a803271e530ea7212e7`. Son la referencia para comparar tras la prueba;
no se obtuvieron mediante acceso directo del asistente. Las dos solicitudes nuevas
siguen sin haberse creado según esta evidencia. No hace falta modificar el evento.

Comprobación de la preparación:6tests del script correctos,8tests SQL locales
(incluido el protocolo sobre estados ausente/pendiente/cerrado y huellas estables)
correctos y ESLint dirigido sin errores. Ninguno ejecuta peticiones alojadas.

La preparación no crea datos. El script que sigue sí crea/reutiliza exactamente dos
solicitudes ficticias al ejecutarse expresamente. No usarlo antes del preflight.
No cambia eventos, roles, SQL, ventas ni pedidos/entradas anteriores. No pulsa aviso
de Bizum, aprobación, cancelación o rechazo. No hay dinero real ni entradas nuevas.
El cierre posterior se realiza manualmente desde la UI con una sesión real de admin.

| Acción final | Comprador ficticio | UUID fijo | Cantidad/total nominal |
| --- | --- | --- | --- |
| Cancelar | `PRUEBA CIERRE - CANCELAR` | `cb67be71-6b85-4c80-b234-70a920ba41e8` | 1 / 500cents |
| Rechazar | `PRUEBA CIERRE - RECHAZAR` | `5856888b-18ee-4fb6-8e4f-ba6222e993ab` | 1 / 500cents |

Solo evento técnico existente `9d560641-aacf-4d25-8d65-94960bba59b2`, etiquetado por
el lector como PRUEBA TÉCNICA y excluido de métricas reales. No crear/publicar otro.
Los dos pedidos confirmados/cuatro tickets anteriores no deben alterarse.

## Paso1 — Preflight, solo lectura

En el mismo proyecto Supabase donde se aplicaron las funciones, ejecutar el archivo:

`supabase/validation/order-closure-preflight.readonly.sql`

Guardar las cifras y ambas huellas ANTES de crear solicitudes. No contiene QR ni
sujetos en claro. Las huellas usan un conjunto explícito de campos de negocio;
no son una auditoría completa de tokens, grants o columnas omitidas.

Debe devolver una fila del evento técnico, `not_real_event=true`, `is_published=true`
y `sales_time_reached=true`. Si no aparece/falla, **parar y compartir el resultado**.
No publicar el evento, cambiar horarios o abrir ventas para sortearlo: requeriría
otra autorización. Confirmar también que se está en el proyecto/entorno correcto.

Esperado en el último checkpoint:2pedidos pagados/4tickets; si las cifras difieren,
revisar antes de continuar, no repararlas. `closure_fixture_count` debe ser0 en la
primera ejecución. Si es1o2, revisar el archivo de resultados y las respuestas
anteriores: puede existir una creación parcial o una prueba ya realizada. Nunca
reemplazar UUIDs, eliminar filas o repetir la creación automáticamente.

## Paso2 — Crear las solicitudes desde la sesión firmada

Solo tras revisar preflight y confirmar que se desea ejecutar las dos creaciones:

1. Abrir `http://localhost:3000/admin/requests` en Edge, Chrome Invitado u otro
   navegador donde funcione el login. Usar la cuenta de Miguel con rol admin real.
2. Abrir en el editor `scripts/create-order-closure-test.browser.js`.
3. Copiar el contenido completo a la consola de esa pestaña y ejecutar una vez.
   No pegar claves, tokens ni cookies. El script usa la sesión ya abierta, no los lee.
4. El script verifica la sesión/rol mediante la API existente. Guarda ambos UUIDs
   y payload exacto en `sessionStorage` por cuenta/evento/pestaña antes del primer
   POST; almacenamiento bloqueado/manipulado o cambio de cuenta detiene la prueba.
5. Esperar `DIWO_CLOSURE_TEST_READY`, con dos resultados `pending`, cada uno1/500.
   Compartir únicamente el resumen seguro. Detenerse antes de pulsar acciones.

El script escribe únicamente `/api/orders/request`, una llamada por solicitud.
No reintenta automáticamente. Si falla el segundo POST, el primero puede existir:
conservar script/pestaña/almacenamiento y comprobar estado. Solo tras revisar podrá
reintentarse manualmente el MISMO script, con los MISMOS IDs/cuerpo. También admite
replays de los estados terminales esperados y los informa; nunca reabre pedidos.

## Paso3 — Confirmar creación, solo lectura

Ejecutar `supabase/validation/order-closure-results.readonly.sql`.

Esperado en ambas filas antes de cerrar:

- `exists=true`, `status=pending`, evento/payload exactos,1/500/EUR.
- `no_payment_notice=true`, `never_approved=true`, `ticket_count=0`.
- `closed_at=null`; `final_status_matches=false` es normal en esta fase.
- Repetir preflight: mismas huellas/cifras de pedidos pagados y tickets,
  ahora `closure_fixture_count=2`. Comparar con la captura previa.

No continuar con una fila equivocada o inesperadamente confirmada. No hay aviso
de pago ni checkbox de aprobación que marcar durante esta prueba.

## Paso4 — Cancelar la primera desde administración

1. Actualizar `/admin/requests` y localizar EXACTAMENTE `PRUEBA CIERRE - CANCELAR`.
2. Pulsar `Cancelar solicitud`; comprobar que aparece una confirmación explícita.
3. Primero pulsar `Volver sin cambios`: debe conservar `pending` y no escribir.
4. Volver a cancelar y pulsar `Confirmar cancelación` UNA vez.
5. Esperar el resultado verificado/refresco y comprobar `Cancelada`, historial
   conservado y desaparición de las acciones de aprobación/cierre de esa tarjeta.

## Paso5 — Rechazar la segunda desde administración

En EXACTAMENTE `PRUEBA CIERRE - RECHAZAR`, pulsar `Rechazar solicitud` y después
`Confirmar rechazo` UNA vez. Esperar estado `Rechazada`, sin aprobación ni entradas.

Un error de red o respuesta ambigua no implica fracaso ni éxito. No cambiar de
acción/ID ni insistir: actualizar, comprobar SQL y comunicar el mensaje seguro.

## Paso6 — Verificación final y evidencia

1. Repetir resultados: `cancelled` y `rejected` respectivamente; payload/evento
   exactos,1/500/EUR, sin aviso ni aprobación y `ticket_count=0`.
2. Ambas fechas `closed_at` presentes y `closed_by_protected_admin=true`.
3. Repetir preflight: cifras y huellas de pagados/tickets idénticas al inicio;
   ambas solicitudes conservadas. No eliminar los resultados al terminar.
4. Abrir `/ticket` con la misma cuenta compradora: comprobar el estado de ambas,
   sin QR ni entrada emitida, y conservar intactas las entradas anteriores.
5. Guardar resultados de solo lectura y confirmación visual, sin contraseñas,
   sujetos, cookies, QR ni sesión. Actualizar el estado del ensayo según la evidencia.

No certificar con esto comprador distinto/puerta, todas las denegaciones, revocación,
concurrencia alojada ni Production. Los tests locales cubren replay/denegaciones/
carreras; trasladarlos al entorno alojado exigiría un protocolo aparte. No enviar
POSTs adicionales ni probar con los pedidos pagados por iniciativa propia.

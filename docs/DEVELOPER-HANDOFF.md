# App Diwo — Handoff para continuar el desarrollo

Fecha: 15 de octubre de 2026. Responsable de producto: Miguel.

**Preparación posterior de Production — solo local:** consultar PRODUCTION-SETUP.md.
Autorizada compatibilidad local, NO despliegue/servicios/ventas. Origen HTTPS explícito,
claves live separadas, pin de destino Supabase explícito y Preview cerrado; localhost
Development se conserva. Miguel exige revisión del diseño visual ANTES de desplegar.
No hay proyecto Vercel ni dominio elegido aquí; Clerk Production requiere dominio
propio. Validador/copy de horario corregidos a inicio23:30 (22:30Z) el17oct por
confirmación de Miguel; no se modifican fixtures históricas ni datos alojados.
No cambiar alojado ni identidades automáticamente.

**Estado más reciente — 17 de octubre:** Miguel confirma PASS del ensayo firmado
aislado `scripts/test-scanner-sandbox.browser.js`: válida, repetida, anulada, dos
peticiones paralelas con una única admisión y U2/P0/V2. No repetir ni resetear fixtures.
App Diwo original no se modificó en ese ensayo. Ahora `/admin/tickets` y anulación
individual están implementados localmente: consultar `TICKET-ANNULMENT.md` y
`supabase/drafts/ticket-annulment-rpc.sql`. 22 checks de aplicación, uno SQL y32 de
concurrencia PG17 pasan; tipos/lint correctos. Personal ya estaba implementado.
Ambos SQL de personal/anulación esperan autorización de activación en Development;
no se han aplicado ni anulado entradas conservadas. UI renderizada y Production
siguen pendientes. Los checkpoints inferiores son históricos.

**Continuación 16 de octubre:** escáner online preparado localmente en `/scan`,
proyecto separado `diwo-scanner-test` creado manualmente por Miguel, con cinco
prechecks de vacío confirmados. Instalador LOCAL `supabase/testing/scanner-test-install.sql`
y verificación de11 indicadores preparados; ocho tests locales/lint correctos.
Miguel confirma Success y11 controles true; Clerk Development añadido en nuevo
proyecto. Project ID nuevo: `ofqywrjvzolmoqimkngt`. Verificador de solo lectura
`scripts/verify-scanner-sandbox-session.browser.js` preparado con siete tests locales;
espera ejecución manual con la sesión localhost3000 y Publishable key introducida
privadamente en prompt. Rol esperado `user` (no hereda admin original). No seed,
identidades ni cambio de destino de App Diwo; guía en `supabase/testing/README.md`.
con ampliación de pruebas de integración: runner PostgreSQL17.11 con32 pruebas
(cinco nuevas handler real + SQL real), handler unitario5 y ESLint correctos.
Concurrencia, commit ambiguo/sin reintento, rechazo seguro, roles actuales y
contadores verificados localmente. Los adaptadores de identidad/transporte son
técnicos: no acreditan una escritura alojada con Clerk/PostgREST.
Ensayo de cámara iPhone confirmado por Miguel (primera/repetida). Servidor temporal
cerrado; Miguel confirma certificado/regla retirados, bloqueos Node originales y
app conservados. No reabrir LAN automáticamente; detalle en DOOR-SCAN.md.
API `/api/door-scan` y fuente SQL `supabase/drafts/door-scan-rpcs.sql`. Primer uso
atómico, rechazo de repetidas/anuladas, rol actual y contadores U/P/V sin datos
financieros. Miguel aplicó manualmente el SQL autorizado: Success + captura de
catálogo con cuatro funciones/controles correctos. Captura de `/scan` admin muestra
el estado esperado sin evento publicado. No se consumieron las entradas conservadas.
Consultar DOOR-SCAN.md: BarcodeDetector con fallback local jsqr1.4.0 ya probado;
iPhone físico y revisión visual pendientes; polling no equivale a realtime.
Miguel autorizó arrancar localhost3000 para pruebas anónimas: servidor retenido,
Ensayo aislado añadido en `/admin/scan-rehearsal`: solo local/dev/admin, QR ficticios
por pestaña, sin RPC/persistencia de accesos. Comparte lector/cámara, pero simula los
resultados; no acredita check-in alojado ni sincronización entre móviles. Ahora
32 pruebas enfocadas pasan, tipos/lint correctos. Miguel aprobó simplificar mensajes:
Entrada validada / Entrada ya usada / Entrada incorrecta (motivo debajo), fallo de
comprobación separado. Feedback compartido por real/ensayo, sin cambios SQL/estados.
Miguel no tiene webcam: ensayo
incluye descarga PNG y carga de imagen local (no subida ni RPC). Puede leer el
mismo PNG A dos veces sin recargar para admisión simulada y rechazo por repetida;
esto no valida cámara física ni check-in alojado. No activar ni consumir fixtures
automáticamente. El bloque local de personal inferior se conserva sin alterarlo.

**Nuevo bloque local:** gestión de personal preparada en `/admin/staff` (búsqueda
exacta de cuenta Clerk/correo verificado, listado, asignación y retirada de puerta,
admin protegido y versiones contra cambios obsoletos). Consultar DOOR-STAFF.md y
`supabase/drafts/door-staff-rpcs.sql`. Este SQL NO se ha aplicado alojado ni se han
cambiado roles reales. La activación del escáner sigue pendiente. No confundir implementación
local con activación o prueba firmada en Supabase.

**Decisión de producto más reciente:** Miguel simplifica las solicitudes pendientes
a aceptar (pago comprobado/emisión) o cancelar. Se retira rechazo de UI/API; los
estados antiguos y SQL aplicado se conservan sin migrar datos. No reintroducir esa
acción por seguir el backlog histórico de este documento. Las dos solicitudes
técnicas nuevas ya están CANCELADAS según capturas finales: fecha/admin correctos,
payload conservado y0tickets. Preflight final conserva2pedidos pagados/4tickets y
ambas huellas originales; prueba manual de cancelación cerrada. Mantener esos
registros, no recrearlos ni repetir el ensayo. Evidencia en ORDER-CLOSURE-MANUAL-TEST.

**Actualización posterior al handoff inicial:** se ha preparado localmente la
cancelación/rechazo administrativo (SQL, API, confirmación UI y pruebas). Miguel
autorizó aplicar ese SQL y comunicó `Success` tras ejecutarlo manualmente en
Supabase. Su captura posterior confirma existencia de las tres funciones, modos
invoker/definer, search_path vacío y permisos de ejecución esperados. Quedan
pendientes cuerpos completos/destino/datos, registro de migración y flujo firmado
real; no reaplicar SQL para repetir el mensaje.
Consultar
[ORDER-CLOSURE.md](ORDER-CLOSURE.md). Los apartados que enumeran estas operaciones
como pendientes significan ahora pendientes de activación/verificación alojada;
no es necesario volver a implementarlas desde cero. Miguel ha indicado continuar
trabajando directamente en `main`, sin nuevas ramas. El login se ha apartado por
decisión de Miguel; no se da por resuelto. Invitado y Edge funcionan, su perfil
habitual de Chrome sigue fallando incluso tras desactivar extensiones.

Este documento resume el estado conocido, las decisiones aprobadas y el trabajo
pendiente. No contiene credenciales ni autoriza cambios en servicios alojados.
**No es una certificación de producción ni da por resuelto el fallo del login.**

## 1. Objetivo del producto

Aplicación para gestionar entradas de DIWO X 2.0: registro/acceso, solicitud de
entradas nominales para un grupo, pago manual por Bizum, aprobación por Miguel,
emisión/descarga/compartición de entradas y control de acceso online de un solo uso.

Tres espacios: comprador, administrador y personal de puerta. Administrador y
personal conservan las funciones de comprador sobre sus propios pedidos.

### Evento y alcance aprobado

- Fiesta: 31/10/2026 a las 23:30 hasta 01/11/2026 a las 07:00, `Europe/Madrid`.
- Precio: 500 céntimos EUR por entrada; calcular y validar también en servidor/DB.
- Previsión: 120–150 asistentes; **no es un límite comercial ni un aforo técnico**.
- Ubicación pública: «Casa de campo en Ceutí». No publicar dirección exacta,
  coordenadas ni mapa en aplicación, tickets o exportaciones. Miguel comunica la
  dirección por WhatsApp el último día, fuera de la aplicación.
- «Acceso hasta la 01:30» y la franja de llegada son mensajes de puntualidad:
  **no provocan rechazo ni caducidad en el escáner**.
- Ventas: cuando la aplicación esté lista y Miguel las active expresamente.
  El 15 de octubre fue una estimación retirada, no una apertura programada.
- No añadir reservas, contadores de disponibilidad, caducidad de impagados,
  transferencias/cambios de nombre, DNI, reentrada, registro de salidas,
  devoluciones automáticas ni un modo offline coordinado.
- No se ha solicitado envío automático de entradas por correo ni integración bancaria.

## 2. Repositorio y estado de entrega

- GitHub: <https://github.com/miguelsabater-47/App-Diwo> (repositorio público).
- Directorio local de proyecto: `C:\Users\Miguel\Proyectos\App Diwo`.
- Aplicación y único repositorio Git: subcarpeta `web/`.
- `main` local y `origin/main` comprobados en:
  `22e9aee03dace3617fd29f38966f16289d604bc7`.
- `feat/login-two-step` integrada en `main` por fast-forward y conservada.
- Árbol limpio antes de crear este documento. Este handoff es una incorporación
  posterior, todavía sin commit/push al redactarlo.
- No confundir push a GitHub con despliegue o apertura de ventas.

### Hitos de Git

| Commit | Contenido |
| --- | --- |
| `1c54328` | Autenticación local Clerk Development |
| `ca99363` | Solicitudes/pagos protegidos y detalle/QR/exportación propios |
| `014d729` | Experiencia DIWO de login y registro |
| `c5815d1` | Ajustes de recuperación y controles de contraseña |
| `115aa93` | Home de asistentes según referencia DIWO |
| `22e9aee` | Mis entradas vacía, solicitud rediseñada y ajustes del campo de login |

## 3. Documentación: qué leer y qué puede estar desactualizado

En el directorio padre, **fuera del Git de `web/`**, están los requisitos completos:

- `docs/FUNCIONALIDADES.md`: F01–F09 y condiciones de aceptación.
- `docs/DECISIONES.md`: decisiones de producto y seguridad.
- `docs/UX-UI.md`: pantallas y navegación por rol.
- `docs-ux-ui/DIWO_X2_UX_UI_Mis_Entradas.md`: estados de solicitudes/entradas.
- `SESSION-HANDOFF.md`: historial detallado, con cabecera anterior al último trabajo.
- `PLAN-APP-DIWO.md`: planificación/arquitectura histórica.

Un clon de GitHub **no incluye esos archivos del directorio padre**, `setup/`, las
herramientas locales ni la memoria. Pedirlos a Miguel si hacen falta; no ampliar
el repositorio ni publicar sus contenidos automáticamente.

Dentro del repositorio, consultar `docs/ORDER-API.md`, `ORDER-READS.md`,
`ORDER-UI.md`, `OWNED-TICKET-SQL.md`, `OWNED-TICKET-UI.md`, `LOGIN-UI.md`,
`HOME-UI.md`, `SIGNED-ORDER-TEST.md`, `UI-APPROVAL-TEST.md` y `supabase/README.md`.
Algunos conservan checkpoints históricos: frases «sin commit», «sin push»,
«QR pendiente» o «prueba pendiente» pueden haber quedado superadas. Usar la fecha,
el código actual y la evidencia concreta, no una frase histórica aislada.

## 4. Stack y ejecución local

- Next.js 15.5.27, App Router; React/React DOM 19.1.9; TypeScript.
- Tailwind CSS 4, componentes Radix y estilos propios DIWO.
- Clerk `@clerk/nextjs` 6.39.7 y localizaciones 3.37.9.
- `@supabase/supabase-js` declarado `^2.57.0`; instalación reproducible por lockfile.
- `qrcode` 1.5.4 para el QR local; `html-to-image` para PNG/JPG.
- Node local del proyecto: 24.16.0 en `.diwo-tools/`, fuera del repositorio.
- `package.json` conserva el nombre heredado `laporcha-aniversario`: no representa
  otro producto ni autoriza reutilizar funcionalidades antiguas.

Origen local canónico: `http://localhost:3000`. No usar un puerto nuevo como
solución silenciosa ni detener/reiniciar un listener existente sin autorización.

En el entorno de Miguel, ejecutar desde `web/`:

```powershell
& "../setup/Run-Web.ps1" -Command check
& "../setup/Run-Web.ps1" -Command lint
& "../setup/Run-Web.ps1" -Command test
```

Solo cuando corresponda y exista autorización para el ciclo de vida del entorno:

```powershell
& "../setup/Run-Web.ps1" -Command dev
& "../setup/Run-Web.ps1" -Command build
```

Hay comandos adicionales `http`, `sql` y `sql-race`; leer sus contratos antes de
ejecutar. La validación de concurrencia inicia un PostgreSQL temporal propio.
No lanzar instalaciones, pruebas con escrituras o fixtures por rutina.

En otro equipo, el wrapper del directorio padre puede faltar: usar los scripts
equivalentes de `package.json` con un Node compatible y el lockfile, configurando
el entorno privadamente. No asumir que el clon arranca con acceso a servicios.

Configuración privada local: `web/.env.local`, ignorada por Git y no publicada.
No copiarla al handoff, chat o repositorio. Utilizar la plantilla `.env.example`
como referencia de configuración, sin compartir valores reales. Las herramientas
automatizadas no deben leer archivos `.env` ni almacenes de credenciales.

## 5. Arquitectura y límites de seguridad

### Autenticación y roles

- Clerk autentica: Google y correo/contraseña, verificación de correo y recuperación.
- Supabase es la **única autoridad de roles de aplicación**. No elevar por correo,
  metadatos editables, un botón oculto o un rol enviado por el cliente.
- Roles: `user` por defecto, `door_staff` asignado/revocado y único `admin` protegido,
  Miguel. No crear otros administradores desde la aplicación.
- Reconsultar el rol actual en cada operación sensible, también dentro de la DB.
- Los sujetos Clerk son texto; no asumir que son UUID de Supabase Auth.
- Development y Production tienen usuarios/identidades/claves distintos. No copiar
  el sujeto Development como administrador de Production.
- No usar claves `service_role` como fallback ni debilitar RLS/grants para hacer
  funcionar una pantalla.

### Pedidos y pagos

- Una solicitud contiene comprador y N nombres obligatorios; los amigos no necesitan cuenta.
- Cada pedido tiene una referencia Bizum distinta del token QR de cada entrada.
- Un único Bizum por el total. Miguel coteja el banco manualmente antes de aprobar.
- «Ya he realizado el Bizum» solo avisa: no confirma pago ni emite entradas.
- El admin puede aprobar sin aviso previo del comprador.
- Aprobación atómica e idempotente: exactamente N entradas por pedido confirmado.
- UUID y payload exacto se conservan por cuenta/evento/pestaña antes del primer POST.
  Tras una respuesta ambigua, reintentar **el mismo UUID y cuerpo**, sin retry de
  escritura automático, sustitución de identificador ni duplicación del pedido.
- Lecturas personales filtradas explícitamente al actor verificado, incluso admin.
- No borrar ni reabrir historial pagado para facilitar una prueba.

### Entradas y puerta

- Un QR corresponde a un token persistido aleatorio, no un QR inventado en frontend.
- No exponer tokens como texto, URL, logs o columnas libremente seleccionables.
  La propia imagen QR es una credencial de acceso: tratarla como privada.
- El estado actual manda sobre las imágenes guardadas. Usada/anulada no permite acceso.
- Anular una entrada sin usar conserva el pedido pagado y las demás entradas.
  No devolución automática, reactivación ni anulación ordinaria de una usada.
- Check-in online atómico entre dispositivos; un único primer uso con hora/operador
  del servidor. La falta de red nunca equivale a éxito.
- Puerta recibe validación y agregados operativos, no pagos, pedidos ajenos o
  streams de filas completas/QR privados.
- Contadores: U=usadas; P=válidas sin usar; V=no anuladas, incluidas usadas;
  V=U+P. U es acumulado, no ocupación; P no es disponibilidad comercial.

## 6. Implementado y evidencia disponible

| Área | Estado conocido |
| --- | --- |
| Clerk Development y sesión firmada | Integración nativa y rol admin confirmados previamente por Miguel |
| Login DIWO | Google/correo → contraseña, retorno a Home, navegación/errores/single-flight; fallo Chrome abierto |
| Registro/recuperación/factores adicionales | Delegados a Clerk; no reemplazar con autenticación casera |
| Autorización | Helpers comunes, gates de servidor, rol vigente y lecturas propias |
| Solicitud múltiple | Validación, nombres, total, persistencia y reintento del mismo envío |
| Pago | Datos de Bizum, copia, aviso propio y estados; sin integración bancaria |
| Aprobación | API/RPC administrativa y emisión exacta; prueba técnica firmada y aprobación UI confirmadas |
| Mis entradas | Pedidos/estados/historial propios, sin mostrar estado vacío ante un error de lectura |
| Detalle/QR/exportación | Lectura propia, QR real, PNG/JPG y apertura del menú compartir confirmados en Chrome |
| Administración | Resumen y Solicitudes conectados; no confundir con gestión administrativa completa |
| Home/cuenta | Rol-aware; Home administrativa distinta de la promocional |
| Diseño reciente | Home asistentes, Mis entradas vacía y solicitud con cartel y nombre de perfil editable |

El nombre del comprador se prerrellena desde el perfil Clerk de la misma cuenta,
sin sobrescribir una edición manual, incluido dejarlo vacío, ni un payload guardado.

Compartir/exportar verifica antes el estado propio actual. Que se abra el selector
de Chrome no prueba entrega al destinatario, lectura física del QR o entrada en puerta.

### Base alojada y datos técnicos

- Fundación y RPC de solicitudes/pagos aplicadas históricamente y verificadas en
  checkpoints anteriores. Migraciones registradas:
  `20261011225839_diwo_foundation.sql` y
  `20261012105444_diwo_order_payment_rpcs.sql`.
- `supabase/drafts/owned-ticket-detail.sql`: Miguel comunicó ejecución manual
  correcta y existencia de funciones. **No reaplicarlo para repetir la prueba**.
  Verificación independiente de grants/historial correspondiente sigue pendiente.
- Persisten dos pedidos técnicos confirmados y cuatro entradas técnicas sin usar,
  según el último checkpoint de datos; no se han vuelto a contar en esta entrega.
- Marcarlos como ficticios/no válidos para DIWO real y excluirlos de métricas reales.
- El evento real no se ha creado/publicado en el último estado confirmado.
- Una etiqueta `PRODUCTION` del dashboard no demuestra que Clerk Production,
  identidad admin final y aplicación pública estén configurados/verificados.
- Conexión MCP de Supabase: mantener solo lectura. Nuevas escrituras, migraciones,
  fixtures, roles, publicación y configuración alojada requieren alcance explícito.

## 7. Incidencia prioritaria: contraseña inicial en Chrome

**Estado: ABIERTA. No volver a darla por resuelta por pasar mocks.**

Miguel usa Chrome y `http://localhost:3000/sign-in`. Al llegar al paso de contraseña
ve puntos como si hubiera una contraseña puesta; indica que no puede escribir hasta
tocar el ojo. Entonces desaparecen y puede escribir. Quiere inicio vacío con
placeholder «Contraseña» y ojo dedicado exclusivamente a mostrar/ocultar.

La captura facilitada corresponde al formulario personalizado, no al nativo Clerk.
No se ha demostrado la causa exacta en su perfil de navegador.

Intentos ya incluidos en `22e9aee`:

1. Campo nativo no controlado, `defaultValue=""` y ref estable; retirada del estado
   React de contraseña para evitar borrar un valor nativo tras un render.
2. El ojo solo alterna `visible`; no rellena, borra ni desbloquea el campo.
3. Envío explícito lee el valor nativo; atrás/cambio de correo lo limpia.
4. Formularios con keys distintas, sin helper oculto `autocomplete=username`.
5. `autocomplete=off` en formulario/campo y hints de exclusión para gestores.
   Chrome/extensiones pueden ignorarlos: no son una garantía.
6. Sin `readOnly`, disabled del campo ni temporizadores de desbloqueo.

Pruebas: un render interveniente sí borraba un valor nativo eventless con la versión
controlada anterior; el arreglo protege ese caso. **No explica necesariamente la
incidencia original de Miguel**, que sigue reportándola.

Se comprobó el servidor real del puerto 3000: proceso del proyecto y bundle con los
últimos cambios. En Chrome limpio, app real/Clerk real, correo sintético y sin enviar
contraseña: campo vacío, placeholder visible, foco correcto, escritura antes del ojo,
alternancias sin perder valor. Capturas examinadas muestran placeholder normal.
No se ha reproducido el comportamiento del perfil de Miguel.

Siguiente diagnóstico solicitado: con puntos visibles y ANTES de tocar el ojo,
obtener solo metadatos seguros de la pestaña afectada:

```js
(() => {
  const i = document.querySelector("#diwo-password");
  return {
    hasValue: Boolean(i?.value),
    placeholderShown: i?.matches(":placeholder-shown"),
    autofilled: i?.matches(":autofill"),
    readOnly: i?.readOnly,
    disabled: i?.disabled,
    autocomplete: i?.autocomplete,
    focused: document.activeElement === i
  };
})()
```

No pedir contraseñas, códigos, cookies, tokens, volcados completos de sesión o HAR
sin sanear. No acceder al almacén de contraseñas del navegador. Comparar, con Miguel,
perfil afectado frente a limpio y valor real frente a preview/gestor antes de otro
arreglo. No introducir un `new-password` a ciegas: puede sugerir una generada.

## 8. Pendientes funcionales y técnicos

### Prioridad 1 — Cerrar el acceso existente

- Reproducir/corregir la incidencia anterior en el entorno afectado.
- Verificar recorridos actuales completos: email/Google, registro/verificación,
  recuperación, sesiones, logout y continuación de factores/dispositivo nuevo.

### Prioridad 2 — Completar operaciones administrativas

- Cancelar/rechazar solicitudes no confirmadas con API/RPC y trazabilidad.
- Anular individualmente entradas válidas sin usar, sin alterar historia financiera.
- Conflictos aprobar/cancelar y usar/anular atómicos, con pruebas de ambos órdenes.
- Gestión/búsqueda administrativa de entradas por nombre, referencia o identificador.
- Asignar/retirar personal de cuentas registradas y verificadas; admin único protegido.
- Completar estadísticas/actividad previstas sin mezclar datos técnicos.

### Prioridad 3 — Puerta y sincronización

- Implementar `/scan` protegido para admin/door_staff, cámara y feedback claro.
- Check-in atómico real, rechazo de reutilización/anulación/otro evento/QR inválido.
- Verificar dos dispositivos simultáneos, sin reentrada ni reset de entradas usadas.
- Contadores autorizados U/P/V, sincronización por emisión/uso/anulación,
  reconexión y aviso de estado desactualizado. Hoy el resumen usa actualización manual.
- Revocación efectiva de permisos en acciones y lecturas, incluso pantalla abierta.
- Confirmar conectividad y respaldo operativo; búsqueda manual de puerta sigue
  siendo propuesta por concretar, no funcionalidad aprobada para implementar sin más.

### Prioridad 4 — Seguridad y pruebas integradas

- Matriz de comprador A/B, staff/admin, anon, APIs directas, propiedad y escalada.
- Grants/RLS y lector de detalle en base alojada, sin reaplicar SQL ni crear fixtures
  automáticamente. Preservación de historial y denegación de QR ajenos.
- Pruebas concurrentes reales y desconexión/respuesta ambigua en operaciones nuevas.
- QR físico desde pantalla y PNG/JPG compartido en Android/iPhone reales.
- Cerrar F09 completo; pruebas sintéticas y una cuenta admin-comprador no bastan.

### Prioridad 5 — Producción y activación

- Revisar código que exige `hasDevelopmentClerkKeys`: no basta con cambiar claves
  para declarar Production. Adaptar/verificar deliberadamente el entorno final.
- Dominio/HTTPS/alojamiento, secretos, Clerk Production, Google/URLs/correos y
  vinculación Supabase/admin propios del entorno final.
- Verificar política de contraseña aprobada: mínimo 10, filtradas rechazadas,
  correo verificado y sin acceso opcional por código como método alternativo.
- Comprobar destinatario Bizum real privadamente; no asumir configuración final.
- Crear/verificar el evento real y activar ventas solo por decisión de Miguel.
- Build final, límites/consumo, logs sin secretos, recuperación/respaldo y ensayo
  completo antes de compradores reales. Ningún despliegue final se acredita aquí.

El rediseño de las pantallas restantes es trabajo separado: no reemplazar operaciones
faltantes por botones o datos de demo. Preservar Home administrativa diferenciada.

## 9. Pruebas: resultados y límites

- Último checkpoint de commit: **45 pruebas enfocadas correctas** de login/flujo,
  límites de auth, Home, solicitud y su estado. No es el total de toda la suite.
- TypeScript sin emisión/incremental y ESLint dirigido pasaron tras los últimos
  cambios de código. `git diff --check` correcto antes de commit.
- El fast-forward a `main` no cambió el árbol de código probado.
- UI solicitud/vacía: render aislado a 320/390/1280 px, capturas revisadas, sin
  desbordamiento horizontal; no equivale a flujo firmado/hidratado completo.
- Login: pruebas montadas aisladas y navegador real limpio descritos en sección 7.
- Históricamente: 84 pruebas SQL locales sintéticas, 12 pruebas PG17.11 con 11
  escenarios multiconexión y 8 checks HTTP anónimos en sus checkpoints respectivos.
  No se han repetido todas sobre este último commit ni cubren los writers futuros.
- Build exitoso histórico anterior a varios cambios posteriores; hace falta build
  final. Warning conocido de módulos Node; un checkpoint de lint general tenía
  warning `no-img-element` de la imagen QR, sin errores. No declarar todo sin warnings.
- Scripts manuales de prueba en `scripts/` pueden crear datos: leer contrato y
  pedir alcance antes de ejecutarlos. No resetear los dos pedidos retenidos.

## 10. Mapa de código para orientarse

| Ruta | Responsabilidad |
| --- | --- |
| `components/login-screen.tsx`, `login-screen.css` | Login personalizado e incidencia abierta |
| `lib/login-flow.ts` | Validación, errores seguros, activación/continuación Clerk |
| `app/sign-in/[[...sign-in]]/page.tsx` | Selección de login propio o continuación nativa |
| `app/sign-up/`, `app/sso-callback/` | Registro y callback Google |
| `middleware.ts`, `lib/local-access.ts` | Límites de rutas/configuración; legacy bloqueado |
| `lib/app-authorization*.ts`, `lib/supabase-session.ts` | Actor firmado y roles DB actuales |
| `app/request/`, `components/order-request-form.tsx` | Solicitud/nombres/perfil/preview |
| `lib/order-request-state.ts`, `order-sales.ts` | Persistencia/idempotencia y disponibilidad real |
| `app/api/orders/`, `lib/order-mutation*.ts` | Creación, aviso y aprobación |
| `components/order-payment-details.tsx` | Bizum y aviso de pago |
| `lib/order-reads.ts`, `order-view-model.ts` | Lecturas seguras e historial/resumen |
| `app/ticket/`, `components/empty-tickets.tsx` | Listado propio y estado vacío |
| `lib/owned-ticket-*.ts`, `app/api/tickets/[id]/` | Detalle propio y QR seguro |
| `components/owned-ticket-{detail,actions}.tsx` | Presentación/exportación/compartir |
| `app/admin/{layout,page}.tsx`, `app/admin/requests/` | Administración conectada actual |
| `components/{attendee-home,app-chrome,auth-header,app-navigation}.tsx` | Home, shell y navegación |
| `components/{app-interface,ticket-request}.css` | Estilos DIWO actuales |
| `public/brand/`, `public/fonts/`, cartel/hero en `public/` | Assets aprobados |
| `supabase/{migrations,drafts,validation}/` | SQL aplicado/borradores/pruebas, no equivalentes |
| `tests/`, `docs/` | Regresiones y contratos de cada bloque |

Existen componentes/rutas heredados: su presencia no prueba que estén habilitados
ni que cumplan el modelo nuevo. No reactivar APIs/canje/escáner antiguos para ahorrar
trabajo sin revisar autorización, ownership y estado actual.

## 11. Forma de continuar y definición de terminado

1. Leer este documento, requisitos actuales y código afectado; revisar estado Git.
2. Resolver la incidencia de Chrome con evidencia de la pestaña afectada, no otro
   arreglo basado únicamente en un navegador limpio.
3. Acordar un bloque acotado del backlog, implementar mínimo y comprobarlo.
4. Separar «implementado», «probado localmente», «confirmado por Miguel» y
   «verificado en entorno final». No declarar resuelto lo que el usuario reproduce.
5. Solicitar autorización concreta para writes alojados, migraciones, fixtures,
   cambios de rol/evento, publicación, gasto, reinicio de servicios, commit y push.
   Las autorizaciones anteriores de Git fueron para operaciones ya realizadas.
6. No tocar otros proyectos ni mezclar su código/memoria. En el entorno original,
   memoria `app-diwo` en `.diwo-memory/`, local, sin Git/cloud; CodeGraph en
   `web/.codegraph/`. Son herramientas opcionales, no dependencias de la aplicación.

**Terminado** significa F01–F09 aceptados: compra/pago/emisión sin duplicados,
propiedad y roles seguros, gestión administrativa completa, QR legible y canje
único concurrente, contadores coherentes/revocables, recuperación ante fallos,
funcionamiento en móviles reales y entorno final configurado/verificado. Después,
Miguel autoriza la publicación y apertura. Diseño o tests unitarios por sí solos
no cierran el producto.

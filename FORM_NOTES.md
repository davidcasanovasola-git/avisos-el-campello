# FORM_NOTES — Formulario de incidencias de El Campello

Inspección hecha el **8 de noviembre de 2026**, solo con peticiones GET (la página del formulario, sus scripts y los dos buscadores de autocompletado). **No se ha enviado ningún parte.**

## 1. Página y tecnología

| | |
|---|---|
| URL del formulario | `GET https://intranet.elcampello.es/incidencias-extranet/nuevo` |
| Servidor | nginx + PHP 5.6.40 (Plesk). Por la cookie `laravel_session`, es Laravel 4.x |
| Sesión | La primera visita crea `laravel_session` (httponly, dura 2 h) |
| CORS | Todas las respuestas llevan `Access-Control-Allow-Origin: *` y `Allow-Methods: POST, OPTIONS` |
| robots.txt | `Disallow:` vacío (no prohíbe nada). La página lleva `noindex,nofollow` |
| Aviso en la página | "Si experimenta errores en la comunicación de incidencias use un navegador alternativo a Google Chrome." |

## 2. Envío

```
POST https://intranet.elcampello.es/incidencias-extranet/crear
Content-Type: multipart/form-data
```

- **Sin token CSRF**: el formulario no tiene `_token` ni meta CSRF, y ningún script lo añade.
- **Sin CAPTCHA** (ni reCAPTCHA, ni hCaptcha, ni Turnstile).
- **Antibots: hay un honeypot.** El campo oculto `email_importante` debe ir **vacío**. Si lleva algo, lo normal es que el servidor descarte el parte sin decir nada.
- **No hace falta JavaScript para enviar**: es un `<form>` HTML normal. El JS solo pinta el autocompletado, el contador de caracteres y la vista previa de fotos. → **No hace falta Playwright.**

## 3. Campos (en el orden del formulario)

| `name` | Tipo | Valor a enviar | Notas |
|---|---|---|---|
| `email_importante` | text (oculto con `sr-only`) | `""` | **Honeypot. Siempre vacío.** |
| `anonimo` | hidden | `0` | En la página no hay checkbox de anónimo (el JS busca `#anonimo`, pero no existe) |
| `nombre` | text | Nombre y apellidos | Hay un solo campo. **No piden DNI** |
| `email` | text | email | |
| `movil` | text | teléfono | |
| `notificar` | hidden `0` + checkbox `1` | `1` si quiero aviso | El patrón de Laravel: si marcas la casilla, el `1` llega después y gana |
| `calle` | text (`#buscador_calle`) | nombre visible | ⚠️ **Hay dos campos con `name="calle"`** |
| `calle` | hidden (`#calle`) | **ID numérico de la calle** | Va después, así que en PHP **gana el hidden**. Si no se elige una calle del autocompletado, `calle` llega vacía |
| `calle_num` | text | número del portal | |
| `ubicacion` | text (`#buscador_ubicacion`) | nombre visible | ⚠️ El mismo truco del doble campo |
| `ubicacion` | hidden (`#ubicacion`) | **ID numérico** del lugar | Para parques, playas, colegios… **Decisión: se envían los dos vacíos**; la posición exacta va en la descripción |
| `descripcion` | textarea | texto | Contador "x/50" en rojo si hay **menos de 50 caracteres**. Probablemente es el mínimo que valida el servidor |
| `ficheros[]` | file múltiple | fotos | Solo se aceptan **jpg y png** (en el navegador). No hay límite de tamaño en el navegador |
| `aceptar_terminos` | checkbox, marcado por defecto | `on` | |

**Lo que el formulario no tiene:**
- **No hay campo de tipo o categoría de incidencia.** El tipo hay que meterlo en el texto de la descripción.
- **No hay campo de coordenadas.** El JS menciona `#posicion` y `#coordenadas` (con un mapa estático de Google), pero esos campos no están en la página. Las coordenadas van en la descripción: la posición del pin, la precisión del GPS, las **coordenadas EXIF de cada foto** (si las trae) y el enlace a OSM.

## 4. Catálogos de calle y ubicación (autocompletado)

> **Decisión (8 de noviembre de 2026): no usamos el catálogo.** En `calle` se envía el texto de la calle que devuelve el mapa (OSM) y el hidden con el ID va vacío, como cuando alguien escribe la calle en el formulario oficial sin elegirla del desplegable. La dirección completa y las coordenadas van en la descripción.

```
GET /incidencias-extranet/buscar_calle?term=<texto>       → [{"id":294,"value":"C/ Mar"}, ...]
GET /incidencias-extranet/buscar_ubicacion?term=<texto>   → [{"id":614,"value":"Parque - Sur - Plaza Alcalasi"}, ...]
```

- Devuelven JSON (aunque la cabecera dice `text/html`). Si `term` va vacío, devuelven una página de error en HTML.
- Hay unas **594 calles** (C/, Av, Pl, Paratge, Cami, Partida…) y unas **169 ubicaciones** (Parque, Zona, Playa, Edificio Municipal, Colegio…).
- Los nombres están en valenciano o castellano, según la calle ("C/ Sant Joan", "Av  Carrer La Mar", con dos espacios). Nominatim (OSM) devolverá nombres algo distintos, así que **hay que emparejarlos**. El plan: normalizar (quitar tildes, el prefijo de vía y los espacios dobles), comparar por parecido, y que yo confirme la calle en el resumen con un desplegable de candidatas.
- Si no hay ninguna calle buena, se envía el texto. En la descripción siempre van la dirección de Nominatim y las coordenadas.

## 5. Fotos

- En el navegador: solo `jpg` o `png`, sin límite de tamaño.
- En el servidor: **límite desconocido**. Con PHP 5.6 por defecto son `upload_max_filesize=2M` y `post_max_size=8M`.
- **Decisión prudente:** JPEG de lado largo ≤ 1600 px y ≤ ~800 KB por foto, **máximo 3 fotos** (unos 2,4 MB en total).

## 6. Qué devuelve después de enviar (confirmado con el HAR de un envío real, 8 de noviembre de 2026)

Secuencia observada:

```
GET  /incidencias-extranet/nuevo             200  → Set-Cookie laravel_session
GET  /incidencias-extranet/buscar_calle?...  (autocompletado)
POST /incidencias-extranet/crear             302  Location: /incidencias-extranet/creado_con_exito
                                                  (con Cookie laravel_session; la respuesta renueva la cookie)
GET  /incidencias-extranet/creado_con_exito  200  → página de confirmación
```

- **No se devuelve ningún número ni identificador de parte.** La página de confirmación solo dice: *"Incidencia creada correctamente se le notificará cuando sea aceptada por el personal del ayuntamiento en el caso de que usted nos diera sus datos de contacto…"*.
- El mensaje es un **flash de sesión**. Si se abre `creado_con_exito` sin sesión, sale la página **sin** el `alert-success` (lo he comprobado). Por eso:
  - **Criterio de éxito:** el `POST` devuelve `302` a `/creado_con_exito`, **y** el `GET` siguiente, con la cookie renovada, contiene `alert alert-success` e "Incidencia creada correctamente".
  - Cualquier otra cosa (200 con el formulario y `has-error`, un 302 a `/nuevo`, un timeout…) se marca como **error** o **en duda**, sin reintentar.
- **El justificante será nuestro**: hora del servidor (cabecera `Date` de la respuesta al POST), el HTML de confirmación, y el texto y las fotos tal como se enviaron. Le pondremos un ID propio (`EC-AAAAMMDD-xxxx`). Si el Ayuntamiento manda un email al notificar, el número real llegará por ahí; en el historial habrá un campo para apuntarlo a mano.
- **Codificación:** las páginas dicen `charset=UTF-8`, pero los acentos de la plantilla llegan en Latin-1 (salen como "�"). Al analizar el HTML hay que decodificarlo como `windows-1252` y comparar sin tildes.
- El cuerpo del POST no viene en el HAR (Chrome no guarda los multipart con ficheros). El `Content-Length` fue de unos 580 KB. Los nombres de los campos son los de la tabla de la sección 3.
- La validación del servidor sigue sin confirmarse (qué campos son obligatorios y cómo son los errores). Los errores salen en la misma página con la clase `has-error`; el Worker tratará esa respuesta como error y la mostrará tal cual.

## 7. Arquitectura propuesta: Cloudflare

**¿Se puede enviar desde el propio navegador?** En teoría sí, por el `Access-Control-Allow-Origin: *`. En la práctica, no conviene: el `fetch` entre dominios no puede llevar la cookie de sesión ni seguir la redirección para leer el mensaje de confirmación. → **Un Worker de Cloudflare hace de intermediario.** No necesita navegador sin cabeza (headless).

```
Móvil (PWA en Cloudflare Pages/Workers Assets)
  ├─ datos personales  → localStorage cifrado (AES-GCM, clave no exportable en IndexedDB)
  ├─ historial + fotos → IndexedDB (sirve sin conexión)
  └─ POST /api/enviar  → Worker
                           1. GET /nuevo          (consigue laravel_session)
                           2. POST /crear         (multipart idéntico, redirect: manual)
                           3. GET a la redirección con la cookie → HTML de confirmación
                           4. comprueba el 302 + alert-success y devuelve el HTML de confirmación al móvil
     GET /api/calles?term= → Worker → buscar_calle (con caché)
```

**App pública (decidido el 8 de noviembre de 2026): cualquiera puede usarla, sin login ni Cloudflare Access.**

- **Datos personales:** cada persona los rellena **una vez** y se guardan **en su móvil**, cifrados (AES-GCM con una clave no exportable que genera el navegador; sin PIN, decidido el 8 de noviembre de 2026). El servidor **no guarda datos personales de nadie**: los recibe al enviar, los reenvía al Ayuntamiento y los olvida. No se escriben en los logs.
- **Historial, fotos y justificantes:** solo en el móvil (IndexedDB), sin cuentas. Exportar a CSV y PDF se hace en el navegador. Así no hay base de datos de usuarios que proteger. Si alguien quiere copia de seguridad, puede exportarla él mismo.
- **Protección contra abuso** (sin Access, el Worker sería un intermediario abierto hacia el Ayuntamiento):
  - **Cloudflare Turnstile** en *nuestra* app antes de cada envío. Protege nuestro servidor, no el del Ayuntamiento (que no tiene CAPTCHA). Es casi siempre invisible.
  - **Límites** con Durable Object: por IP y por dispositivo, máximo **10 partes al día** y **1 cada 2 minutos**; además un **tope global** de 100 al día para no saturar al Ayuntamiento. Se configuran en `wrangler.jsonc`.
  - El Worker solo habla con `intranet.elcampello.es` (las URLs están fijas en el código) y solo acepta el formato de nuestro parte: descripción de 50 a 2000 caracteres, ≤ 3 imágenes JPEG que se vuelven a comprobar en el servidor, y el honeypot siempre vacío.
- **Antiduplicado:** nunca se reintenta solo. Cada parte lleva una `idempotency key`, y el Worker recuerda durante 24 h las claves ya enviadas (solo un hash, sin datos personales). Si el envío queda en duda (timeout), se marca **"¿enviado?"** y el usuario decide.
- **Transparencia:** antes de enviar se muestran las condiciones legales del Ayuntamiento (se envía `aceptar_terminos=on` en nombre del usuario) y un aviso claro: "Esta app no es oficial; envía tu aviso al formulario público del Ayuntamiento con tus datos".
- **Sin modo prueba en la app** (quitado el 8 de noviembre de 2026). Las pruebas se hacen contra `scripts/simulador-ayto.mjs`, y `ENVIO_REAL=0` actúa como interruptor general.
- **Sin cobertura:** el parte se queda "pendiente" en IndexedDB y, al volver la conexión, la app pregunta si se envía.
- **Nominatim:** desde el Worker, con un User-Agent propio que identifique la app y un contacto, caché agresiva (por coordenadas redondeadas) y una cola **global** de 1 petición por segundo (Durable Object). Si se usa mucho, habrá que pasar a otro proveedor: la política de Nominatim no permite un uso intensivo. Mientras tanto, el emparejamiento con el catálogo municipal de calles va primero.
- **Precio:** el plan gratuito de Workers, KV, Durable Objects y Turnstile alcanza para un uso moderado.

## 8. Riesgos y cosas a vigilar

- La aplicación del Ayuntamiento es antigua (PHP 5.6). Puede cambiar o caerse sin aviso. El mapeo de campos irá en un solo fichero (`form-map.ts`) para tocarlo fácil.
- Puede que su servidor bloquee o trate distinto las IPs de Cloudflare. Comprobado el 8 de noviembre de 2026: las peticiones desde Cloudflare reciben respuesta normal.
- El honeypot obliga a no "rellenarlo todo" a ciegas.
- **Al ser pública**, todos los partes llegarán desde IPs de Cloudflare. Si el Ayuntamiento ve un patrón raro, puede bloquearlas. Conviene avisarles por cortesía de que la app existe y mantener los límites bajos.
- Responsabilidad: los avisos falsos o malintencionados saldrían con los datos que ponga cada usuario, pero a través de nuestra infraestructura. Turnstile y los límites lo mitigan; no lo eliminan.

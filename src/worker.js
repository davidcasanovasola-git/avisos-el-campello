import { urlsDe, USER_AGENT, FOTOS, DESCRIPCION, construirFormulario, esConfirmacion, erroresValidacion } from "./form-map.js";
export { Limiter } from "./limiter.js";

// Término municipal de El Campello (con margen). Fuera de aquí no geocodificamos.
const BBOX = { latMin: 38.38, latMax: 38.53, lonMin: -0.5, lonMax: -0.3 };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/config" && request.method === "GET") return config(env);
      if (url.pathname === "/api/geocodificar" && request.method === "GET") return geocodificar(url, env, ctx);
      if (url.pathname === "/api/enviar" && request.method === "POST") return await enviar(request, env);
      if (url.pathname.startsWith("/api/")) return json({ error: "No encontrado" }, 404);
      return env.ASSETS.fetch(request);
    } catch (e) {
      console.error("Error no controlado", e?.stack || e);
      return json({ error: "Error interno del servidor" }, 500);
    }
  },
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });
}

function limiter(env) {
  return env.LIMITER.get(env.LIMITER.idFromName("global"));
}

function config(env) {
  return json({
    envioReal: env.ENVIO_REAL === "1",
    turnstileSitekey: env.TURNSTILE_SITEKEY || null,
    limites: {
      porDia: Math.min(Number(env.LIMITE_DIA_IP ?? 10), Number(env.LIMITE_DIA_DISPOSITIVO ?? 10)),
      segundosEntreEnvios: Number(env.SEGUNDOS_ENTRE_ENVIOS ?? 120),
    },
    fotos: { max: FOTOS.max, maxBytes: FOTOS.maxBytes },
    descripcion: DESCRIPCION,
  });
}

// ── Geocodificación inversa (Nominatim) ──────────────────────────────────────
async function geocodificar(url, env, ctx) {
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json({ error: "Coordenadas no válidas" }, 400);
  if (lat < BBOX.latMin || lat > BBOX.latMax || lon < BBOX.lonMin || lon > BBOX.lonMax) {
    return json({ fueraDeTermino: true });
  }
  // Redondeo a ~1 m: mejora la caché sin perder precisión útil.
  const la = lat.toFixed(5), lo = lon.toFixed(5);
  const params = new URLSearchParams({ format: "jsonv2", lat: la, lon: lo, zoom: "18", addressdetails: "1", "accept-language": "es" });
  if (env.CONTACT_EMAIL) params.set("email", env.CONTACT_EMAIL);
  const destino = `https://nominatim.openstreetmap.org/reverse?${params}`;
  const cache = caches.default;
  const clave = new Request(`https://cache.local/nominatim/${la},${lo}`);
  const enCache = await cache.match(clave);
  if (enCache) return enCache;

  const ua = `${USER_AGENT}${env.CONTACT_EMAIL ? ` contacto: ${env.CONTACT_EMAIL}` : ""}`;
  const { status, body } = await limiter(env).nominatim(destino, ua);
  if (status !== 200) return json({ error: "No se pudo obtener la dirección" }, 502);
  const d = JSON.parse(body);
  const a = d.address || {};
  const salida = {
    calle: a.road || a.pedestrian || a.footway || a.path || a.square || a.residential || "",
    numero: a.house_number || "",
    barrio: a.suburb || a.neighbourhood || a.quarter || "",
    municipio: a.town || a.city || a.village || a.municipality || "",
    cp: a.postcode || "",
    direccion: d.display_name || "",
  };
  const r = json(salida, 200, { "Cache-Control": "public, max-age=2592000" });
  ctx.waitUntil(cache.put(clave, r.clone()));
  return r;
}

// ── Envío del parte ──────────────────────────────────────────────────────────
async function sha256(texto) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function validar(datos) {
  const e = [];
  const s = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const d = {
    nombre: s(datos.nombre, 120),
    email: s(datos.email, 120),
    movil: s(datos.movil, 20),
    notificar: datos.notificar === true,
    calle_texto: s(datos.calle_texto, 150),
    calle_num: s(datos.calle_num, 10),
    descripcion: typeof datos.descripcion === "string" ? datos.descripcion.trim() : "",
  };
  if (d.nombre.length < 2) e.push("Falta el nombre.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) e.push("El email no es válido.");
  if (d.movil && !/^\+?[\d\s]{9,16}$/.test(d.movil)) e.push("El teléfono no es válido.");
  if (d.descripcion.length < DESCRIPCION.min) e.push(`La descripción debe tener al menos ${DESCRIPCION.min} caracteres.`);
  if (d.descripcion.length > DESCRIPCION.max) e.push(`La descripción no puede pasar de ${DESCRIPCION.max} caracteres.`);
  return { d, e };
}

async function validarFotos(fotos) {
  if (fotos.length > FOTOS.max) return `Como máximo ${FOTOS.max} fotos.`;
  for (const f of fotos) {
    if (typeof f === "string") return "Foto no válida.";
    if (f.size > FOTOS.maxBytes) return "Alguna foto es demasiado grande.";
    const cab = new Uint8Array(await f.slice(0, 3).arrayBuffer());
    if (cab[0] !== 0xff || cab[1] !== 0xd8 || cab[2] !== 0xff) return "Las fotos deben ser JPEG.";
  }
  return null;
}

async function verificarTurnstile(token, ip, env) {
  if (!env.TURNSTILE_SECRET) return { ok: false, motivo: "Turnstile no está configurado en el servidor." };
  if (!token) return { ok: false, motivo: "Falta la verificación anti-bots." };
  const body = new FormData();
  body.append("secret", env.TURNSTILE_SECRET);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const d = await r.json();
  return d.success ? { ok: true } : { ok: false, motivo: "La verificación anti-bots ha fallado. Vuelve a intentarlo." };
}

function cookieSesion(resp) {
  for (const c of resp.headers.getSetCookie?.() ?? []) {
    const m = c.match(/^(laravel_session=[^;]+)/);
    if (m) return m[1];
  }
  return null;
}

function aBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** El HTML del Ayuntamiento mezcla codificaciones; para buscar textos ASCII basta con latin1. */
function comoLatin1(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return s;
}

const MENSAJES_LIMITE = {
  duplicado: "Este parte ya se envió (o se intentó enviar). No se reenvía para no duplicarlo.",
  limite_diario: "Has llegado al máximo de partes por hoy. Vuelve a intentarlo mañana.",
  limite_global: "La app ha llegado a su máximo diario de envíos. Inténtalo mañana o usa el formulario oficial.",
  espera: "Espera un poco antes de enviar otro parte.",
};

async function enviar(request, env) {
  const URLS = urlsDe(env.AYTO_BASE || undefined);
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Petición no válida" }, 400);
  }
  const clave = String(form.get("clave") || "");
  const dispositivo = String(form.get("dispositivo") || "");
  if (!/^[0-9a-f-]{36}$/i.test(clave) || !/^[0-9a-f-]{36}$/i.test(dispositivo)) return json({ error: "Identificadores no válidos" }, 400);

  let datos;
  try {
    datos = JSON.parse(String(form.get("datos") || "{}"));
  } catch {
    return json({ error: "Datos no válidos" }, 400);
  }
  const { d, e } = validar(datos);
  const fotos = form.getAll("fotos");
  const errorFotos = await validarFotos(fotos);
  if (errorFotos) e.push(errorFotos);
  if (e.length) return json({ estado: "rechazado", errores: e }, 422);

  if (env.ENVIO_REAL !== "1") {
    return json({ estado: "rechazado", errores: ["Los envíos están desactivados temporalmente (ENVIO_REAL=0)."] }, 403);
  }
  const t = await verificarTurnstile(String(form.get("turnstile") || ""), ip, env);
  if (!t.ok) return json({ estado: "rechazado", errores: [t.motivo] }, 403);

  const ipHash = (await sha256(`${ip}|${new Date().toISOString().slice(0, 10)}|avisos`)).slice(0, 32);
  const lim = limiter(env);
  const reserva = await lim.reservar({ ipHash, dispositivo, clave });
  if (!reserva.ok) {
    let msg = MENSAJES_LIMITE[reserva.motivo] || "Límite alcanzado.";
    if (reserva.motivo === "espera") msg = `Espera ${reserva.segundos} s antes de enviar otro parte.`;
    return json({ estado: "rechazado", motivo: reserva.motivo, errores: [msg], previo: reserva.previo ?? null }, 429);
  }

  const multipart = construirFormulario(d, fotos);
  const cabeceras = { "User-Agent": USER_AGENT, "Accept-Language": "es-ES,es;q=0.9" };

  // 1) Abrir el formulario para obtener la cookie de sesión (igual que un navegador).
  let cookie;
  try {
    const r1 = await fetch(URLS.formulario, { headers: cabeceras, signal: AbortSignal.timeout(15000) });
    cookie = cookieSesion(r1);
    await r1.arrayBuffer();
    if (!r1.ok || !cookie) throw new Error(`HTTP ${r1.status}, cookie ${cookie ? "sí" : "no"}`);
  } catch (err) {
    // Aún no se ha enviado nada: es seguro marcarlo como error.
    await lim.finalizar(clave, { estado: "error" });
    return json({ estado: "error", errores: [`No se pudo abrir el formulario del Ayuntamiento (${err.message}).`] }, 502);
  }

  // 2) Enviar. A partir de aquí, ante cualquier duda NO se reintenta.
  let r2;
  try {
    r2 = await fetch(URLS.envio, {
      method: "POST",
      body: multipart,
      redirect: "manual",
      headers: { ...cabeceras, Cookie: cookie, Origin: URLS.origen, Referer: URLS.formulario },
      signal: AbortSignal.timeout(45000),
    });
  } catch (err) {
    await lim.finalizar(clave, { estado: "duda" });
    return json({ estado: "duda", errores: [`No hubo respuesta clara del Ayuntamiento (${err.message}). Puede que el parte se haya creado: no lo reenvíes sin comprobarlo.`] }, 504);
  }
  const fechaServidor = r2.headers.get("Date");
  const destino = r2.headers.get("Location") || "";
  const cookie2 = cookieSesion(r2) || cookie;
  const cuerpo2 = new Uint8Array(await r2.arrayBuffer());

  if (r2.status === 200) {
    const errores = erroresValidacion(comoLatin1(cuerpo2));
    if (errores) {
      await lim.finalizar(clave, { estado: "error" });
      return json({ estado: "error", errores, justificanteHtml: aBase64(cuerpo2) }, 422);
    }
  }
  if (!(r2.status >= 300 && r2.status < 400 && destino.includes("creado_con_exito"))) {
    await lim.finalizar(clave, { estado: "duda" });
    return json({ estado: "duda", errores: [`Respuesta inesperada del Ayuntamiento (HTTP ${r2.status}${destino ? ` → ${destino}` : ""}). No lo reenvíes sin comprobarlo.`], fechaServidor, justificanteHtml: aBase64(cuerpo2) }, 502);
  }

  // 3) Leer la confirmación con la misma sesión (el mensaje de éxito es un flash de sesión).
  let html = null, confirmado = false;
  try {
    const r3 = await fetch(new URL(destino, URLS.envio), { headers: { ...cabeceras, Cookie: cookie2, Referer: URLS.formulario }, signal: AbortSignal.timeout(15000) });
    const b3 = new Uint8Array(await r3.arrayBuffer());
    html = aBase64(b3);
    confirmado = esConfirmacion(comoLatin1(b3));
  } catch (err) {
    console.warn("No se pudo leer la confirmación", err.message);
  }
  await lim.finalizar(clave, { estado: "enviado", confirmado, fechaServidor });
  return json({
    estado: "enviado",
    confirmado,
    mensaje: confirmado
      ? "Incidencia creada correctamente en el Ayuntamiento."
      : "El Ayuntamiento aceptó el envío (redirigió a la página de éxito), pero no se pudo leer el mensaje de confirmación.",
    fechaServidor,
    justificanteHtml: html,
  });
}

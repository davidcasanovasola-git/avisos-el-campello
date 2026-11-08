import * as cripto from "./js/cripto.js";
import * as db from "./js/db.js";
import { leerExif, comprimir, miniatura } from "./js/imagen.js";
import { TIPOS, tipoPorId, proponerTexto, descripcionFinal } from "./js/textos.js";
import { generarPDF } from "./js/pdf.js";

const $ = (s) => document.querySelector(s);
const CENTRO = { lat: 38.4286, lon: -0.3976 }; // El Campello
const GPS_PRECISION_OK = 15; // m
const GPS_ESPERA_MAX = 20_000; // ms
const MAX_FOTOS = 3;

const E = {
  config: null,
  datos: null, // datos personales descifrados (solo en memoria)
  parte: null,
  mapa: null, marcador: null, circulo: null,
  gps: { watch: null, timer: null, tick: null, mejor: null, inicio: 0, fin: false, error: null },
  turnstile: { id: null, token: null, cargado: null },
  editandoDatos: false,
  detalleId: null,
};

// ── utilidades ───────────────────────────────────────────────────────────────
const ls = {
  get(k, def = null) { try { return localStorage.getItem(k) ?? def; } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
function dispositivo() {
  let id = ls.get("avisos.dispositivo");
  if (!id) { id = crypto.randomUUID(); ls.set("avisos.dispositivo", id); }
  return id;
}
const fecha = (t) => new Date(t).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
function nuevaRef() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const az = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
  return `EC-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${az}`;
}
function nuevoParte() {
  return {
    id: crypto.randomUUID(), clave: crypto.randomUUID(), ref: nuevaRef(), creado: Date.now(), estado: "borrador",
    fotos: [], gps: null, pin: null, movido: false, direccion: null, calleTexto: "", calleEditada: false, numero: "", numeroEditado: false,
    tipo: null, detalle: "", texto: "", textoEditado: false, notificar: undefined,
    notas: "", numeroOficial: "", arreglado: false,
  };
}
const guardarParte = () => E.parte && db.guardar(E.parte);

function dialogo(texto, { si = "Aceptar", no = "Cancelar" } = {}) {
  const d = $("#dialogo");
  $("#dialogo-texto").textContent = texto;
  $("#dialogo-si").textContent = si;
  d.querySelector("button[value=no]").textContent = no;
  d.querySelector("button[value=no]").hidden = !no;
  d.returnValue = "";
  d.showModal();
  return new Promise((ok) => d.addEventListener("close", () => ok(d.returnValue === "si"), { once: true }));
}

/** Nombre completo (los datos antiguos tenían nombre y apellidos por separado). */
const nombreCompleto = (d) => [d?.nombre, d?.apellidos].filter(Boolean).join(" ").trim();

// ── navegación ───────────────────────────────────────────────────────────────
const TITULOS = {
  bienvenida: "Avisos El Campello", inicio: "Avisos El Campello", fotos: "1 · Fotos", ubicacion: "2 · Ubicación",
  tipo: "3 · Qué pasa", resumen: "4 · Revisar y enviar", resultado: "Resultado", historial: "Mis avisos",
  detalle: "Aviso", ajustes: "Ajustes",
};
const AL_ENTRAR = {};
let pila = [];

function mostrar(nombre) {
  document.querySelectorAll("section[data-pantalla]").forEach((s) => (s.hidden = s.dataset.pantalla !== nombre));
  $("#titulo").textContent = TITULOS[nombre] || "";
  $("#btn-atras").hidden = pila.length <= 1;
  window.scrollTo(0, 0);
  AL_ENTRAR[nombre]?.();
}
function ir(nombre, { raiz = false } = {}) {
  if (raiz) { pila = [nombre]; history.replaceState({ n: 1 }, ""); }
  else { pila.push(nombre); history.pushState({ n: pila.length }, ""); }
  mostrar(nombre);
}
window.addEventListener("popstate", () => {
  if (pila.length > 1) {
    pila.pop();
    mostrar(pila[pila.length - 1]);
  } else {
    history.pushState({ n: 1 }, "");
  }
});
$("#btn-atras").addEventListener("click", () => history.back());
document.querySelectorAll("[data-ir]").forEach((b) => b.addEventListener("click", () => ir(b.dataset.ir)));

// ── red ──────────────────────────────────────────────────────────────────────
function estadoRed() {
  $("#aviso-offline").hidden = navigator.onLine;
  if (!$("section[data-pantalla=resumen]").hidden) actualizarBotonEnviar();
}
window.addEventListener("online", () => { estadoRed(); comprobarPendientes(); });
window.addEventListener("offline", estadoRed);

async function comprobarPendientes() {
  const pend = (await db.listar()).filter((p) => p.estado === "pendiente");
  const caja = $("#aviso-pendientes");
  caja.hidden = !pend.length;
  if (pend.length) {
    $("#texto-pendientes").textContent = `Tienes ${pend.length} aviso${pend.length > 1 ? "s" : ""} pendiente${pend.length > 1 ? "s" : ""} de enviar.${navigator.onLine ? "" : " Cuando tengas conexión podrás enviarlo."}`;
  }
}
$("#btn-ver-pendientes").addEventListener("click", () => ir("historial"));

// ── bienvenida / datos personales ────────────────────────────────────────────
AL_ENTRAR.bienvenida = () => {
  const f = $("#form-datos");
  $("#error-datos").textContent = "";
  const editando = E.editandoDatos;
  f.acepto.closest("label").hidden = editando;
  f.acepto.required = !editando;
  if (editando && E.datos) {
    f.nombre.value = nombreCompleto(E.datos);
    f.email.value = E.datos.email || "";
    f.movil.value = E.datos.movil || "";
    f.notificar.checked = E.datos.notificar !== false;
  }
};
$("#form-datos").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const err = $("#error-datos");
  const datos = {
    nombre: f.nombre.value.trim().replace(/\s+/g, " "), email: f.email.value.trim(),
    movil: f.movil.value.trim(), notificar: f.notificar.checked,
  };
  if (!datos.nombre.includes(" ")) return (err.textContent = "Escribe tu nombre y tus apellidos.");
  if (datos.movil && !/^\+?[\d\s]{9,16}$/.test(datos.movil)) return (err.textContent = "El teléfono no parece válido.");
  try {
    await cripto.guardarDatos(datos);
    E.datos = datos;
    E.editandoDatos = false;
    ir("inicio", { raiz: true });
  } catch (e) {
    err.textContent = "No se pudieron guardar los datos en este navegador.";
  }
});

// ── inicio ───────────────────────────────────────────────────────────────────
AL_ENTRAR.inicio = () => {
  comprobarPendientes();
  $("#nota-modo").textContent = E.config?.envioReal === false
    ? "Los envíos están desactivados temporalmente. Puedes hacer avisos y se guardarán como pendientes."
    : "";
};
$("#btn-nueva").addEventListener("click", () => {
  E.parte = nuevoParte();
  ir("fotos");
  iniciarGPS();
  $("#input-foto").click(); // abre la cámara trasera directamente
});

// ── fotos ────────────────────────────────────────────────────────────────────
AL_ENTRAR.fotos = () => pintarFotos();
$("#btn-foto").addEventListener("click", () => $("#input-foto").click());
$("#btn-galeria").addEventListener("click", () => $("#input-galeria").click());
for (const id of ["#input-foto", "#input-galeria"]) {
  $(id).addEventListener("change", async (ev) => {
    const ficheros = [...ev.target.files].slice(0, MAX_FOTOS - E.parte.fotos.length);
    ev.target.value = "";
    if (!ficheros.length) return;
    $("#nota-fotos").textContent = "Preparando foto…";
    for (const f of ficheros) {
      try {
        const exif = await leerExif(f);
        const blob = await comprimir(f);
        E.parte.fotos.push({ blob, thumb: await miniatura(blob), exif });
      } catch (e) {
        console.error(e);
        await dialogo("No se pudo leer esa imagen. Prueba con otra foto.", { no: null });
      }
    }
    pintarFotos();
    // Si el GPS del móvil no da posición, usamos la de la foto.
    if (!E.parte.pin) {
      const conGps = E.parte.fotos.find((x) => x.exif?.lat != null);
      if (conGps && E.gps.fin && !E.gps.mejor) fijarPin({ lat: conGps.exif.lat, lon: conGps.exif.lon }, { geocodificar: true });
    }
    guardarParte();
  });
}
function pintarFotos() {
  const p = E.parte;
  const cont = $("#miniaturas");
  cont.replaceChildren(
    ...p.fotos.map((f, i) => {
      const d = document.createElement("div");
      d.className = "miniatura";
      d.innerHTML = `<img alt="Foto ${i + 1}"><button aria-label="Quitar foto">✕</button>${f.exif?.lat != null ? '<span class="gps-foto">📍 GPS</span>' : ""}`;
      d.querySelector("img").src = f.thumb;
      d.querySelector("button").onclick = () => { p.fotos.splice(i, 1); pintarFotos(); guardarParte(); };
      return d;
    }),
  );
  const lleno = p.fotos.length >= MAX_FOTOS;
  $("#btn-foto").disabled = $("#btn-galeria").disabled = lleno;
  $("#nota-fotos").textContent = p.fotos.length
    ? lleno ? "Máximo de 3 fotos." : `${p.fotos.length} foto${p.fotos.length > 1 ? "s" : ""}. Puedes añadir más o seguir.`
    : "Haz una foto de la incidencia. Puedes añadir hasta 3.";
  $("#btn-fotos-ok").disabled = !p.fotos.length;
}
$("#btn-fotos-ok").addEventListener("click", () => ir("ubicacion"));

// ── GPS ──────────────────────────────────────────────────────────────────────
function pararGPS() {
  const g = E.gps;
  if (g.watch != null) navigator.geolocation.clearWatch(g.watch);
  clearTimeout(g.timer); clearInterval(g.tick);
  g.watch = g.timer = g.tick = null;
}
function iniciarGPS() {
  pararGPS();
  Object.assign(E.gps, { mejor: null, inicio: Date.now(), fin: false, error: null });
  if (!("geolocation" in navigator)) { E.gps.error = { message: "Este navegador no tiene GPS" }; return finGPS(); }
  E.gps.watch = navigator.geolocation.watchPosition(
    (pos) => {
      const c = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy, t: pos.timestamp };
      if (!E.gps.mejor || c.acc <= E.gps.mejor.acc) E.gps.mejor = c;
      if (!E.parte.movido) fijarPin(E.gps.mejor, { geocodificar: false });
      pintarGPS();
      if (c.acc <= GPS_PRECISION_OK) finGPS();
    },
    (err) => {
      E.gps.error = err;
      if (err.code === err.PERMISSION_DENIED) finGPS();
      pintarGPS();
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: GPS_ESPERA_MAX },
  );
  E.gps.timer = setTimeout(finGPS, GPS_ESPERA_MAX);
  E.gps.tick = setInterval(pintarGPS, 1000);
  pintarGPS();
}
function finGPS() {
  if (E.gps.fin) return;
  pararGPS();
  E.gps.fin = true;
  const p = E.parte;
  if (E.gps.mejor) {
    p.gps = E.gps.mejor;
    if (!p.movido) fijarPin(p.gps, { geocodificar: true });
  } else if (!p.pin) {
    const conGps = p.fotos.find((x) => x.exif?.lat != null);
    if (conGps) fijarPin({ lat: conGps.exif.lat, lon: conGps.exif.lon }, { geocodificar: true });
  }
  pintarGPS();
  guardarParte();
}
function pintarGPS() {
  const g = E.gps, caja = $("#gps-estado");
  let texto, clase = "";
  const seg = Math.max(0, Math.ceil((GPS_ESPERA_MAX - (Date.now() - g.inicio)) / 1000));
  if (E.parte?.movido) { texto = "Posición marcada a mano en el mapa"; clase = "ok"; }
  else if (g.mejor) {
    const acc = Math.round(g.mejor.acc);
    if (g.fin) { texto = `Precisión: ±${acc} m${acc > GPS_PRECISION_OK ? " (si no es exacta, arrastra el pin)" : " ✓"}`; clase = acc <= GPS_PRECISION_OK ? "ok" : ""; }
    else texto = `Precisión: ±${acc} m… afinando (${seg} s)`;
  } else if (g.fin) {
    const foto = E.parte?.fotos.find((x) => x.exif?.lat != null);
    texto = foto ? "Sin GPS del móvil: uso la posición de la foto. Comprueba el pin." : `Sin GPS${g.error ? ` (${g.error.code === 1 ? "permiso denegado" : g.error.message})` : ""}. Pon el pin en el mapa.`;
    clase = foto ? "" : "mal";
  } else texto = `Buscando tu posición… (${seg} s)`;
  caja.className = `gps ${clase}`;
  $("#gps-texto").textContent = texto;
  $("#gps-mini").textContent = g.mejor ? `📍 ±${Math.round(g.mejor.acc)} m${g.fin ? "" : "…"}` : g.fin ? "" : "📍 buscando posición…";
}

// ── mapa y dirección ─────────────────────────────────────────────────────────
function crearMapa() {
  if (E.mapa) return;
  E.mapa = L.map("mapa", { zoomControl: true, attributionControl: true }).setView([CENTRO.lat, CENTRO.lon], 16);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(E.mapa);
  E.marcador = L.marker([CENTRO.lat, CENTRO.lon], { draggable: true, autoPan: true }).addTo(E.mapa);
  E.circulo = L.circle([CENTRO.lat, CENTRO.lon], { radius: 0, weight: 1, fillOpacity: 0.12 }).addTo(E.mapa);
  E.marcador.on("dragend", () => {
    const ll = E.marcador.getLatLng();
    E.parte.movido = true;
    fijarPin({ lat: ll.lat, lon: ll.lng }, { geocodificar: true, centrar: false });
    pintarGPS();
  });
  E.mapa.on("click", (ev) => {
    E.parte.movido = true;
    fijarPin({ lat: ev.latlng.lat, lon: ev.latlng.lng }, { geocodificar: true, centrar: false });
    pintarGPS();
  });
}
function fijarPin(pos, { geocodificar = false, centrar = true } = {}) {
  const p = E.parte;
  p.pin = { lat: pos.lat, lon: pos.lon };
  if (E.mapa) {
    E.marcador.setLatLng([pos.lat, pos.lon]);
    E.circulo.setLatLng([pos.lat, pos.lon]).setRadius(!p.movido && p.gps ? p.gps.acc : !p.movido && pos.acc ? pos.acc : 0);
    if (centrar) E.mapa.setView([pos.lat, pos.lon], 18);
  }
  if (geocodificar) geocodificarPin();
  validarUbicacion();
}
const geocodificarPin = debounce(async () => {
  const p = E.parte;
  if (!p?.pin) return;
  const dir = $("#direccion-osm");
  if (!navigator.onLine) {
    dir.textContent = "Sin conexión: escribe la calle a mano.";
    return;
  }
  dir.textContent = "Buscando la dirección…";
  try {
    const r = await fetch(`/api/geocodificar?lat=${p.pin.lat}&lon=${p.pin.lon}`);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    if (d.fueraDeTermino) {
      p.direccion = null;
      dir.textContent = "⚠️ Este punto está fuera del término de El Campello.";
      return;
    }
    p.direccion = d;
    dir.textContent = d.direccion || "Dirección no encontrada";
    // Lo que devuelve el mapa, salvo que el usuario lo haya cambiado a mano.
    if (!p.calleEditada) { p.calleTexto = d.calle || ""; $("#calle").value = p.calleTexto; }
    if (!p.numeroEditado) { p.numero = d.numero || ""; $("#numero").value = p.numero; }
  } catch (e) {
    dir.textContent = "No se pudo obtener la dirección. Escribe la calle a mano.";
  }
  validarUbicacion();
  guardarParte();
}, 700);

$("#calle").addEventListener("input", (ev) => { E.parte.calleTexto = ev.target.value.trim(); E.parte.calleEditada = true; validarUbicacion(); });
$("#numero").addEventListener("input", (ev) => { E.parte.numero = ev.target.value.trim(); E.parte.numeroEditado = true; });
function validarUbicacion() {
  const p = E.parte;
  if (!p) return;
  $("#btn-ubicacion-ok").disabled = !p.pin;
}
AL_ENTRAR.ubicacion = () => {
  crearMapa();
  setTimeout(() => {
    E.mapa.invalidateSize();
    const p = E.parte;
    if (p.pin) fijarPin(p.pin, { geocodificar: !p.direccion && E.gps.fin });
    else E.mapa.setView([CENTRO.lat, CENTRO.lon], 15);
  }, 60);
  $("#calle").value = E.parte.calleTexto || "";
  $("#numero").value = E.parte.numero || "";
  pintarGPS();
  validarUbicacion();
};
$("#btn-ubicacion-ok").addEventListener("click", () => {
  if (!E.gps.fin) finGPS(); // el usuario ya está conforme con la posición
  ir("tipo");
});

// ── tipo y texto ─────────────────────────────────────────────────────────────
function calleLegible(p) { return p.calleTexto || p.calle?.value || p.direccion?.calle || ""; }
function regenerarTexto() {
  const p = E.parte;
  if (!p.textoEditado) {
    p.texto = proponerTexto({ tipo: p.tipo, detalle: p.detalle, calle: calleLegible(p), numero: p.numero });
    $("#texto").value = p.texto;
  }
  const n = descripcionFinal(p).length;
  $("#contador").textContent = `${n} caracteres en total (incluida la ubicación). Mínimo 50.`;
  $("#btn-tipo-ok").disabled = !p.tipo || n < 50 || !p.texto.trim();
}
AL_ENTRAR.tipo = () => {
  const cont = $("#tipos");
  cont.replaceChildren(...TIPOS.map((t) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "tipo";
    b.setAttribute("aria-pressed", String(E.parte.tipo === t.id));
    b.innerHTML = `<span class="ic"></span><span></span>`;
    b.children[0].textContent = t.icono; b.children[1].textContent = t.etiqueta;
    b.onclick = () => {
      E.parte.tipo = t.id;
      cont.querySelectorAll(".tipo").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      regenerarTexto(); guardarParte();
    };
    return b;
  }));
  $("#detalle").value = E.parte.detalle;
  $("#texto").value = E.parte.texto;
  $("#btn-reproponer").hidden = !E.parte.textoEditado;
  regenerarTexto();
};
$("#detalle").addEventListener("input", (ev) => { E.parte.detalle = ev.target.value; regenerarTexto(); });
$("#texto").addEventListener("input", (ev) => { E.parte.texto = ev.target.value; E.parte.textoEditado = true; $("#btn-reproponer").hidden = false; regenerarTexto(); });
$("#btn-reproponer").addEventListener("click", () => { E.parte.textoEditado = false; $("#btn-reproponer").hidden = true; regenerarTexto(); });
$("#btn-tipo-ok").addEventListener("click", () => { guardarParte(); ir("resumen"); });

// ── resumen y envío ──────────────────────────────────────────────────────────
AL_ENTRAR.resumen = () => {
  const p = E.parte;
  $("#res-fotos").replaceChildren(...p.fotos.map((f) => {
    const d = document.createElement("div"); d.className = "miniatura";
    const i = document.createElement("img"); i.src = f.thumb; i.alt = "Foto"; d.append(i); return d;
  }));
  $("#res-tipo").textContent = tipoPorId(p.tipo)?.etiqueta || "";
  $("#res-calle").textContent = `📍 ${[calleLegible(p), p.numero].filter(Boolean).join(", ") || "Sin calle (van las coordenadas)"}`;
  $("#res-texto").textContent = descripcionFinal(p);
  $("#error-envio").textContent = "";
  pintarRemitente();
  prepararTurnstile();
  actualizarBotonEnviar();
};
function pintarRemitente() {
  const d = E.datos, p = E.parte;
  if (!d) { $("#res-datos").textContent = "Faltan tus datos: complétalos en Ajustes."; return; }
  $("#res-datos").textContent = `${nombreCompleto(d)} · ${d.email}${d.movil ? ` · ${d.movil}` : ""}`;
  if (p.notificar === undefined) p.notificar = d.notificar !== false;
  $("#res-notificar").checked = p.notificar;
}
$("#res-notificar").addEventListener("change", (ev) => { E.parte.notificar = ev.target.checked; });

function actualizarBotonEnviar() {
  const b = $("#btn-enviar");
  const necesitaTs = !!E.config?.turnstileSitekey;
  if (!navigator.onLine) { b.textContent = "Sin conexión"; b.disabled = true; return; }
  if (E.config?.envioReal === false) { b.textContent = "Envíos desactivados"; b.disabled = true; return; }
  b.textContent = "Enviar";
  b.disabled = !E.datos || (necesitaTs && !E.turnstile.token) || E.enviando;
}

function cargarTurnstile() {
  E.turnstile.cargado ??= new Promise((ok, ko) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true; s.onload = ok; s.onerror = ko;
    document.head.append(s);
  });
  return E.turnstile.cargado;
}
async function prepararTurnstile() {
  const cont = $("#turnstile");
  if (!E.config?.envioReal || !E.config?.turnstileSitekey || !navigator.onLine) { cont.hidden = true; return; }
  cont.hidden = false;
  try {
    await cargarTurnstile();
    if (E.turnstile.id != null) { window.turnstile.reset(E.turnstile.id); E.turnstile.token = null; actualizarBotonEnviar(); return; }
    E.turnstile.id = window.turnstile.render(cont, {
      sitekey: E.config.turnstileSitekey, language: "es", appearance: "interaction-only",
      callback: (t) => { E.turnstile.token = t; actualizarBotonEnviar(); },
      "expired-callback": () => { E.turnstile.token = null; actualizarBotonEnviar(); },
      "error-callback": () => { E.turnstile.token = null; actualizarBotonEnviar(); },
    });
  } catch {
    $("#error-envio").textContent = "No se pudo cargar la verificación anti-bots. Revisa la conexión.";
  }
}

$("#btn-guardar-pendiente").addEventListener("click", async () => {
  const p = E.parte;
  if (!["enviado", "duda"].includes(p.estado)) p.estado = "pendiente";
  await guardarParte();
  ir("inicio", { raiz: true });
});

$("#btn-enviar").addEventListener("click", enviar);
async function enviar() {
  const p = E.parte, d = E.datos;
  if (!d || E.enviando) return;
  E.enviando = true;
  actualizarBotonEnviar();
  $("#btn-enviar").textContent = "Enviando…";
  $("#error-envio").textContent = "";
  p.descripcionEnviada = descripcionFinal(p);
  const anterior = p.estado;
  p.estado = "enviando";
  await guardarParte();

  const fd = new FormData();
  fd.append("clave", p.clave);
  fd.append("dispositivo", dispositivo());
  fd.append("turnstile", E.turnstile.token || "");
  fd.append("datos", JSON.stringify({
    nombre: nombreCompleto(d), email: d.email, movil: d.movil || "", notificar: !!p.notificar,
    calle_texto: calleLegible(p), calle_num: p.numero || "",
    descripcion: p.descripcionEnviada,
  }));
  p.fotos.forEach((f, i) => fd.append("fotos", f.blob, `foto${i + 1}.jpg`));

  let r = null, j = null;
  try {
    r = await fetch("/api/enviar", { method: "POST", body: fd });
    j = await r.json();
  } catch {
    j = null;
  }
  E.enviando = false;
  if (E.turnstile.id != null) { try { window.turnstile.reset(E.turnstile.id); } catch {} E.turnstile.token = null; }

  if (!j) {
    p.estado = "duda";
    p.errores = ["Se perdió la conexión con nuestro servidor durante el envío. Puede que el aviso se haya enviado."];
  } else if (j.estado === "enviado") {
    Object.assign(p, { estado: "enviado", enviado: Date.now(), fechaServidor: j.fechaServidor, confirmacion: j.mensaje, confirmado: j.confirmado, justificanteHtml: j.justificanteHtml, errores: null });
  } else if (j.estado === "duda") {
    Object.assign(p, { estado: "duda", fechaServidor: j.fechaServidor, justificanteHtml: j.justificanteHtml, errores: j.errores });
  } else if (j.estado === "error") {
    Object.assign(p, { estado: "error", justificanteHtml: j.justificanteHtml, errores: j.errores });
  } else if (j.estado === "rechazado") {
    if (j.motivo === "duplicado") {
      p.estado = j.previo?.estado === "enviado" ? "enviado" : "duda";
      p.errores = j.errores;
    } else {
      // No ha salido nada hacia el Ayuntamiento: se puede volver a intentar.
      p.estado = ["prueba", "borrador", "enviando"].includes(anterior) ? "pendiente" : anterior;
      $("#error-envio").textContent = (j.errores || ["No se pudo enviar."]).join(" ");
      await guardarParte();
      actualizarBotonEnviar();
      prepararTurnstile();
      return;
    }
  }
  await guardarParte();
  ir("resultado");
}

// ── resultado ────────────────────────────────────────────────────────────────
const RESULTADOS = {
  enviado: ["✅", "Aviso enviado", "El Ayuntamiento ha registrado tu aviso. No dan número de parte: guarda el justificante."],
  duda: ["⚠️", "Envío sin confirmar", "No sabemos seguro si se ha creado. No lo reenvíes hasta comprobarlo: si te llega un email del Ayuntamiento, se envió."],
  error: ["❌", "No se ha enviado", "El Ayuntamiento ha rechazado el aviso. Revisa los errores y vuelve a intentarlo desde Mis avisos."],
};
AL_ENTRAR.resultado = () => {
  const p = E.parte;
  const [ic, tit, txt] = RESULTADOS[p.estado] || ["ℹ️", p.estado, ""];
  $("#resultado-icono").textContent = ic;
  $("#resultado-titulo").textContent = tit;
  $("#resultado-texto").textContent = p.estado === "enviado" && p.confirmacion ? `${p.confirmacion} ${txt}` : txt;
  $("#resultado-errores").replaceChildren(...(p.errores || []).map((e) => Object.assign(document.createElement("li"), { textContent: e })));
};
$("#btn-res-pdf").addEventListener("click", () => generarPDF(E.parte, E.datos));
$("#btn-res-inicio").addEventListener("click", () => ir("inicio", { raiz: true }));

// ── historial ────────────────────────────────────────────────────────────────
const ETIQUETA_ESTADO = { enviado: "Enviado", prueba: "Prueba", pendiente: "Pendiente", duda: "Sin confirmar", error: "Error", borrador: "Borrador", enviando: "Enviando" };
AL_ENTRAR.historial = async () => {
  const lista = await db.listar();
  $("#lista-vacia").hidden = lista.length > 0;
  $("#btn-csv").disabled = !lista.length;
  $("#lista").replaceChildren(...lista.map((p) => {
    const li = document.createElement("li");
    li.innerHTML = `<button><img alt=""><div class="info"><strong></strong><span class="c"></span><span><span class="estado"></span> <span class="f"></span></span></div></button>`;
    li.querySelector("img").src = p.fotos?.[0]?.thumb || "/icons/icon.svg";
    li.querySelector("strong").textContent = tipoPorId(p.tipo)?.etiqueta || "Sin tipo";
    li.querySelector(".c").textContent = [calleLegible(p), p.numero].filter(Boolean).join(", ") || "Sin ubicación";
    const e = li.querySelector(".estado");
    e.className = `estado ${p.estado}`;
    e.textContent = (p.arreglado ? "✔ Arreglado · " : "") + (ETIQUETA_ESTADO[p.estado] || p.estado);
    li.querySelector(".f").textContent = fecha(p.enviado || p.creado);
    li.querySelector("button").onclick = () => { E.detalleId = p.id; ir("detalle"); };
    return li;
  }));
};
$("#btn-csv").addEventListener("click", async () => {
  const lista = await db.listar();
  const cols = ["ref", "creado", "enviado", "estado", "tipo", "calle", "numero", "lat", "lon", "direccion_osm", "descripcion", "numero_oficial", "arreglado", "notas"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const filas = lista.map((p) => [
    p.ref, new Date(p.creado).toISOString(), p.enviado ? new Date(p.enviado).toISOString() : "", p.estado,
    tipoPorId(p.tipo)?.etiqueta, calleLegible(p), p.numero, p.pin?.lat?.toFixed(6), p.pin?.lon?.toFixed(6),
    p.direccion?.direccion, p.descripcionEnviada || (p.pin ? descripcionFinal(p) : p.texto), p.numeroOficial, p.arreglado ? "sí" : "no", p.notas,
  ].map(esc).join(";"));
  const csv = "﻿" + [cols.join(";"), ...filas].join("\r\n");
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })), download: `avisos-el-campello-${new Date().toISOString().slice(0, 10)}.csv` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});

// ── detalle ──────────────────────────────────────────────────────────────────
let detalle = null;
AL_ENTRAR.detalle = async () => {
  detalle = await db.obtener(E.detalleId);
  if (!detalle) return history.back();
  const p = detalle;
  $("#det-fotos").replaceChildren(...(p.fotos || []).map((f) => {
    const d = document.createElement("div"); d.className = "miniatura";
    const i = document.createElement("img"); i.src = f.thumb; i.alt = "Foto"; d.append(i); return d;
  }));
  const e = $("#det-estado");
  e.className = `estado ${p.estado}`; e.textContent = ETIQUETA_ESTADO[p.estado] || p.estado;
  $("#det-ref").textContent = p.ref;
  $("#det-tipo").textContent = tipoPorId(p.tipo)?.etiqueta || "Sin tipo";
  $("#det-calle").textContent = [calleLegible(p), p.numero].filter(Boolean).join(", ");
  $("#det-fechas").textContent = `Creado ${fecha(p.creado)}${p.enviado ? ` · Enviado ${fecha(p.enviado)}` : ""}${p.errores?.length ? `\n${p.errores.join(" ")}` : ""}`;
  $("#det-texto").textContent = p.descripcionEnviada || (p.pin ? descripcionFinal(p) : p.texto || "");
  $("#det-numero").value = p.numeroOficial || "";
  $("#det-arreglado").checked = !!p.arreglado;
  $("#det-notas").value = p.notas || "";
  $("#btn-det-enviar").hidden = !["borrador", "pendiente", "error", "prueba", "duda"].includes(p.estado);
  $("#btn-det-enviar").textContent = p.estado === "borrador" ? "Continuar" : p.estado === "duda" ? "Comprobar / reenviar" : "Revisar y enviar";
  $("#btn-det-html").hidden = !p.justificanteHtml;
};
$("#btn-det-guardar").addEventListener("click", async () => {
  Object.assign(detalle, { numeroOficial: $("#det-numero").value.trim(), arreglado: $("#det-arreglado").checked, notas: $("#det-notas").value });
  await db.guardar(detalle);
  $("#btn-det-guardar").textContent = "Guardado ✓";
  setTimeout(() => ($("#btn-det-guardar").textContent = "Guardar notas"), 1500);
});
$("#btn-det-enviar").addEventListener("click", async () => {
  const p = detalle;
  if (p.estado === "duda") {
    const ok = await dialogo("Este aviso puede haberse enviado ya.\n\nSi lo vuelves a enviar, el servidor comprobará si ya lo recibió (durante 48 h) y no lo duplicará. Pasado ese plazo, sí podría duplicarse.\n\n¿Continuar?", { si: "Continuar" });
    if (!ok) return;
  }
  E.parte = p;
  E.gps.fin = true;
  if (!p.fotos?.length) ir("fotos");
  else if (!p.pin) ir("ubicacion");
  else if (!p.tipo) ir("tipo");
  else ir("resumen");
});
$("#btn-det-pdf").addEventListener("click", () => generarPDF(detalle, E.datos));
$("#btn-det-html").addEventListener("click", () => {
  // Respuesta del Ayuntamiento en un iframe aislado (sin scripts).
  const bytes = Uint8Array.from(atob(detalle.justificanteHtml), (c) => c.charCodeAt(0));
  const html = new TextDecoder("windows-1252").decode(bytes);
  const d = document.createElement("dialog");
  d.innerHTML = `<iframe sandbox style="width:min(86vw,560px);height:60vh;border:0;background:#fff"></iframe><form method="dialog"><button class="btn" style="width:100%">Cerrar</button></form>`;
  d.querySelector("iframe").srcdoc = html;
  d.addEventListener("close", () => d.remove());
  document.body.append(d);
  d.showModal();
});
$("#btn-det-borrar").addEventListener("click", async () => {
  const aviso = detalle.estado === "enviado" ? "\n\nEsto solo lo borra de este móvil; en el Ayuntamiento sigue registrado." : "";
  if (!(await dialogo(`¿Borrar este aviso de tu historial?${aviso}`, { si: "Borrar" }))) return;
  await db.borrar(detalle.id);
  history.back();
});

// ── ajustes ──────────────────────────────────────────────────────────────────
$("#btn-aj-editar").addEventListener("click", () => {
  E.editandoDatos = !!E.datos;
  ir("bienvenida");
});
$("#btn-aj-borrar").addEventListener("click", async () => {
  if (!(await dialogo("Se borrarán tus datos personales y todos tus avisos de este móvil. No se puede deshacer.\n\nLos avisos ya enviados seguirán en el Ayuntamiento.", { si: "Borrar todo" }))) return;
  await cripto.borrarDatos();
  await db.borrarTodo();
  location.reload();
});

// ── arranque ─────────────────────────────────────────────────────────────────
async function iniciar() {
  try {
    const r = await fetch("/api/config");
    E.config = await r.json();
    ls.set("avisos.config", JSON.stringify(E.config));
  } catch {
    try { E.config = JSON.parse(ls.get("avisos.config")); } catch {}
    E.config ??= { envioReal: false, turnstileSitekey: null };
  }
  // Un envío que se quedó a medias (app cerrada) no se sabe si llegó: "sin confirmar".
  for (const p of await db.listar()) {
    if (p.estado === "enviando") await db.guardar({ ...p, estado: "duda", errores: ["La app se cerró durante el envío."] });
  }
  estadoRed();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  E.datos = cripto.hayDatos() ? await cripto.leerDatos() : null;
  ir(E.datos ? "inicio" : "bienvenida", { raiz: true });
}
iniciar();

// Datos personales cifrados en localStorage con AES-GCM, sin PIN.
// La clave la genera el navegador y se guarda en IndexedDB como NO EXPORTABLE:
// ningún script (ni esta app) puede leer la clave, solo usarla para cifrar y descifrar en este dispositivo.
// Protege los datos "en reposo" (copias de seguridad, extensiones que lean localStorage…);
// quien tenga el móvil desbloqueado y abra la app sí los verá, como en cualquier app.

const CLAVE_LS = "avisos.datos.v2";
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function idb(modo, fn) {
  return new Promise((ok, ko) => {
    const r = indexedDB.open("avisos-clave", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("claves");
    r.onerror = () => ko(r.error);
    r.onsuccess = () => {
      const t = r.result.transaction("claves", modo);
      const req = fn(t.objectStore("claves"));
      t.oncomplete = () => ok(req?.result);
      t.onerror = () => ko(t.error);
    };
  });
}

let clave;
async function obtenerClave() {
  if (clave) return clave;
  clave = await idb("readonly", (s) => s.get("datos"));
  if (!clave) {
    clave = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    await idb("readwrite", (s) => s.put(clave, "datos"));
  }
  return clave;
}

export function hayDatos() {
  try {
    return !!localStorage.getItem(CLAVE_LS);
  } catch {
    return false;
  }
}

export async function guardarDatos(datos) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await obtenerClave(), enc.encode(JSON.stringify(datos)));
  localStorage.setItem(CLAVE_LS, JSON.stringify({ v: 2, iv: b64(iv), ct: b64(ct) }));
}

/** Devuelve los datos o null si no hay (o si no se pueden descifrar, p. ej. porque se borró la clave). */
export async function leerDatos() {
  try {
    const g = JSON.parse(localStorage.getItem(CLAVE_LS));
    if (!g) return null;
    const plano = await crypto.subtle.decrypt({ name: "AES-GCM", iv: deB64(g.iv) }, await obtenerClave(), deB64(g.ct));
    return JSON.parse(dec.decode(plano));
  } catch {
    return null;
  }
}

export async function borrarDatos() {
  localStorage.removeItem(CLAVE_LS);
  localStorage.removeItem("avisos.datos.v1"); // formato antiguo con PIN
  clave = null;
  await idb("readwrite", (s) => s.delete("datos")).catch(() => {});
}

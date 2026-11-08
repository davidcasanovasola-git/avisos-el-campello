// ─────────────────────────────────────────────────────────────────────────────
// MAPEO DEL FORMULARIO DEL AYUNTAMIENTO
// Si el Ayuntamiento cambia su formulario, este es el ÚNICO fichero a tocar.
// Ver FORM_NOTES.md y la sección "Si cambia el formulario" del README.
// ─────────────────────────────────────────────────────────────────────────────

export const BASE = "https://intranet.elcampello.es/incidencias-extranet";

/** URLs del formulario. `base` solo se cambia en pruebas locales (variable AYTO_BASE apuntando a un simulador). */
export function urlsDe(base = BASE) {
  return {
    origen: new URL(base).origin,
    formulario: `${base}/nuevo`,
    envio: `${base}/crear`,
    exito: `${base}/creado_con_exito`,
  };
}
export const URLS = urlsDe();

// Lo que nos identifica ante su servidor. Sin disfrazarnos de navegador.
export const USER_AGENT = "AvisosElCampello/0.1 (PWA ciudadana no oficial)";

// Fotos: el formulario solo acepta jpg/png. Límite del servidor desconocido (PHP 5.6 → 2 MB por fichero por defecto).
export const FOTOS = { max: 3, maxBytes: 1_200_000, tipos: ["image/jpeg"] };

export const DESCRIPCION = { min: 50, max: 2000 };

/**
 * Construye el multipart exactamente en el orden y con los nombres del formulario original.
 * @param {object} d  datos validados
 * @param {File[]} fotos
 */
export function construirFormulario(d, fotos) {
  const f = new FormData();
  f.append("email_importante", ""); // honeypot: SIEMPRE vacío
  f.append("anonimo", "0");
  f.append("nombre", d.nombre);
  f.append("email", d.email);
  f.append("movil", d.movil);
  f.append("notificar", "0");
  if (d.notificar) f.append("notificar", "1"); // patrón hidden 0 + checkbox 1
  // Dos campos "calle": el texto visible y el hidden con el ID del catálogo municipal. No usamos el catálogo:
  // el texto es la calle que devuelve el mapa (OSM) y el hidden va vacío, igual que cuando alguien escribe
  // la calle en el formulario oficial sin elegirla del desplegable. La calle va además en la descripción.
  f.append("calle", d.calle_texto);
  f.append("calle", "");
  f.append("calle_num", d.calle_num);
  // "ubicacion" (parques, playas…): se deja vacía a propósito; la posición va en la descripción.
  f.append("ubicacion", "");
  f.append("ubicacion", "");
  f.append("descripcion", d.descripcion);
  fotos.forEach((foto, i) => f.append("ficheros[]", foto, `foto${i + 1}.jpg`));
  f.append("aceptar_terminos", "on");
  return f;
}

/** ¿La página de confirmación indica éxito? (textos ASCII para no depender de la codificación). */
export function esConfirmacion(html) {
  return html.includes("alert-success") && html.includes("Incidencia creada correctamente");
}

/** ¿La respuesta es el formulario devuelto con errores de validación? */
export function erroresValidacion(html) {
  if (!html.includes("has-error")) return null;
  const errores = [...html.matchAll(/<span[^>]*class="[^"]*help-(?:block|inline)[^"]*"[^>]*>([^<]+)</g)].map((m) => m[1].trim());
  return errores.length ? errores : ["El formulario del Ayuntamiento ha devuelto errores de validación."];
}

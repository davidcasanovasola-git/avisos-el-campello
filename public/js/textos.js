// Tipos de incidencia y redacción del texto que se envía.
// El formulario del Ayuntamiento no tiene campo de tipo: va dentro de la descripción.

export const TIPOS = [
  { id: "horizontal", icono: "〰️", etiqueta: "Señalización horizontal mal pintada", frase: "la señalización horizontal (marcas viales) está borrada o en mal estado" },
  { id: "bordillo", icono: "🟨", etiqueta: "Bordillo amarillo sin pintar", frase: "el bordillo no tiene pintada, o la tiene borrada, la línea amarilla de prohibición de estacionamiento" },
  { id: "espejo", icono: "🪞", etiqueta: "Falta espejo de visibilidad", frase: "falta un espejo de visibilidad (espejo convexo de tráfico) necesario para salir con seguridad, o el que hay está roto" },
  { id: "vertical", icono: "⚠️", etiqueta: "Señal vertical dañada o ausente", frase: "una señal vertical de tráfico está dañada, caída, tapada o ha desaparecido" },
  { id: "pavimento", icono: "🚧", etiqueta: "Pavimento o acera", frase: "el pavimento o la acera tienen un desperfecto que supone un riesgo para peatones o vehículos" },
  { id: "alumbrado", icono: "💡", etiqueta: "Alumbrado", frase: "hay una avería en el alumbrado público (farola apagada, intermitente o dañada)" },
  { id: "mobiliario", icono: "🪑", etiqueta: "Mobiliario urbano", frase: "hay un desperfecto en el mobiliario urbano" },
  { id: "otro", icono: "📝", etiqueta: "Otro", frase: "hay la siguiente incidencia en la vía pública" },
];

export const tipoPorId = (id) => TIPOS.find((t) => t.id === id);

const f5 = (n) => Number(n).toFixed(5);

/** Texto principal propuesto (editable por el usuario). */
export function proponerTexto({ tipo, detalle, calle, numero }) {
  const t = tipoPorId(tipo) ?? tipoPorId("otro");
  const lugar = calle ? `${calle}${numero ? `, ${numero}` : ""}` : "la ubicación indicada";
  let texto = `Les comunico que en ${lugar} (El Campello) ${t.frase}.`;
  const d = (detalle || "").trim();
  if (d) texto += ` ${d.charAt(0).toUpperCase()}${d.slice(1)}${/[.!?]$/.test(d) ? "" : "."}`;
  texto += " Solicito que lo revisen y lo reparen. Gracias.";
  return texto;
}

/** Bloque de ubicación que se añade siempre al final (no editable). */
export function bloqueUbicacion({ pin, gps, movido, fotos }) {
  const l = [];
  l.push("");
  l.push(`Ubicación${movido ? " (marcada en el mapa)" : ""}: ${f5(pin.lat)}, ${f5(pin.lon)}`);
  if (gps && movido) l.push(`GPS del móvil: ${f5(gps.lat)}, ${f5(gps.lon)} (±${Math.round(gps.acc)} m)`);
  else if (gps) l.push(`Precisión del GPS: ±${Math.round(gps.acc)} m`);
  (fotos || []).forEach((f, i) => {
    if (f.exif?.lat != null) l.push(`Coordenadas de la foto ${i + 1}: ${f5(f.exif.lat)}, ${f5(f.exif.lon)}`);
  });
  l.push(`Mapa: https://www.openstreetmap.org/?mlat=${f5(pin.lat)}&mlon=${f5(pin.lon)}#map=19/${f5(pin.lat)}/${f5(pin.lon)}`);
  return l.join("\n");
}

export function descripcionFinal(parte) {
  return `${(parte.texto || "").trim()}\n${bloqueUbicacion(parte)}`;
}

// Justificante en PDF de un parte (para reclamar por la sede electrónica o ante el Síndic de Greuges).
import { tipoPorId, descripcionFinal } from "./textos.js";
import { blobADataURL } from "./imagen.js";

const ESTADOS = { enviado: "Enviado", duda: "Sin confirmar (puede haberse enviado)", error: "Error", pendiente: "Pendiente de envío", prueba: "Prueba (no enviado)", borrador: "Borrador", enviando: "Enviando" };

export async function generarPDF(parte, remitente) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const M = 18, ANCHO = 210 - 2 * M;
  let y = 20;
  const salto = (h) => {
    if (y + h > 280) {
      doc.addPage();
      y = 20;
    }
  };
  const linea = (etiqueta, valor) => {
    if (!valor) return;
    doc.setFont("helvetica", "bold").setFontSize(10);
    salto(6);
    doc.text(etiqueta, M, y);
    doc.setFont("helvetica", "normal");
    const t = doc.splitTextToSize(String(valor), ANCHO - 45);
    doc.text(t, M + 45, y);
    y += Math.max(6, t.length * 5);
  };

  doc.setFont("helvetica", "bold").setFontSize(16).text("Justificante de aviso de incidencia", M, y);
  y += 7;
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(90);
  doc.text("Ayuntamiento de El Campello · Formulario «Comunicar incidencia»", M, y);
  y += 5;
  doc.text("https://intranet.elcampello.es/incidencias-extranet/nuevo", M, y);
  doc.setTextColor(0);
  y += 10;

  linea("Referencia propia", parte.ref);
  linea("Estado", ESTADOS[parte.estado] || parte.estado);
  linea("Creado", new Date(parte.creado).toLocaleString("es-ES"));
  if (parte.enviado) linea("Enviado", new Date(parte.enviado).toLocaleString("es-ES"));
  if (parte.fechaServidor) linea("Hora del servidor", `${parte.fechaServidor} (cabecera Date de la respuesta del Ayuntamiento)`);
  if (parte.confirmacion) linea("Respuesta", parte.confirmacion);
  if (parte.numeroOficial) linea("Nº oficial", parte.numeroOficial);
  linea("Tipo", tipoPorId(parte.tipo)?.etiqueta);
  linea("Calle", [parte.calle?.value || parte.calleTexto, parte.numero].filter(Boolean).join(", "));
  linea("Dirección (OSM)", parte.direccion?.direccion);
  linea("Coordenadas", `${parte.pin.lat.toFixed(6)}, ${parte.pin.lon.toFixed(6)}`);
  if (remitente) linea("Remitente", `${[remitente.nombre, remitente.apellidos].filter(Boolean).join(" ")} · ${remitente.email}${remitente.movil ? ` · ${remitente.movil}` : ""}`);
  if (parte.arreglado) linea("Arreglado", parte.arreglado === true ? "Sí" : parte.arreglado);
  linea("Notas", parte.notas);

  y += 4;
  salto(12);
  doc.setFont("helvetica", "bold").setFontSize(11).text("Texto enviado", M, y);
  y += 6;
  doc.setFont("helvetica", "normal").setFontSize(10);
  for (const l of doc.splitTextToSize(descripcionFinal(parte), ANCHO)) {
    salto(5);
    doc.text(l, M, y);
    y += 5;
  }

  for (const [i, f] of (parte.fotos || []).entries()) {
    const url = await blobADataURL(f.blob);
    const p = doc.getImageProperties(url);
    const w = ANCHO, h = Math.min(150, (p.height / p.width) * w);
    const wf = (p.width / p.height) * h;
    salto(h + 10);
    y += 4;
    doc.setFontSize(9).setTextColor(90).text(`Foto ${i + 1}${f.exif?.fecha ? ` · ${new Date(f.exif.fecha).toLocaleString("es-ES")}` : ""}`, M, y);
    doc.setTextColor(0);
    y += 2;
    doc.addImage(url, "JPEG", M, y, wf, h);
    y += h + 2;
  }

  salto(14);
  y += 6;
  doc.setFontSize(8).setTextColor(110);
  doc.text(doc.splitTextToSize("Documento generado por «Avisos El Campello», una app no oficial. El formulario del Ayuntamiento no devuelve número de parte; este justificante recoge lo enviado y la respuesta recibida.", ANCHO), M, y);
  doc.save(`aviso-${parte.ref}.pdf`);
}

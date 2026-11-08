// Lectura de GPS EXIF, compresión y miniaturas. La foto comprimida NO lleva EXIF (más privacidad);
// las coordenadas de la foto se copian aparte y se añaden al texto del parte.

const LADO_MAX = 1600;
const BYTES_OBJETIVO = 800_000;

/** Coordenadas y fecha de la foto original, si las trae (en iOS, solo si la cámara tiene permiso de ubicación). */
export async function leerExif(fichero) {
  try {
    const exifr = window.exifr;
    const [gps, meta] = await Promise.all([
      exifr.gps(fichero).catch(() => null),
      exifr.parse(fichero, ["DateTimeOriginal"]).catch(() => null),
    ]);
    const ok = gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude) && !(gps.latitude === 0 && gps.longitude === 0);
    return {
      lat: ok ? gps.latitude : null,
      lon: ok ? gps.longitude : null,
      fecha: meta?.DateTimeOriginal instanceof Date ? meta.DateTimeOriginal.toISOString() : null,
    };
  } catch {
    return { lat: null, lon: null, fecha: null };
  }
}

async function decodificar(fichero) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(fichero, { imageOrientation: "from-image" });
    } catch {}
  }
  const url = URL.createObjectURL(fichero);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function dibujar(img, ladoMax) {
  const w = img.width, h = img.height;
  const k = Math.min(1, ladoMax / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

const aBlob = (c, q) => new Promise((ok) => c.toBlob(ok, "image/jpeg", q));

/** JPEG ≤ ~800 KB y lado largo ≤ 1600 px. */
export async function comprimir(fichero) {
  const img = await decodificar(fichero);
  for (const lado of [LADO_MAX, 1280, 1024]) {
    const c = dibujar(img, lado);
    for (const q of [0.82, 0.72, 0.62, 0.52]) {
      const b = await aBlob(c, q);
      if (b && b.size <= BYTES_OBJETIVO) return b;
    }
  }
  return aBlob(dibujar(img, 800), 0.5);
}

export async function miniatura(blob) {
  const img = await decodificar(blob);
  return dibujar(img, 240).toDataURL("image/jpeg", 0.7);
}

export function blobADataURL(blob) {
  return new Promise((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = () => ko(r.error);
    r.readAsDataURL(blob);
  });
}

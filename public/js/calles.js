// Empareja el nombre de calle de OpenStreetMap con el catálogo municipal (que pide un ID numérico).
// El catálogo mezcla castellano y valenciano ("C/ Sant Joan", "Av Carrer La Mar"), así que se normaliza todo.

const VACIAS = new Set("c calle carrer avenida avinguda av avda plaza placa pl paseo passeig pg camino cami partida paratge paraje travesia travessia trav ctra carretera glorieta gta ronda via urbanizacion urb de del dels la el les els los las l d i y a en".split(" "));

// valenciano → castellano (para comparar los dos idiomas)
const SINONIMOS = {
  sant: "san", santa: "santa", joan: "juan", josep: "jose", pere: "pedro", vicent: "vicente", francesc: "francisco",
  jordi: "jorge", miquel: "miguel", lluis: "luis", carles: "carlos", jaume: "jaime", bartomeu: "bartolome",
  ramon: "ramon", pare: "padre", mare: "madre", deu: "dios", esglesia: "iglesia", font: "fuente", pou: "pozo", torre: "torre",
  mestre: "maestro", doctor: "doctor", metge: "medico", pintor: "pintor", poeta: "poeta", riu: "rio", mar: "mar",
  muntanya: "montana", nou: "nuevo", nova: "nueva", vell: "viejo", vella: "vieja", major: "mayor", sol: "sol",
};

export function normalizar(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’'`·.\-/()]/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !VACIAS.has(t))
    .map((t) => SINONIMOS[t] || t);
}

function parecido(a, b) {
  const A = new Set(normalizar(a)), B = new Set(normalizar(b));
  if (!A.size || !B.size) return 0;
  let comunes = 0;
  for (const t of A) if (B.has(t)) comunes++;
  return (2 * comunes) / (A.size + B.size);
}

export async function buscar(term) {
  const r = await fetch(`/api/calles?term=${encodeURIComponent(term)}`);
  if (!r.ok) throw new Error("Buscador de calles no disponible");
  return r.json();
}

/** Devuelve hasta 6 candidatas ordenadas por parecido: [{id, value, puntuacion}] */
export async function emparejar(nombreOsm) {
  const tokens = normalizar(nombreOsm).filter((t) => t.length >= 3 && !/^\d+$/.test(t));
  if (!tokens.length) return [];
  const original = (nombreOsm || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/\s+/);
  const inverso = Object.fromEntries(Object.entries(SINONIMOS).map(([va, es]) => [es, va]));
  // Busca por la palabra más larga, en castellano y en valenciano.
  const larga = [...tokens].sort((a, b) => b.length - a.length)[0];
  const terminos = new Set([larga, inverso[larga]].filter(Boolean));
  const masLargaOriginal = original.filter((t) => t.length >= 4 && !VACIAS.has(t)).sort((a, b) => b.length - a.length)[0];
  if (masLargaOriginal) terminos.add(masLargaOriginal);
  const vistos = new Map();
  for (const t of [...terminos].slice(0, 3)) {
    try {
      for (const c of await buscar(t)) vistos.set(c.id, c);
    } catch {}
  }
  return [...vistos.values()]
    .map((c) => ({ ...c, puntuacion: parecido(nombreOsm, c.value) }))
    .filter((c) => c.puntuacion > 0)
    .sort((a, b) => b.puntuacion - a.puntuacion)
    .slice(0, 6);
}

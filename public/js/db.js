// Historial de partes en IndexedDB (solo en este dispositivo). Las fotos se guardan como Blob.

const NOMBRE = "avisos-el-campello";
let promesa;

function abrir() {
  promesa ??= new Promise((ok, ko) => {
    const r = indexedDB.open(NOMBRE, 1);
    r.onupgradeneeded = () => {
      const s = r.result.createObjectStore("partes", { keyPath: "id" });
      s.createIndex("creado", "creado");
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
  return promesa;
}

async function tx(modo, fn) {
  const db = await abrir();
  return new Promise((ok, ko) => {
    const t = db.transaction("partes", modo);
    const res = fn(t.objectStore("partes"));
    t.oncomplete = () => ok(res?.result ?? res);
    t.onerror = () => ko(t.error);
    t.onabort = () => ko(t.error);
  });
}

export const guardar = (parte) => tx("readwrite", (s) => s.put({ ...parte, actualizado: Date.now() }));
export const obtener = (id) => tx("readonly", (s) => s.get(id));
export const borrar = (id) => tx("readwrite", (s) => s.delete(id));
export const borrarTodo = () => tx("readwrite", (s) => s.clear());
export async function listar() {
  const todos = await tx("readonly", (s) => s.getAll());
  return todos.sort((a, b) => b.creado - a.creado);
}

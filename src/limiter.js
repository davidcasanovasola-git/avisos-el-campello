import { DurableObject } from "cloudflare:workers";

const NOMINATIM_INTERVALO_MS = 1100; // política de Nominatim: máx. 1 petición/segundo (en total, no por usuario)

/**
 * Una única instancia ("global") que lleva:
 *  - los contadores de envíos (por IP con hash, por dispositivo y global) y el tiempo entre envíos
 *  - las claves de idempotencia, para no enviar dos veces el mismo parte
 *  - la cola de Nominatim, para no pasar de 1 petición por segundo
 * No guarda datos personales: solo hashes, contadores y estados.
 */
export class Limiter extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.colaNominatim = Promise.resolve();
    this.ultimaNominatim = 0;
  }

  async reservar({ ipHash, dispositivo, clave }) {
    const s = this.ctx.storage;
    const env = this.env;
    const ahora = Date.now();
    const dia = new Date(ahora).toISOString().slice(0, 10);

    const previo = await s.get(`idem:${clave}`);
    // Si el intento anterior falló ANTES de llegar al Ayuntamiento (o fue rechazado por validación), se puede reintentar.
    if (previo && previo.estado !== "error") return { ok: false, motivo: "duplicado", previo };

    const limIp = Number(env.LIMITE_DIA_IP ?? 10);
    const limDev = Number(env.LIMITE_DIA_DISPOSITIVO ?? 10);
    const limGlobal = Number(env.LIMITE_DIA_GLOBAL ?? 100);
    const espera = Number(env.SEGUNDOS_ENTRE_ENVIOS ?? 120) * 1000;

    const kIp = `d:${dia}:ip:${ipHash}`;
    const kDev = `d:${dia}:dev:${dispositivo}`;
    const kGlobal = `d:${dia}:global`;
    const kUltIp = `ult:ip:${ipHash}`;
    const kUltDev = `ult:dev:${dispositivo}`;
    const v = await s.get([kIp, kDev, kGlobal, kUltIp, kUltDev]);
    const nIp = v.get(kIp) ?? 0, nDev = v.get(kDev) ?? 0, nGlobal = v.get(kGlobal) ?? 0;
    const ult = Math.max(v.get(kUltIp) ?? 0, v.get(kUltDev) ?? 0);

    if (nGlobal >= limGlobal) return { ok: false, motivo: "limite_global" };
    if (nIp >= limIp || nDev >= limDev) return { ok: false, motivo: "limite_diario", limite: Math.min(limIp, limDev) };
    if (ahora - ult < espera) return { ok: false, motivo: "espera", segundos: Math.ceil((espera - (ahora - ult)) / 1000) };

    await s.put({
      [kIp]: nIp + 1,
      [kDev]: nDev + 1,
      [kGlobal]: nGlobal + 1,
      [kUltIp]: ahora,
      [kUltDev]: ahora,
      [`idem:${clave}`]: { estado: "enviando", t: ahora },
    });
    await this.programarLimpieza();
    return { ok: true };
  }

  async finalizar(clave, resultado) {
    await this.ctx.storage.put(`idem:${clave}`, { ...resultado, t: Date.now() });
  }

  async programarLimpieza() {
    if ((await this.ctx.storage.getAlarm()) == null) {
      await this.ctx.storage.setAlarm(Date.now() + 6 * 3600 * 1000);
    }
  }

  async alarm() {
    const s = this.ctx.storage;
    const hoy = new Date().toISOString().slice(0, 10);
    const borrar = [];
    for (const [k, v] of await s.list({ prefix: "d:" })) if (k.slice(2, 12) < hoy) borrar.push(k);
    const limiteIdem = Date.now() - 48 * 3600 * 1000;
    for (const [k, v] of await s.list({ prefix: "idem:" })) if ((v?.t ?? 0) < limiteIdem) borrar.push(k);
    const limiteUlt = Date.now() - 24 * 3600 * 1000;
    for (const [k, v] of await s.list({ prefix: "ult:" })) if (v < limiteUlt) borrar.push(k);
    for (let i = 0; i < borrar.length; i += 128) await s.delete(borrar.slice(i, i + 128));
    if ((await s.list({ limit: 1 })).size > 0) await s.setAlarm(Date.now() + 6 * 3600 * 1000);
  }

  /** Llama a Nominatim en serie, como mucho una vez por segundo para toda la app. */
  nominatim(url, userAgent) {
    const tarea = this.colaNominatim.then(async () => {
      const esperar = this.ultimaNominatim + NOMINATIM_INTERVALO_MS - Date.now();
      if (esperar > 0) await new Promise((r) => setTimeout(r, esperar));
      this.ultimaNominatim = Date.now();
      const r = await fetch(url, { headers: { "User-Agent": userAgent, Accept: "application/json" } });
      return { status: r.status, body: await r.text() };
    });
    this.colaNominatim = tarea.catch(() => {});
    return tarea;
  }
}

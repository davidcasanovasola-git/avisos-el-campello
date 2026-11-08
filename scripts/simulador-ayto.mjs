// Simulador LOCAL del formulario del Ayuntamiento, para probar el envío real sin crear partes de verdad.
// Imita lo observado en el HAR del 8 de noviembre de 2026: cookie de sesión → POST /crear → 302 → página con mensaje flash.
//   node scripts/simulador-ayto.mjs            (responde OK)
//   SIM_MODO=error node scripts/...            (devuelve el formulario con has-error)
//   SIM_MODO=lento node scripts/...            (no responde al POST: el Worker debe marcar "duda")
import http from "node:http";

const PUERTO = Number(process.env.SIM_PUERTO || 9999);
const MODO = process.env.SIM_MODO || "ok";
const P = "/incidencias-extranet";
let recibidos = 0;

http
  .createServer((req, res) => {
    const cookie = req.headers.cookie || "";
    console.log(`${req.method} ${req.url} cookie=${cookie ? "sí" : "no"} ua=${req.headers["user-agent"]}`);
    if (req.method === "GET" && req.url === `${P}/nuevo`) {
      res.writeHead(200, { "Content-Type": "text/html; charset=UTF-8", "Set-Cookie": "laravel_session=sim123; path=/; httponly" });
      return res.end('<form action="crear"><input name="email_importante"></form>');
    }
    if (req.method === "POST" && req.url === `${P}/crear`) {
      const trozos = [];
      req.on("data", (c) => trozos.push(c));
      req.on("end", () => {
        const cuerpo = Buffer.concat(trozos).toString("latin1");
        const campos = [...cuerpo.matchAll(/name="([^"]+)"(?:; filename="([^"]*)")?/g)].map((m) => m[1] + (m[2] ? `(${m[2]})` : ""));
        recibidos++;
        console.log(`  POST nº${recibidos} (${trozos.reduce((a, b) => a + b.length, 0)} bytes) campos: ${campos.join(", ")}`);
        console.log(`  honeypot vacío: ${/name="email_importante"\r\n\r\n\r\n/.test(cuerpo)} · cookie: ${cookie.includes("laravel_session=sim123")}`);
        if (MODO === "lento") return; // nunca responde
        if (MODO === "error") {
          res.writeHead(200, { "Content-Type": "text/html; charset=UTF-8" });
          return res.end('<div class="form-group has-error"><span class="help-block">El campo calle es obligatorio.</span></div>');
        }
        res.writeHead(302, { Location: `https://${req.headers.host}${P}/creado_con_exito`.replace("https://", "http://"), "Set-Cookie": "laravel_session=sim456flash; path=/; httponly", Date: new Date().toUTCString() });
        res.end();
      });
      return;
    }
    if (req.method === "GET" && req.url === `${P}/creado_con_exito`) {
      res.writeHead(200, { "Content-Type": "text/html; charset=UTF-8" });
      const flash = cookie.includes("sim456flash") ? '<div class="alert alert-block alert-success"><p>Incidencia creada correctamente se le notificar\xe1 cuando sea aceptada</p></div>' : "";
      return res.end(Buffer.from(`<h4>Confirmaci\xf3n de creaci\xf3n de parte de incidencia</h4>${flash}`, "latin1"));
    }
    res.writeHead(404).end();
  })
  .listen(PUERTO, "127.0.0.1", () => console.log(`Simulador del Ayuntamiento (${MODO}) en http://127.0.0.1:${PUERTO}${P}`));

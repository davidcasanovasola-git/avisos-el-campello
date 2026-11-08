import { test } from "node:test";
import assert from "node:assert/strict";
import { construirFormulario, esConfirmacion, erroresValidacion } from "../src/form-map.js";
import { proponerTexto, descripcionFinal } from "../public/js/textos.js";

const datos = { nombre: "Ana Pérez", email: "ana@example.com", movil: "600000000", notificar: true, calle_texto: "Calle Jorge Juan", calle_num: "5", descripcion: "x".repeat(60) };

test("el multipart replica el formulario oficial", () => {
  const f = construirFormulario(datos, [new File([new Uint8Array([0xff, 0xd8, 0xff])], "a.jpg", { type: "image/jpeg" })]);
  const pares = [...f.entries()].map(([k, v]) => [k, typeof v === "string" ? v : `[${v.name}]`]);
  assert.deepEqual(pares, [
    ["email_importante", ""], ["anonimo", "0"], ["nombre", "Ana Pérez"], ["email", "ana@example.com"], ["movil", "600000000"],
    ["notificar", "0"], ["notificar", "1"], ["calle", "Calle Jorge Juan"], ["calle", ""], ["calle_num", "5"],
    ["ubicacion", ""], ["ubicacion", ""], ["descripcion", "x".repeat(60)], ["ficheros[]", "[foto1.jpg]"], ["aceptar_terminos", "on"],
  ]);
});

test("honeypot siempre vacío y sin notificar si no se pide", () => {
  const f = construirFormulario({ ...datos, notificar: false, calle_texto: "" }, []);
  assert.equal(f.get("email_importante"), "");
  assert.deepEqual(f.getAll("notificar"), ["0"]);
  assert.deepEqual(f.getAll("calle"), ["", ""]);
});

test("detección de confirmación y errores", () => {
  assert.ok(esConfirmacion('<div class="alert alert-block alert-success"><p>Incidencia creada correctamente se le notificar'));
  assert.ok(!esConfirmacion("<h4>Confirmaci\xf3n de creaci\xf3n de parte</h4>"));
  assert.ok(erroresValidacion('<div class="form-group has-error"><span class="help-block">El campo descripcion es obligatorio.</span>'));
  assert.equal(erroresValidacion("<form></form>"), null);
});

test("texto propuesto + bloque de ubicación supera el mínimo y lleva coordenadas de la foto", () => {
  const p = {
    texto: proponerTexto({ tipo: "bordillo", detalle: "frente al colegio", calle: "C/ Jorge Juan", numero: "5" }),
    pin: { lat: 38.428612, lon: -0.397611 }, gps: { lat: 38.4286, lon: -0.3976, acc: 7.6 }, movido: false,
    fotos: [{ exif: { lat: 38.42865, lon: -0.39765 } }, { exif: { lat: null } }],
  };
  const d = descripcionFinal(p);
  assert.ok(d.length >= 50);
  assert.match(d, /C\/ Jorge Juan, 5 \(El Campello\)/);
  assert.match(d, /Frente al colegio\./);
  assert.match(d, /Coordenadas de la foto 1: 38\.42865, -0\.39765/);
  assert.doesNotMatch(d, /foto 2/);
  assert.match(d, /openstreetmap\.org\/\?mlat=38\.42861&mlon=-0\.39761/);
});

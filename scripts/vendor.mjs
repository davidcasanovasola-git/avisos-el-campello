// Copia las librerías de node_modules a public/vendor para servirlas desde nuestro dominio
// (funciona sin conexión gracias al service worker y no dependemos de CDNs).
import { cpSync, mkdirSync } from "node:fs";

const out = "public/vendor";
mkdirSync(`${out}/leaflet`, { recursive: true });
cpSync("node_modules/leaflet/dist/leaflet.js", `${out}/leaflet/leaflet.js`);
cpSync("node_modules/leaflet/dist/leaflet.css", `${out}/leaflet/leaflet.css`);
cpSync("node_modules/leaflet/dist/images", `${out}/leaflet/images`, { recursive: true });
cpSync("node_modules/jspdf/dist/jspdf.umd.min.js", `${out}/jspdf.umd.min.js`);
cpSync("node_modules/exifr/dist/lite.umd.js", `${out}/exifr.lite.umd.js`);
console.log("vendor: librerías copiadas a", out);

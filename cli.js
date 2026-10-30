#!/usr/bin/env node
// Uso: node cli.js receta.json [--proveedor prueba] [--salida carpeta] [--concurrencia 4]
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Lote } from './lib/motor.js';
import { PROVEEDORES } from './lib/proveedores.js';

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const archivo = args.find((a) => !a.startsWith('--'));
if (!archivo) {
  console.log('Uso: node cli.js receta.json [--proveedor prueba] [--salida carpeta] [--concurrencia 4] [--variantes 2]');
  process.exit(1);
}
const opt = (n, d) => {
  const i = args.indexOf('--' + n);
  return i >= 0 ? args[i + 1] : d;
};

const receta = JSON.parse(await fs.readFile(path.resolve(archivo), 'utf8'));
if (opt('proveedor')) receta.proveedor = opt('proveedor');
if (opt('salida')) receta.salida = opt('salida');
if (opt('concurrencia')) receta.concurrencia = +opt('concurrencia');
if (opt('variantes')) receta.variantes = +opt('variantes');

const cfg = await fs.readFile(path.join(RAIZ, 'config.json'), 'utf8').then(JSON.parse).catch(() => ({}));
const claves = { ...(cfg.claves || {}) };
for (const [k, v] of Object.entries(PROVEEDORES)) if (v.clave && process.env[v.clave]) claves[k] ||= process.env[v.clave];

let barra = '';
const lote = new Lote(receta, {
  raiz: RAIZ,
  claves,
  emitir: (ev) => {
    if (ev.tipo === 'inicio') console.log(`\n▶ ${ev.total} imágenes → ${ev.carpeta}\n`);
    if (ev.tipo === 'trabajo:ok') {
      barra = `  ✔ ${ev.hechos + ev.fallidos}/${ev.total}  ${path.basename(ev.archivo)}`;
      console.log(barra);
    }
    if (ev.tipo === 'trabajo:reintento') console.log(`  ↻ #${ev.n} intento ${ev.intento}: ${ev.error}`);
    if (ev.tipo === 'trabajo:error') console.log(`  ✕ #${ev.n}: ${ev.error}`);
    if (ev.tipo === 'fatal') console.log(`\n⚠ ${ev.error}\n`);
    if (ev.tipo === 'fin') console.log(`\n■ ${ev.hechos} listas, ${ev.fallidos} fallidas → ${ev.carpeta}\n`);
  },
});
process.on('SIGINT', () => { lote.cancelar(); });
await lote.ejecutar();

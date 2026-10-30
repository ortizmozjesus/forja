// Forja — servidor local sin dependencias. node server.js
import http from 'node:http';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Lote, preparar } from './lib/motor.js';
import { PROVEEDORES } from './lib/proveedores.js';
import { referenciasUsadas } from './lib/plantilla.js';
import { exportarManual } from './lib/exportar.js';
import { MODELOS, nuevaConversacion, enviar as enviarEstudio, elegir as elegirEstudio, probar as probarClave } from './lib/estudio.js';

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const PUERTO = Number(process.env.PUERTO || process.env.PORT || 4180);
const CONFIG = path.join(RAIZ, 'config.json');
for (const d of ['referencias', 'salidas', 'recetas']) fss.mkdirSync(path.join(RAIZ, d), { recursive: true });

const leerConfig = async () => {
  try { return JSON.parse(await fs.readFile(CONFIG, 'utf8')); } catch { return {}; }
};
const guardarConfig = (c) => fs.writeFile(CONFIG, JSON.stringify(c, null, 2));

const claveGemini = async () => (await leerConfig()).claves?.gemini || process.env.GEMINI_API_KEY || '';

const clientes = new Set();
const difundir = (ev) => {
  const datos = `data: ${JSON.stringify(ev)}\n\n`;
  for (const c of clientes) { try { c.write(datos); } catch {} }
};
let loteActivo = null;

const TIPOS = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

const json = (res, datos, estado = 200) => {
  const cuerpo = JSON.stringify(datos);
  res.writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(cuerpo) });
  res.end(cuerpo);
};

async function cuerpoJson(req, limite = 80 * 1024 * 1024) {
  const trozos = [];
  let n = 0;
  for await (const t of req) {
    n += t.length;
    if (n > limite) throw new Error('Cuerpo demasiado grande');
    trozos.push(t);
  }
  return trozos.length ? JSON.parse(Buffer.concat(trozos).toString('utf8')) : {};
}

async function servirArchivo(res, absoluta) {
  try {
    const datos = await fs.readFile(absoluta);
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(absoluta).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(datos);
  } catch {
    res.writeHead(404); res.end('no encontrado');
  }
}

const dentro = (p) => path.resolve(p).startsWith(path.resolve(RAIZ));

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PUERTO}`);
  const ruta = decodeURIComponent(url.pathname);
  try {
    // ---- proteccion: solo se atiende a esta propia pagina en este ordenador.
    // Evita que otra web abierta en tu navegador (o alguien de tu red) gaste tu clave.
    const host = String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    const origen = req.headers.origin;
    if (!['localhost', '127.0.0.1', '::1'].includes(host) || (origen && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origen))) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Acceso no permitido');
    }

    // ---- estaticos
    if (req.method === 'GET' && (ruta === '/' || ruta === '/estudio')) return servirArchivo(res, path.join(RAIZ, 'public/estudio.html'));
    if (req.method === 'GET' && (ruta === '/lotes' || ruta === '/index.html')) return servirArchivo(res, path.join(RAIZ, 'public/index.html'));
    if (req.method === 'GET' && /^\/(public|salidas|referencias|ejemplos)\//.test(ruta)) {
      const abs = path.join(RAIZ, ruta);
      if (!dentro(abs)) { res.writeHead(403); return res.end(); }
      return servirArchivo(res, abs);
    }

    // ---- estado general
    if (ruta === '/api/estado' && req.method === 'GET') {
      const cfg = await leerConfig();
      const refs = (await fs.readdir(path.join(RAIZ, 'referencias')).catch(() => []))
        .filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
      const recetas = (await fs.readdir(path.join(RAIZ, 'recetas')).catch(() => [])).filter((f) => f.endsWith('.json'));
      return json(res, {
        proveedores: Object.fromEntries(Object.entries(PROVEEDORES).map(([k, v]) => [k, { nombre: v.nombre, modelos: v.modelos, refs: v.refs }])),
        claves: Object.fromEntries(Object.keys(PROVEEDORES).map((k) => [k, Boolean(cfg.claves?.[k])])),
        base: cfg.base || '',
        ultima: cfg.ultima || null,
        referencias: refs,
        recetas,
        ocupado: Boolean(loteActivo),
      });
    }

    if (ruta === '/api/claves' && req.method === 'POST') {
      const cfg = await leerConfig();
      const body = await cuerpoJson(req);
      cfg.claves = { ...(cfg.claves || {}) };
      for (const [k, v] of Object.entries(body.claves || {})) if (typeof v === 'string' && v.trim()) cfg.claves[k] = v.trim();
      if (body.base !== undefined) cfg.base = body.base;
      await guardarConfig(cfg);
      return json(res, { ok: true });
    }

    // ---- referencias
    if (ruta === '/api/referencias' && req.method === 'POST') {
      const { nombre, datos } = await cuerpoJson(req);
      const limpio = String(nombre || 'ref').replace(/[^\w.-]/g, '_');
      const abs = path.join(RAIZ, 'referencias', limpio);
      if (!dentro(abs)) { res.writeHead(403); return res.end(); }
      await fs.writeFile(abs, Buffer.from(String(datos).split(',').pop(), 'base64'));
      return json(res, { ok: true, archivo: limpio });
    }
    if (ruta === '/api/referencias/borrar' && req.method === 'POST') {
      const { archivo } = await cuerpoJson(req);
      const abs = path.join(RAIZ, 'referencias', path.basename(String(archivo)));
      if (dentro(abs)) await fs.unlink(abs).catch(() => {});
      return json(res, { ok: true });
    }

    // ---- recetas
    if (ruta === '/api/receta' && req.method === 'POST') {
      const { nombre, receta } = await cuerpoJson(req);
      const archivo = path.join(RAIZ, 'recetas', String(nombre || 'receta').replace(/[^\w.-]/g, '_') + '.json');
      await fs.writeFile(archivo, JSON.stringify(receta, null, 2));
      return json(res, { ok: true, archivo: path.basename(archivo) });
    }
    if (ruta === '/api/receta' && req.method === 'GET') {
      const abs = path.join(RAIZ, 'recetas', path.basename(url.searchParams.get('nombre') || ''));
      if (!dentro(abs)) { res.writeHead(403); return res.end(); }
      return json(res, JSON.parse(await fs.readFile(abs, 'utf8')));
    }

    // ---- previsualizacion
    if (ruta === '/api/previsualizar' && req.method === 'POST') {
      const { receta } = await cuerpoJson(req);
      const trabajos = preparar(receta, RAIZ);
      const definidas = Object.keys(receta.referencias || {}).map((k) => k.toLowerCase());
      const faltantes = referenciasUsadas(`${receta.plantilla || ''} ${receta.sufijo || ''}`)
        .filter((r) => !definidas.includes(r.toLowerCase()));
      return json(res, {
        total: trabajos.length,
        faltantes,
        ejemplos: trabajos.slice(0, 12).map((t) => ({ n: t.n, nombre: t.nombre, prompt: t.prompt, referencias: t.referencias })),
      });
    }

    // ---- exportar para sesion manual (Nano Banana)
    if (ruta === '/api/exportar' && req.method === 'POST') {
      const { receta } = await cuerpoJson(req);
      const cfg = await leerConfig();
      cfg.ultima = receta;
      await guardarConfig(cfg);
      return json(res, await exportarManual(receta, RAIZ));
    }

    // ---- lote
    if (ruta === '/api/lote' && req.method === 'POST') {
      if (loteActivo) return json(res, { error: 'Ya hay un lote en marcha' }, 409);
      const { receta } = await cuerpoJson(req);
      const cfg = await leerConfig();
      cfg.ultima = receta;
      await guardarConfig(cfg);
      const claves = { ...(cfg.claves || {}) };
      for (const [k, v] of Object.entries(PROVEEDORES)) if (v.clave && process.env[v.clave]) claves[k] ||= process.env[v.clave];
      const lote = new Lote(receta, { raiz: RAIZ, claves, emitir: difundir });
      loteActivo = lote;
      json(res, { ok: true, lote: lote.id, total: lote.trabajos.length });
      lote.ejecutar().catch((e) => difundir({ tipo: 'fatal', error: String(e.message || e) })).finally(() => { loteActivo = null; });
      return;
    }
    if (ruta === '/api/cancelar' && req.method === 'POST') {
      if (loteActivo) loteActivo.cancelar();
      return json(res, { ok: true });
    }

    // ---- estudio: conversacion con Nano Banana
    if (ruta === '/api/estudio/modelos' && req.method === 'GET') return json(res, MODELOS);
    if (ruta === '/api/estudio/nueva' && req.method === 'POST') return json(res, nuevaConversacion());
    if (ruta === '/api/estudio/enviar' && req.method === 'POST') {
      const body = await cuerpoJson(req);
      try {
        return json(res, await enviarEstudio(RAIZ, await claveGemini(), body));
      } catch (e) {
        return json(res, { error: String(e.message || e) }, 400);
      }
    }
    if (ruta === '/api/estudio/elegir' && req.method === 'POST') return json(res, await elegirEstudio(await cuerpoJson(req)));
    if (ruta === '/api/estudio/probar' && req.method === 'POST') return json(res, await probarClave(await claveGemini()));

    // ---- eventos SSE
    if (ruta === '/api/eventos') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': conectado\n\n');
      clientes.add(res);
      const latido = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 20000);
      req.on('close', () => { clearInterval(latido); clientes.delete(res); });
      return;
    }

    res.writeHead(404); res.end('no encontrado');
  } catch (e) {
    json(res, { error: String(e.message || e) }, 500);
  }
});

servidor.listen(PUERTO, '127.0.0.1', () => {
  console.log(`\n  Forja lista  ->  http://localhost:${PUERTO}\n  Carpeta: ${RAIZ}\n  (Ctrl+C para parar)\n`);
});

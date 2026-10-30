// Capa de proveedores. Anadir uno nuevo = anadir una entrada aqui.
import fs from 'node:fs/promises';
import path from 'node:path';
import { imagenPrueba } from './png.js';

export class ErrorProveedor extends Error {
  constructor(mensaje, { estado = 0, reintentar = false, esperar = 0 } = {}) {
    super(mensaje);
    this.estado = estado;
    this.reintentar = reintentar;
    this.esperar = esperar;
  }
}

const MIMES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
export const mimeDe = (p) => MIMES[path.extname(p).toLowerCase()] || 'image/png';

async function leerRef(ruta) {
  const datos = await fs.readFile(ruta);
  return { datos, mime: mimeDe(ruta), nombre: path.basename(ruta) };
}

/** Busca en profundidad la primera cadena base64 que parezca una imagen. */
export function extraerBase64(obj, prof = 0) {
  if (!obj || prof > 8) return null;
  if (typeof obj === 'string') {
    const s = obj.startsWith('data:') ? obj.slice(obj.indexOf(',') + 1) : obj;
    return s.length > 512 && /^[A-Za-z0-9+/=\s]+$/.test(s.slice(0, 256)) ? s.replace(/\s/g, '') : null;
  }
  if (Array.isArray(obj)) {
    for (const v of obj) {
      const r = extraerBase64(v, prof + 1);
      if (r) return r;
    }
    return null;
  }
  if (typeof obj === 'object') {
    for (const clave of ['b64_json', 'data', 'bytesBase64Encoded', 'image_bytes', 'imageBytes']) {
      if (typeof obj[clave] === 'string') {
        const r = extraerBase64(obj[clave], prof + 1);
        if (r) return r;
      }
    }
    for (const v of Object.values(obj)) {
      const r = extraerBase64(v, prof + 1);
      if (r) return r;
    }
  }
  return null;
}

function fallo(estado, texto) {
  const reintentar = estado === 429 || estado === 408 || estado >= 500;
  return new ErrorProveedor(`HTTP ${estado}: ${String(texto).slice(0, 400)}`, {
    estado,
    reintentar,
    esperar: estado === 429 ? 20000 : 3000,
  });
}

const TAM_OPENAI = {
  '1:1': '1024x1024', '4:5': '1024x1536', '2:3': '1024x1536', '9:16': '1024x1536',
  '3:2': '1536x1024', '16:9': '1536x1024', '4:3': '1536x1024', '3:4': '1024x1536',
};

// ---------------------------------------------------------------- Google Gemini
async function gemini({ modelo, apiKey, prompt, refs, opciones }) {
  if (!apiKey) throw new ErrorProveedor('Falta la clave de Google (GEMINI_API_KEY)');
  const imagenes = await Promise.all(refs.map(leerRef));
  const cuerpo = {
    model: modelo,
    input: [
      { type: 'text', text: prompt },
      ...imagenes.map((r) => ({ type: 'image', mime_type: r.mime, data: r.datos.toString('base64') })),
    ],
    response_format: {
      type: 'image',
      mime_type: opciones.formato === 'jpg' ? 'image/jpeg' : 'image/png',
      ...(opciones.aspecto ? { aspect_ratio: opciones.aspecto } : {}),
      ...(opciones.tamano ? { image_size: opciones.tamano } : {}),
    },
  };
  let r = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });

  // Compatibilidad: si el endpoint nuevo no existe, se usa el clasico generateContent
  if (r.status === 404 || r.status === 400) {
    const alt = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            ...imagenes.map((i) => ({ inline_data: { mime_type: i.mime, data: i.datos.toString('base64') } })),
          ],
        },
      ],
      generationConfig: {
        responseModalities: ['IMAGE'],
        ...(opciones.aspecto ? { imageConfig: { aspectRatio: opciones.aspecto } } : {}),
      },
    };
    const r2 = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`,
      { method: 'POST', headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(alt) }
    );
    if (r2.ok) r = r2;
  }

  if (!r.ok) throw fallo(r.status, await r.text());
  const json = await r.json();
  const b64 = extraerBase64(json);
  if (!b64) throw new ErrorProveedor('La respuesta no contiene imagen: ' + JSON.stringify(json).slice(0, 300));
  return { buffer: Buffer.from(b64, 'base64'), extension: opciones.formato === 'jpg' ? 'jpg' : 'png' };
}

// ---------------------------------------------------------------- OpenAI
async function openai({ modelo, apiKey, prompt, refs, opciones }) {
  if (!apiKey) throw new ErrorProveedor('Falta la clave de OpenAI (OPENAI_API_KEY)');
  const tamano = opciones.tamanoExacto || TAM_OPENAI[opciones.aspecto] || '1024x1024';
  const formato = opciones.formato === 'jpg' ? 'jpeg' : opciones.formato || 'png';
  let r;
  if (refs.length) {
    const fd = new FormData();
    fd.append('model', modelo);
    fd.append('prompt', prompt);
    fd.append('size', tamano);
    fd.append('output_format', formato);
    if (opciones.calidad) fd.append('quality', opciones.calidad);
    if (opciones.fidelidad) fd.append('input_fidelity', opciones.fidelidad);
    if (opciones.fondo) fd.append('background', opciones.fondo);
    for (const ruta of refs.slice(0, 16)) {
      const ref = await leerRef(ruta);
      fd.append('image', new Blob([ref.datos], { type: ref.mime }), ref.nombre);
    }
    r = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: fd,
    });
  } else {
    r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelo,
        prompt,
        n: 1,
        size: tamano,
        output_format: formato,
        ...(opciones.calidad ? { quality: opciones.calidad } : {}),
        ...(opciones.fondo ? { background: opciones.fondo } : {}),
      }),
    });
  }
  if (!r.ok) throw fallo(r.status, await r.text());
  const json = await r.json();
  const b64 = extraerBase64(json);
  if (!b64) throw new ErrorProveedor('La respuesta no contiene imagen: ' + JSON.stringify(json).slice(0, 300));
  return { buffer: Buffer.from(b64, 'base64'), extension: formato === 'jpeg' ? 'jpg' : formato };
}

// ---------------------------------------------------------------- OpenAI compatible (fal, together, local...)
async function compatible({ modelo, apiKey, prompt, opciones, base }) {
  if (!base) throw new ErrorProveedor('Falta la URL base del proveedor compatible');
  const r = await fetch(base.replace(/\/$/, '') + '/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelo,
      prompt,
      n: 1,
      size: opciones.tamanoExacto || TAM_OPENAI[opciones.aspecto] || '1024x1024',
      response_format: 'b64_json',
    }),
  });
  if (!r.ok) throw fallo(r.status, await r.text());
  const b64 = extraerBase64(await r.json());
  if (!b64) throw new ErrorProveedor('La respuesta no contiene imagen');
  return { buffer: Buffer.from(b64, 'base64'), extension: 'png' };
}

// ---------------------------------------------------------------- Prueba (sin API, sin coste)
async function prueba({ prompt, opciones }) {
  await new Promise((res) => setTimeout(res, 120 + Math.random() * 400));
  if (opciones.fallarPrueba && Math.random() < 0.25) {
    throw new ErrorProveedor('Fallo simulado', { estado: 500, reintentar: true, esperar: 200 });
  }
  const [a, b] = (opciones.aspecto || '3:2').split(':').map(Number);
  const ancho = 768;
  const alto = Math.round((ancho * (b || 2)) / (a || 3));
  return { buffer: imagenPrueba(prompt, ancho, alto), extension: 'png' };
}

export const PROVEEDORES = {
  gemini: { nombre: 'Google Gemini', fn: gemini, modelos: ['gemini-3.1-flash-image', 'gemini-3-pro-image', 'gemini-3.1-flash-lite-image', 'gemini-2.5-flash-image'], clave: 'GEMINI_API_KEY', refs: true },
  openai: { nombre: 'OpenAI', fn: openai, modelos: ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini'], clave: 'OPENAI_API_KEY', refs: true },
  compatible: { nombre: 'Compatible OpenAI (fal, Together, local...)', fn: compatible, modelos: [], clave: 'API_KEY', refs: false },
  prueba: { nombre: 'Prueba (sin coste, imagenes falsas)', fn: prueba, modelos: ['mock'], clave: null, refs: false },
};

export async function generar(cfg) {
  const p = PROVEEDORES[cfg.proveedor];
  if (!p) throw new ErrorProveedor(`Proveedor desconocido: ${cfg.proveedor}`);
  return p.fn(cfg);
}

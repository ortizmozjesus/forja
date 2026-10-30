// Estudio: conversacion con Nano Banana (Gemini) para editar y crear imagenes.
// Cada conversacion guarda el historial (texto + imagenes) y lo reenvia en cada turno,
// igual que el chat de Gemini: "ahora hazlo mas oscuro" funciona sobre el ultimo resultado.
import fs from 'node:fs/promises';
import path from 'node:path';
import { imagenPrueba } from './png.js';

const BASE = (process.env.FORJA_GEMINI_BASE || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
const RAPIDO = Boolean(process.env.FORJA_RAPIDO); // solo para tests: sin esperas largas

export const MODELOS = [
  { id: 'gemini-2.5-flash-image', nombre: 'Nano Banana (2.5 Flash)', precio: 0.039 },
  { id: 'gemini-3.1-flash-image', nombre: 'Nano Banana 2 (3.1 Flash)', precio: 0.067 },
  { id: 'gemini-3-pro-image', nombre: 'Nano Banana Pro (3 Pro)', precio: 0.134 },
  { id: 'mock', nombre: 'Prueba (sin coste, imágenes falsas)', precio: 0 },
];

const MAX_PETICION = 18e6;   // Gemini admite ~20 MB por peticion con imagenes en linea
const MAX_HISTORIAL = 12e6;  // por encima se olvidan los pasos mas antiguos
const MAX_TURNOS = 8;        // pares usuario/modelo que se recuerdan como maximo

const esperar = (ms) => new Promise((r) => setTimeout(r, RAPIDO ? 5 : ms));

class ErrorApi extends Error {
  constructor(mensaje, estado = 0, bruto = '') {
    super(mensaje);
    this.estado = estado;
    this.bruto = bruto;
  }
}

function explicar(estado, bruto) {
  let detalle = '';
  try { detalle = JSON.parse(bruto)?.error?.message || ''; } catch { /* no era JSON */ }
  const d = (detalle || String(bruto)).slice(0, 300);
  if (estado === 400 && /api key/i.test(d)) return `La clave de API no es válida. Revísala en «Claves API». (${d})`;
  if (estado === 401 || estado === 403) return `Google rechaza la clave o no tiene permiso para este modelo. Comprueba que es la clave del proyecto con facturación activada. (${d})`;
  if (estado === 402) return `Sin saldo en la API de Gemini: recarga créditos en aistudio.google.com/billing. (${d})`;
  if (estado === 404) return `Ese modelo no está disponible con tu clave. Prueba con otro. (${d})`;
  if (estado === 429) return `Demasiadas peticiones o cuota agotada. Espera un minuto y reintenta. (${d})`;
  if (estado >= 500) return `Fallo temporal de Google (${estado}). Reintenta en unos segundos. (${d})`;
  return `Error ${estado}: ${d}`;
}

async function llamarGemini({ modelo, clave, contents, aspecto, tamano }) {
  const generationConfig = { responseModalities: ['TEXT', 'IMAGE'] };
  const imageConfig = {};
  if (aspecto && aspecto !== 'auto') imageConfig.aspectRatio = aspecto;
  if (tamano && tamano !== 'auto' && !/2\.5/.test(modelo)) imageConfig.imageSize = tamano;
  if (Object.keys(imageConfig).length) generationConfig.imageConfig = imageConfig;
  const cuerpo = JSON.stringify({ contents, generationConfig });

  let ultimo = new ErrorApi('Sin respuesta de Google');
  for (let intento = 0; intento < 3; intento++) {
    let r;
    try {
      r = await fetch(`${BASE}/models/${encodeURIComponent(modelo)}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': clave, 'Content-Type': 'application/json' },
        body: cuerpo,
      });
    } catch (e) {
      ultimo = new ErrorApi(`No se pudo conectar con Google: ${e.message}`);
      await esperar(2000 * (intento + 1));
      continue;
    }
    if (r.ok) return r.json();
    const bruto = await r.text();
    ultimo = new ErrorApi(explicar(r.status, bruto), r.status, bruto);
    if (r.status === 429 || r.status >= 500) {
      await esperar(r.status === 429 ? 15000 : 3000 * (intento + 1));
      continue;
    }
    throw ultimo;
  }
  throw ultimo;
}

/** Saca de la respuesta de Gemini: partes a recordar, primera imagen y texto. */
function leerRespuesta(j) {
  const cand = j.candidates?.[0];
  const partes = (cand?.content?.parts || []).filter((p) => p.thought !== true);
  let imagen = null;
  const textos = [];
  for (const p of partes) {
    const d = p.inlineData || p.inline_data;
    if (d?.data) {
      if (!imagen) imagen = { b64: d.data, mime: d.mimeType || d.mime_type || 'image/png' };
    } else if (typeof p.text === 'string' && p.text.trim()) {
      textos.push(p.text.trim());
    }
  }
  const texto = textos.join('\n');
  if (!imagen && !texto) {
    const bloqueo = j.promptFeedback?.blockReason;
    const fin = cand?.finishReason;
    if (bloqueo) throw new ErrorApi(`Google ha bloqueado la petición (${bloqueo}). Prueba a reformular la instrucción o cambiar la imagen.`);
    throw new ErrorApi(`El modelo no devolvió ninguna imagen${fin && fin !== 'STOP' ? ` (motivo: ${fin})` : ''}.`);
  }
  return { partes, imagen, texto };
}

async function simulado({ texto, aspecto }) {
  await esperar(300 + Math.random() * 500);
  if (/\berror\b/i.test(texto)) throw new ErrorApi('Fallo simulado (has escrito «error» en la instrucción).');
  const [a, b] = (aspecto && aspecto !== 'auto' ? aspecto : '3:2').split(':').map(Number);
  const ancho = 768;
  const alto = Math.round((ancho * (b || 2)) / (a || 3));
  const b64 = imagenPrueba(texto, ancho, alto).toString('base64');
  const aviso = 'Imagen de prueba: no se ha llamado a Google.';
  return {
    partes: [{ text: aviso }, { inlineData: { mimeType: 'image/png', data: b64 } }],
    imagen: { b64, mime: 'image/png' },
    texto: aviso,
  };
}

// ------------------------------------------------------------------ conversaciones
const conversaciones = new Map();
const dos = (n) => String(n).padStart(2, '0');

function crear() {
  const f = new Date();
  const sello = `${f.getFullYear()}-${dos(f.getMonth() + 1)}-${dos(f.getDate())}_${dos(f.getHours())}-${dos(f.getMinutes())}-${dos(f.getSeconds())}`;
  const azar = Math.random().toString(36).slice(2, 6);
  const conv = {
    id: `${sello}-${azar}`,
    carpeta: `${sello}-${azar}`,
    historial: [],     // [{role, parts}] ya confirmados
    pendiente: null,   // turno con varias opciones aun sin elegir
    turno: 0,
    nImg: 0,           // imagenes adjuntadas por el usuario hasta ahora
    ultima: null,      // ultimo resultado elegido {mime, b64}
    registro: [],
  };
  conversaciones.set(conv.id, conv);
  return conv;
}

export function nuevaConversacion() {
  const c = crear();
  return { id: c.id, carpeta: c.carpeta };
}

const tamanoB64 = (hist) => hist.reduce((n, m) => n + m.parts.reduce((k, p) => k + ((p.inlineData || p.inline_data)?.data?.length || 0), 0), 0);

function podar(conv) {
  let olvidado = false;
  while (conv.historial.length > MAX_TURNOS * 2 || (conv.historial.length > 2 && tamanoB64(conv.historial) > MAX_HISTORIAL)) {
    conv.historial.splice(0, 2);
    olvidado = true;
  }
  if (olvidado) conv.nota = 'Para no pasar el límite de tamaño, Nano Banana ya no recuerda los primeros pasos de esta conversación.';
}

function confirmar(conv, elegido) {
  const p = conv.pendiente;
  if (!p) return;
  conv.pendiente = null;
  const c = (elegido != null && p.candidatos[elegido] && !p.candidatos[elegido].error)
    ? p.candidatos[elegido]
    : p.candidatos.find((x) => !x.error);
  if (!c) return;
  conv.historial.push({ role: 'user', parts: p.partesUsuario }, { role: 'model', parts: c.partes });
  if (c.imagen) conv.ultima = { mime: c.imagen.mime, b64: c.imagen.b64 };
  const reg = conv.registro.find((x) => x.turno === p.turno);
  if (reg) reg.elegido = c.archivo || null;
  podar(conv);
}

const extDe = (mime) => (/jpe?g/.test(mime) ? 'jpg' : /webp/.test(mime) ? 'webp' : 'png');

async function generarUno({ conv, modelo, clave, contents, partesUsuario, texto, aspecto, tamano }) {
  if (modelo === 'mock') return simulado({ texto, aspecto });
  try {
    return leerRespuesta(await llamarGemini({ modelo, clave, contents, aspecto, tamano }));
  } catch (e) {
    // Si el historial da problemas (p. ej. firmas de razonamiento), reintenta sin historial,
    // usando el ultimo resultado como imagen base.
    const recuperable = e instanceof ErrorApi && e.estado === 400 && !/api key/i.test(e.bruto) && conv.historial.length;
    if (!recuperable) throw e;
    const parts = [];
    if (conv.ultima) {
      parts.push({ text: 'Imagen base (resultado anterior):' }, { inlineData: { mimeType: conv.ultima.mime, data: conv.ultima.b64 } });
    }
    parts.push(...partesUsuario);
    const r = leerRespuesta(await llamarGemini({ modelo, clave, contents: [{ role: 'user', parts }], aspecto, tamano }));
    r.simplificado = true;
    return r;
  }
}

/**
 * Un turno de la conversacion.
 * b = { id, texto, imagenes:[{nombre, datos(dataURL)}], modelo, aspecto, tamano, n }
 */
export async function enviar(raiz, clave, b) {
  const modelo = String(b.modelo || 'gemini-3.1-flash-image');
  if (!MODELOS.some((m) => m.id === modelo)) throw new Error(`Modelo desconocido: ${modelo}`);
  const texto = String(b.texto || '').trim();
  if (!texto) throw new Error('Escribe qué quieres hacer con las imágenes.');
  if (modelo !== 'mock' && !clave) throw new Error('Falta la clave de Gemini: pulsa «Claves API» arriba a la derecha.');
  const n = Math.min(4, Math.max(1, Number(b.n) || 1));

  const entrada = [];
  for (const img of (Array.isArray(b.imagenes) ? b.imagenes : []).slice(0, 8)) {
    const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(img.datos || ''));
    if (!m) throw new Error(`La imagen «${img.nombre || 'sin nombre'}» no es PNG, JPG o WebP.`);
    entrada.push({ mime: m[1], b64: m[2], nombre: String(img.nombre || '').slice(0, 60) });
  }

  let conv = b.id && conversaciones.get(b.id);
  if (!conv) {
    conv = crear();
    if (b.id) conv.nota = 'Forja se reinició desde el último mensaje: esta conversación empieza de cero y Nano Banana ya no recuerda lo anterior. Adjunta de nuevo la imagen que quieras seguir editando.';
  }
  confirmar(conv, null); // si habia opciones sin elegir, sigue con la primera valida

  const nImgAntes = conv.nImg;
  const dir = path.join(raiz, 'salidas', 'estudio', conv.carpeta);
  conv.dir = dir;
  await fs.mkdir(path.join(dir, 'entradas'), { recursive: true });

  const partesUsuario = [];
  const entradas = [];
  for (const e of entrada) {
    conv.nImg += 1;
    const archivo = `imagen-${dos(conv.nImg)}.${extDe(e.mime)}`;
    await fs.writeFile(path.join(dir, 'entradas', archivo), Buffer.from(e.b64, 'base64'));
    entradas.push({ numero: conv.nImg, archivo });
    partesUsuario.push({ text: `Imagen ${conv.nImg}${e.nombre ? ` (${e.nombre})` : ''}:` }, { inlineData: { mimeType: e.mime, data: e.b64 } });
  }
  partesUsuario.push({ text: texto });

  const contents = [...conv.historial, { role: 'user', parts: partesUsuario }];
  const peso = contents.reduce((k, m) => k + m.parts.reduce((s, p) => s + ((p.inlineData || p.inline_data)?.data?.length || 0), 0), 0);
  if (peso > MAX_PETICION) {
    conv.nImg = nImgAntes;
    throw new Error('Las imágenes pesan demasiado para una sola petición (límite ~20 MB). Adjunta menos imágenes o más pequeñas, o empieza una conversación nueva.');
  }

  const turno = conv.turno + 1;
  const resultados = await Promise.all(
    Array.from({ length: n }, () =>
      generarUno({ conv, modelo, clave, contents, partesUsuario, texto, aspecto: b.aspecto, tamano: b.tamano })
        .catch((e) => ({ error: String(e.message || e) })))
  );

  const letras = 'abcd';
  const candidatos = [];
  for (let i = 0; i < resultados.length; i++) {
    const r = resultados[i];
    if (r.imagen) {
      r.archivo = `${dos(turno)}${n > 1 ? letras[i] : ''}.${extDe(r.imagen.mime)}`;
      await fs.writeFile(path.join(dir, r.archivo), Buffer.from(r.imagen.b64, 'base64'));
    }
    candidatos.push(r);
  }

  const buenos = candidatos.filter((c) => !c.error);
  if (!buenos.length) {
    conv.nImg = nImgAntes; // el turno fallo del todo: no cuenta, se puede reintentar
  } else {
    conv.turno = turno;
    conv.pendiente = { turno, partesUsuario, candidatos };
    conv.registro.push({
      turno, modelo, texto, entradas,
      resultados: candidatos.map((c) => ({ archivo: c.archivo || null, texto: c.texto || null, error: c.error || null })),
    });
    if (buenos.length === 1) confirmar(conv, candidatos.indexOf(buenos[0]));
    await fs.writeFile(path.join(dir, 'conversacion.json'), JSON.stringify(conv.registro, null, 2));
  }

  const nota = conv.nota || null;
  conv.nota = null;
  return {
    id: conv.id,
    carpeta: `salidas/estudio/${conv.carpeta}`,
    turno,
    nImg: conv.nImg,
    entradas,
    pendiente: Boolean(conv.pendiente),
    nota,
    candidatos: candidatos.map((c) => ({
      url: c.archivo ? `/salidas/estudio/${conv.carpeta}/${c.archivo}` : null,
      texto: c.texto || '',
      error: c.error || null,
      simplificado: Boolean(c.simplificado),
    })),
  };
}

/** El usuario elige cual de las opciones de un turno quiere continuar. */
export async function elegir(b) {
  const conv = conversaciones.get(b.id);
  if (!conv?.pendiente || conv.pendiente.turno !== Number(b.turno)) return { ok: false };
  confirmar(conv, Number(b.candidato));
  if (conv.dir) await fs.writeFile(path.join(conv.dir, 'conversacion.json'), JSON.stringify(conv.registro, null, 2)).catch(() => {});
  return { ok: true };
}

/** Comprueba la clave consultando la lista de modelos (no cuesta nada). */
export async function probar(clave) {
  if (!clave) return { ok: false, mensaje: 'Todavía no hay ninguna clave de Gemini guardada.' };
  try {
    const ids = [];
    let pagina = '';
    for (let i = 0; i < 6; i++) {
      const r = await fetch(`${BASE}/models?pageSize=200${pagina ? `&pageToken=${encodeURIComponent(pagina)}` : ''}`, { headers: { 'x-goog-api-key': clave } });
      if (!r.ok) return { ok: false, mensaje: explicar(r.status, await r.text()) };
      const j = await r.json();
      for (const m of j.models || []) ids.push(String(m.name).replace(/^models\//, ''));
      pagina = j.nextPageToken || '';
      if (!pagina) break;
    }
    const imagen = ids.filter((id) => /image/i.test(id));
    return {
      ok: true,
      modelos: imagen,
      mensaje: (imagen.length
        ? `La clave es válida. Modelos de imagen que ve tu cuenta: ${imagen.join(', ')}.`
        : 'La clave es válida, pero no veo modelos de imagen en tu cuenta.')
        + ' El saldo no se puede comprobar desde aquí: se nota al generar la primera imagen.',
    };
  } catch (e) {
    return { ok: false, mensaje: `No se pudo conectar con Google: ${e.message}` };
  }
}

// Exportar un lote como sesion manual: imagenes ordenadas + prompts listos para pegar
// en Nano Banana (app de Gemini / AI Studio), sin usar la API.
import fs from 'node:fs/promises';
import path from 'node:path';
import { preparar } from './motor.js';
import { ordenarReferencias, slug } from './plantilla.js';

const ORIENTACION = {
  '1:1': 'cuadrada', '3:2': 'apaisada', '16:9': 'apaisada panorámica',
  '4:3': 'apaisada', '2:3': 'vertical', '9:16': 'vertical alargada', '3:4': 'vertical',
};

/** Anade a un prompt lo que en la API van como parametros y en el chat hay que decir. */
export function promptParaChat(prompt, receta) {
  const o = receta.opciones || {};
  const partes = [prompt.trim()];
  const orient = ORIENTACION[o.aspecto];
  if (o.aspecto) partes.push(`Formato de salida: imagen ${orient || ''} de proporción ${o.aspecto}, la máxima resolución posible, sin texto, logotipos ni marcas de agua.`);
  return partes.join('\n\n');
}

/** Extrae la parte que cambia entre prompts, para verla de un vistazo. */
export function resumenTarea(prompt) {
  const m = prompt.match(/Tarea:\s*([\s\S]*?)(?:\n\n|$)/);
  const t = (m ? m[1] : prompt).replace(/\s+/g, ' ').trim();
  return t.length > 220 ? t.slice(0, 217) + '…' : t;
}

export async function exportarManual(receta, raiz) {
  const trabajos = preparar(receta, raiz);
  if (!trabajos.length) throw new Error('La plantilla no genera ningún prompt.');

  const nombreLote = slug(receta.nombre || 'lote');
  const carpeta = path.join(raiz, 'salidas', `${nombreLote}-nano-banana`);
  await fs.mkdir(carpeta, { recursive: true });

  // --- referencias, copiadas y renombradas por orden de uso
  const { alias } = ordenarReferencias(receta.referencias || {});
  const refs = [];
  for (const [i, a] of alias.entries()) {
    const def = receta.referencias[a];
    const origen = path.isAbsolute(def.ruta) ? def.ruta : path.join(raiz, def.ruta);
    const ext = path.extname(origen) || '.png';
    const destino = `${i + 1}-${def.rol || 'ref'}-${slug(a, 30)}${ext}`;
    try {
      await fs.copyFile(origen, path.join(carpeta, destino));
      refs.push({ orden: i + 1, alias: a, rol: def.rol || 'otra', archivo: destino });
    } catch {}
  }

  // --- prompts agrupados (las variantes repiten el mismo texto)
  const mapa = new Map();
  for (const t of trabajos) {
    const texto = promptParaChat(t.prompt, receta);
    const g = mapa.get(texto) || { prompt: texto, veces: 0, referencias: t.referencias, etiqueta: '' };
    g.veces++;
    if (!g.etiqueta) g.etiqueta = Object.values(t.combo).join(' · ') || `imagen ${t.n}`;
    mapa.set(texto, g);
  }
  const grupos = [...mapa.values()].map((g, i) => ({ ...g, n: i + 1, tarea: resumenTarea(g.prompt) }));

  // --- archivos de apoyo
  const txt = grupos
    .map((g) => `${'='.repeat(70)}\n[${g.n}/${grupos.length}] ${g.etiqueta}${g.veces > 1 ? `  (pídelo ${g.veces} veces)` : ''}\n${'='.repeat(70)}\n\n${g.prompt}\n`)
    .join('\n');
  await fs.writeFile(path.join(carpeta, 'prompts.txt'), txt, 'utf8');

  const pasos = `SESIÓN MANUAL EN NANO BANANA
${'-'.repeat(60)}

1. Abre la app de Gemini (gemini.google.com) o Google AI Studio y elige el
   modelo de imagen (Nano Banana / Gemini Image).

2. Adjunta las imágenes de esta carpeta EN ESTE ORDEN:
${refs.map((r) => `     ${r.orden}. ${r.archivo}   (${r.rol})`).join('\n') || '     (ninguna)'}

3. Pega el primer prompt de prompts.txt y envía.

4. Para el siguiente encuadre o variante, sigue en la MISMA conversación:
   el modelo mantiene el contexto y las imágenes ya adjuntas, así que solo
   tienes que pegar el prompt siguiente.

5. Descarga los resultados en esta misma carpeta para tenerlo todo junto.

Total de prompts distintos: ${grupos.length}
Total de imágenes previstas: ${trabajos.length}
`;
  await fs.writeFile(path.join(carpeta, 'LEEME.txt'), pasos, 'utf8');

  const carpetaRel = path.relative(raiz, carpeta).split(path.sep).join('/');
  return {
    carpeta,
    carpetaRel,
    total: trabajos.length,
    refs: refs.map((r) => ({ ...r, url: `/${carpetaRel}/${encodeURIComponent(r.archivo)}` })),
    grupos,
  };
}

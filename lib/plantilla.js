// Expansion de plantillas: variables {{x}}, alternativas [a|b|c] y referencias @nombre

const RE_ALT = /\[([^\[\]\n]*\|[^\[\]\n]*)\]/g;
const RE_VAR = /\{\{\s*([\wáéíóúüñÁÉÍÓÚÑ.-]+)\s*\}\}/g;
const RE_REF = /@([\wáéíóúüñÁÉÍÓÚÑ-]+)/g;

/** Convierte [a|b|c] en variables anonimas _alt1, _alt2... */
export function extraerAlternativas(plantilla) {
  const grupos = [];
  let idx = 0;
  const base = String(plantilla || '').replace(RE_ALT, (_m, cuerpo) => {
    const nombre = `_alt${++idx}`;
    grupos.push({
      nombre,
      opciones: cuerpo.split('|').map((s) => s.trim()).filter((s) => s.length),
    });
    return `{{${nombre}}}`;
  });
  return { base, grupos: grupos.filter((g) => g.opciones.length > 0) };
}

export function variablesUsadas(texto) {
  const set = new Set();
  let m;
  RE_VAR.lastIndex = 0;
  while ((m = RE_VAR.exec(texto)) !== null) set.add(m[1]);
  return [...set];
}

export function referenciasUsadas(texto) {
  const set = new Set();
  let m;
  RE_REF.lastIndex = 0;
  while ((m = RE_REF.exec(texto)) !== null) set.add(m[1]);
  return [...set];
}

/** Producto cartesiano de dimensiones [{nombre, opciones:[...]}] */
export function producto(dims) {
  return dims.reduce(
    (acc, d) => acc.flatMap((combo) => d.opciones.map((v) => ({ ...combo, [d.nombre]: v }))),
    [{}]
  );
}

export function sustituir(texto, combo) {
  return String(texto).replace(RE_VAR, (m, nombre) =>
    Object.prototype.hasOwnProperty.call(combo, nombre) ? String(combo[nombre]) : m
  );
}

/**
 * Resuelve los @nombre del prompt: los sustituye por su descripcion (si la tiene)
 * y devuelve la lista de referencias usadas.
 */
export function resolverReferencias(texto, referencias = {}, numeracion = null) {
  const usadas = [];
  const salida = texto.replace(RE_REF, (m, nombre) => {
    const clave = Object.keys(referencias).find(
      (k) => k.toLowerCase() === String(nombre).toLowerCase()
    );
    if (!clave) return m; // no existe: se deja el texto tal cual
    if (!usadas.includes(clave)) usadas.push(clave);
    if (numeracion && numeracion[clave]) return `la imagen ${numeracion[clave]} ("${clave}")`;
    const desc = referencias[clave]?.descripcion;
    return desc ? desc : `la imagen de referencia "${clave}"`;
  });
  return { texto: limpiar(salida), referencias: usadas };
}

// ---------------------------------------------------------------- modo composicion
const ORDEN_ROLES = ['base', 'objeto', 'material', 'estilo', 'otra'];

export const FRASES_ROL = {
  base: (n, a) =>
    `La imagen ${n} ("${a}") es la fotografía base de la escena real: conserva su encuadre, punto de vista, distancia focal, escala y condiciones de luz.`,
  objeto: (n, a) =>
    `La imagen ${n} ("${a}") muestra el elemento que hay que integrar en esa escena: respeta su geometría, proporciones, color y materiales reales.`,
  material: (n, a) =>
    `La imagen ${n} ("${a}") es la referencia de material y textura: aplícala solo a las superficies que se indiquen.`,
  estilo: (n, a) =>
    `La imagen ${n} ("${a}") es la referencia de acabado y atmósfera: toma de ella el ambiente, la paleta y el tratamiento, no su geometría ni su encuadre.`,
  otra: (n, a) => `La imagen ${n} ("${a}") es una referencia de apoyo.`,
};

/** Ordena los alias de referencia por rol (base primero) y numera desde 1. */
export function ordenarReferencias(referencias = {}) {
  const alias = Object.keys(referencias);
  alias.sort((a, b) => {
    const ra = ORDEN_ROLES.indexOf(referencias[a]?.rol || 'otra');
    const rb = ORDEN_ROLES.indexOf(referencias[b]?.rol || 'otra');
    return (ra < 0 ? 9 : ra) - (rb < 0 ? 9 : rb);
  });
  const numeracion = Object.fromEntries(alias.map((a, i) => [a, i + 1]));
  return { alias, numeracion };
}

export function limpiar(t) {
  return String(t)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/,\s*,/g, ',')
    .trim();
}

export function slug(t, max = 48) {
  return String(t)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max) || 'x';
}

/**
 * Construye la lista completa de trabajos a partir de una receta.
 * receta: { plantilla, sufijo, variables:{k:[v]}, filas:[{}], referencias:{}, refsGlobales:[],
 *           variantes, patronNombre }
 */
export function construirTrabajos(receta) {
  const plantillaCompleta = [receta.plantilla || '', receta.sufijo || '']
    .filter((s) => String(s).trim().length)
    .join(', ');
  const { base, grupos } = extraerAlternativas(plantillaCompleta);
  const usadas = variablesUsadas(base);

  let combos;
  if (Array.isArray(receta.filas) && receta.filas.length) {
    // Modo tabla: cada fila es una combinacion; las alternativas siguen multiplicando
    combos = receta.filas.flatMap((fila) =>
      producto(grupos).map((alt) => ({ ...fila, ...alt }))
    );
  } else {
    const dims = [];
    for (const [nombre, valores] of Object.entries(receta.variables || {})) {
      const ops = (Array.isArray(valores) ? valores : String(valores).split(','))
        .map((v) => String(v).trim())
        .filter((v) => v.length);
      if (ops.length && usadas.includes(nombre)) dims.push({ nombre, opciones: ops });
    }
    combos = producto([...dims, ...grupos]);
  }

  const variantes = Math.max(1, Number(receta.variantes) || 1);
  const patron = receta.patronNombre || '{{indice}}-{{resumen}}';
  const fecha = new Date().toISOString().slice(0, 10);
  const trabajos = [];
  let n = 0;

  const composicion = receta.modo === 'composicion';
  const { alias: aliasOrden, numeracion } = ordenarReferencias(receta.referencias || {});

  for (const combo of combos) {
    const prompt0 = sustituir(base, combo);
    const { texto: promptUsuario, referencias: refsPrompt } = resolverReferencias(
      prompt0,
      receta.referencias || {},
      composicion ? numeracion : null
    );
    const refs = composicion
      ? aliasOrden
      : [...new Set([...(receta.refsGlobales || []), ...refsPrompt])];
    let prompt = promptUsuario;
    if (composicion && refs.length) {
      const cabecera = refs
        .map((a, i) => (FRASES_ROL[receta.referencias[a]?.rol] || FRASES_ROL.otra)(i + 1, a))
        .join(' ');
      const conservar = receta.conservar && String(receta.conservar).trim()
        ? ` No modifiques: ${sustituir(receta.conservar, combo).trim().replace(/[.\s]+$/, '')}.`
        : '';
      const cierre = receta.intacto === false
        ? ''
        : ' Mantén el resto de la escena exactamente igual que en la fotografía base.';
      prompt = `Trabajas con ${refs.length} ${refs.length === 1 ? 'imagen adjunta' : 'imágenes adjuntas'}, en este orden. ${cabecera}\n\nTarea: ${promptUsuario.replace(/[\s.]+$/, '')}.${conservar}\n\nDevuelve una sola imagen fotorrealista: integra el elemento con perspectiva, escala, sombras y reflejos coherentes con la fotografía base.${cierre}`;
    }
    const leyenda =
      !composicion && refs.length > 1 && receta.leyendaRefs !== false
        ? `Imágenes de referencia adjuntas, en este orden: ${refs.map((r, i) => `${i + 1}) "${r}"`).join(', ')}.`
        : '';
    for (let v = 1; v <= variantes; v++) {
      n++;
      const ctx = {
        ...combo,
        indice: String(n).padStart(3, '0'),
        variante: String(v),
        v: String(v),
        fecha,
        resumen: slug(Object.values(combo).join('-') || prompt, 40),
      };
      const nombre = slug(sustituir(patron, ctx).replace(RE_VAR, ''), 90);
      trabajos.push({
        id: `t${n}`,
        n,
        prompt: leyenda ? `${prompt.replace(/[\s.,;]+$/, '')}. ${leyenda}` : prompt,
        combo,
        variante: v,
        referencias: refs,
        nombre,
      });
    }
  }
  return trabajos;
}

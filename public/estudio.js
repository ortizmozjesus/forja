// Forja · Estudio — interfaz de conversacion para editar y crear imagenes.
const $ = (s) => document.querySelector(s);

function el(tag, props = {}, ...hijos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'clase') e.className = v;
    else if (k === 'texto') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) e.setAttribute(k, v);
  }
  for (const h of hijos.flat()) if (h) e.append(h);
  return e;
}

const estado = {
  id: null,
  adjuntos: [],      // [{nombre, datos}] pendientes de enviar
  nImg: 0,           // imagenes adjuntadas ya en la conversacion (numera "Imagen N")
  enviando: false,
  preparando: new Set(), // imagenes que aun se estan procesando (reducir/convertir)
  modelos: [],
  imagenes: 0,       // imagenes generadas en esta sesion
  gasto: 0,
  ultimo: null,      // ultimo envio, por si hay que reintentar
};

const pref = {
  leer(k, def) { try { return localStorage.getItem('forja.' + k) ?? def; } catch { return def; } },
  guardar(k, v) { try { localStorage.setItem('forja.' + k, v); } catch { /* sin almacenamiento */ } },
};

const dinero = (n) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' $';

async function api(ruta, cuerpo) {
  const r = await fetch(ruta, cuerpo === undefined
    ? undefined
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  let datos = {};
  try { datos = await r.json(); } catch { /* sin cuerpo */ }
  if (!r.ok) throw new Error(datos.error || `Error ${r.status}`);
  return datos;
}

// ------------------------------------------------------------------ imagenes
const TIPOS_OK = /^image\/(png|jpeg|webp)$/;
const leerDataUrl = (f) => new Promise((ok, ko) => {
  const r = new FileReader();
  r.onload = () => ok(r.result);
  r.onerror = () => ko(new Error('No se pudo leer ' + f.name));
  r.readAsDataURL(f);
});

/** Reduce fotos enormes (max 2048 px) y convierte formatos raros, para no pasar el limite de la API. */
async function preparar(file) {
  const MAX = 2048;
  let bmp = null;
  try { bmp = await createImageBitmap(file); } catch { /* formato no decodificable */ }
  if (!bmp) {
    if (TIPOS_OK.test(file.type)) return leerDataUrl(file);
    throw new Error(`No puedo leer «${file.name}». Usa PNG, JPG o WebP.`);
  }
  const lado = Math.max(bmp.width, bmp.height);
  if (TIPOS_OK.test(file.type) && lado <= MAX && file.size < 4e6) { bmp.close?.(); return leerDataUrl(file); }
  const k = Math.min(1, MAX / lado);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c.toDataURL('image/jpeg', 0.92);
}

const nombreLimpio = (f) => {
  const n = (f.name || '').replace(/\.[^.]+$/, '');
  return !n || /^image(\s*\(\d+\))?$/i.test(n) ? '' : n.slice(0, 40);
};

function anadirArchivos(files) {
  const trabajo = (async () => {
    const lista = [...files].filter((f) => f.type.startsWith('image/'));
    for (const f of lista) {
      if (estado.adjuntos.length >= 8) { alert('Máximo 8 imágenes por mensaje.'); break; }
      try { estado.adjuntos.push({ nombre: nombreLimpio(f), datos: await preparar(f) }); }
      catch (e) { alert(e.message); }
      pintarBandeja();
    }
    $('#texto').focus();
  })();
  estado.preparando.add(trabajo);
  trabajo.finally(() => estado.preparando.delete(trabajo));
  return trabajo;
}

function pintarBandeja() {
  const b = $('#bandeja');
  b.replaceChildren(...estado.adjuntos.map((a, i) => el('div', { clase: 'it' },
    el('img', { src: a.datos, alt: '' }),
    el('span', { clase: 'num', texto: `Imagen ${estado.nImg + i + 1}` }),
    el('button', { clase: 'quitar', title: 'Quitar', texto: '×', onclick: () => { estado.adjuntos.splice(i, 1); pintarBandeja(); } }),
  )));
}

// ------------------------------------------------------------------ hilo
function desplazar() { window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); }

function zoom(src) {
  $('#zoomImg').src = src;
  $('#dlgZoom').showModal();
}

function pintarUsuario(texto, adjuntos, desde) {
  const minis = adjuntos.length
    ? el('div', { clase: 'minis' }, adjuntos.map((a, i) => el('div', { clase: 'mini', onclick: () => zoom(a.datos) },
      el('img', { src: a.datos, alt: '' }), el('span', { clase: 'num', texto: `Imagen ${desde + i + 1}` }))))
    : null;
  const m = el('div', { clase: 'msg yo' }, el('div', { clase: 'burbuja' }, minis, el('p', { texto })));
  $('#hilo').append(m);
  return m;
}

async function usarComoReferencia(url) {
  try {
    const blob = await (await fetch(url)).blob();
    const datos = await leerDataUrl(new File([blob], 'resultado', { type: blob.type }));
    estado.adjuntos.push({ nombre: 'resultado', datos });
    pintarBandeja();
    $('#texto').focus();
  } catch (e) { alert('No se pudo adjuntar: ' + e.message); }
}

async function elegir(turno, i, tarjetas, pista) {
  try {
    await api('/api/estudio/elegir', { id: estado.id, turno, candidato: i });
    pista?.remove();
    tarjetas.forEach((t, k) => {
      t.classList.toggle('elegida', k === i);
      t.querySelectorAll('.seguir').forEach((b) => { b.disabled = true; b.textContent = k === i ? 'Seguimos con esta' : 'Descartada'; });
    });
  } catch (e) { alert(e.message); }
}

function pintarResultados(contenedor, r, n, pista) {
  const turno = r.turno;
  const tarjetas = [];
  contenedor.className = `resultados n${Math.min(n, 4)}`;
  r.candidatos.forEach((c, i) => {
    let t;
    if (c.error && !c.url) {
      t = el('div', { clase: 'res fallo' }, el('div', { texto: c.error }));
    } else {
      const botones = el('div', { clase: 'botones' });
      if (c.url) {
        if (r.pendiente) botones.append(el('button', { clase: 'seguir', texto: 'Seguir con esta', onclick: () => elegir(turno, i, tarjetas, pista) }));
        botones.append(
          el('a', { href: c.url, download: '', texto: 'Descargar' }),
          el('button', { texto: 'Usar como referencia', onclick: () => usarComoReferencia(c.url) }),
        );
      }
      t = el('div', { clase: 'res' },
        c.url ? el('img', { src: c.url, alt: 'Resultado', onclick: () => zoom(c.url) }) : null,
        el('div', { clase: 'pie' },
          c.texto ? el('p', { clase: 'texto', texto: c.texto }) : null,
          c.simplificado ? el('div', { clase: 'sutil', texto: 'Esta vez se envió solo la última imagen y tu instrucción, sin el resto del historial.' }) : null,
          botones));
    }
    tarjetas.push(t);
  });
  contenedor.replaceChildren(...tarjetas);
}

// ------------------------------------------------------------------ enviar
function precioModelo() { return estado.modelos.find((m) => m.id === $('#modelo').value)?.precio ?? 0; }

function pintarCoste() {
  const n = Number($('#n').value);
  const p = precioModelo();
  $('#estimado').textContent = p ? `≈ ${dinero(p * n)} por envío` : 'sin coste';
  $('#coste').textContent = estado.imagenes ? `Esta sesión: ${estado.imagenes} imágenes · ≈ ${dinero(estado.gasto)}` : '';
}

async function enviar(reenvio) {
  if (estado.enviando) return;
  if (!reenvio && estado.preparando.size) await Promise.all([...estado.preparando]); // espera a las imagenes en proceso
  if (estado.enviando) return;
  const datos = reenvio || {
    texto: $('#texto').value.trim(),
    adjuntos: estado.adjuntos.slice(),
  };
  if (!datos.texto) { $('#texto').focus(); return; }
  const n = Number($('#n').value);
  estado.enviando = true;
  $('#btnEnviar').disabled = true;
  $('#vacio')?.remove();

  const desde = estado.nImg;
  pintarUsuario(datos.texto, datos.adjuntos, desde);
  const contenedor = el('div', { clase: `resultados n${n}` },
    Array.from({ length: n }, () => el('div', { clase: 'res espera', texto: 'Generando…' })));
  const bloque = el('div', { clase: 'msg' }, contenedor);
  $('#hilo').append(bloque);
  $('#texto').value = '';
  estado.adjuntos = [];
  pintarBandeja();
  autoAltura();
  desplazar();

  try {
    const r = await api('/api/estudio/enviar', {
      id: estado.id,
      texto: datos.texto,
      imagenes: datos.adjuntos,
      modelo: $('#modelo').value,
      aspecto: $('#aspecto').value,
      tamano: $('#tamano').value,
      n,
    });
    estado.id = r.id;
    estado.nImg = r.nImg;
    const buenas = r.candidatos.filter((c) => c.url).length;
    estado.imagenes += buenas;
    estado.gasto += buenas * precioModelo();
    const pista = r.pendiente ? el('div', { clase: 'sutil', texto: 'Elige con cuál seguir. Si escribes otra cosa sin elegir, seguiré con la primera.' }) : null;
    pintarResultados(contenedor, r, n, pista);
    if (r.nota) bloque.append(el('div', { clase: 'nota', texto: r.nota }));
    if (r.candidatos.length && r.candidatos.every((c) => c.error && !c.url)) {
      bloque.append(el('div', { clase: 'botones' },
        el('button', { texto: 'Reintentar', onclick: () => { bloque.remove(); retroceder(datos); } })));
    } else if (pista) {
      bloque.append(pista);
    }
    if (buenas) bloque.append(el('div', { clase: 'sutil', texto: `Guardado en ${r.carpeta}` }));
  } catch (e) {
    contenedor.className = 'resultados n1';
    contenedor.replaceChildren(el('div', { clase: 'res fallo' },
      el('div', { texto: e.message }),
      el('button', { texto: 'Reintentar', onclick: () => { bloque.remove(); retroceder(datos); } })));
  } finally {
    estado.enviando = false;
    $('#btnEnviar').disabled = false;
    pintarBandeja();
    pintarCoste();
    desplazar();
  }
}

/** Quita del hilo el mensaje fallido y devuelve texto e imagenes al cuadro de envio. */
function retroceder(datos) {
  const msgs = $('#hilo').querySelectorAll('.msg.yo');
  msgs[msgs.length - 1]?.remove();
  $('#texto').value = datos.texto;
  estado.adjuntos = datos.adjuntos.slice();
  pintarBandeja();
  autoAltura();
  $('#texto').focus();
}

// ------------------------------------------------------------------ interfaz
function autoAltura() {
  const t = $('#texto');
  t.style.height = 'auto';
  t.style.height = Math.min(200, t.scrollHeight) + 'px';
}

let plantillaVacio = null;

async function nueva() {
  const r = await api('/api/estudio/nueva', {});
  estado.id = r.id;
  estado.nImg = 0;
  estado.adjuntos = [];
  pintarBandeja();
  $('#hilo').replaceChildren(plantillaVacio.cloneNode(true));
}

async function estadoClave() {
  const e = await api('/api/estado');
  const hay = Boolean(e.claves?.gemini);
  $('#avisoClave').classList.toggle('oculto', hay || $('#modelo').value === 'mock');
  return hay;
}

async function iniciar() {
  plantillaVacio = $('#vacio').cloneNode(true);
  estado.modelos = await api('/api/estudio/modelos');
  const sel = $('#modelo');
  sel.replaceChildren(...estado.modelos.map((m) => el('option', { value: m.id, texto: m.precio ? `${m.nombre} · ≈ ${dinero(m.precio)}/imagen` : m.nombre })));
  sel.value = estado.modelos.some((m) => m.id === pref.leer('modelo', '')) ? pref.leer('modelo', '') : 'gemini-3.1-flash-image';
  for (const [id, clave] of [['aspecto', 'aspecto'], ['tamano', 'tamano'], ['n', 'n']]) {
    const v = pref.leer(clave, '');
    if (v && [...$('#' + id).options].some((o) => o.value === v)) $('#' + id).value = v;
    $('#' + id).addEventListener('change', () => { pref.guardar(clave, $('#' + id).value); pintarCoste(); });
  }
  sel.addEventListener('change', () => { pref.guardar('modelo', sel.value); pintarCoste(); estadoClave(); });

  estado.id = (await api('/api/estudio/nueva', {})).id;
  await estadoClave();
  pintarCoste();

  $('#btnEnviar').addEventListener('click', () => enviar());
  $('#texto').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); enviar(); }
  });
  $('#texto').addEventListener('input', autoAltura);
  $('#btnAdjuntar').addEventListener('click', () => $('#archivos').click());
  $('#archivos').addEventListener('change', async (e) => { await anadirArchivos(e.target.files); e.target.value = ''; });
  $('#btnNueva').addEventListener('click', nueva);
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.ejemplo');
    if (b) { $('#texto').value = b.dataset.t; autoAltura(); $('#texto').focus(); }
  });

  // pegar imagenes con Ctrl+V
  window.addEventListener('paste', (e) => {
    const fs = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (fs.length) { e.preventDefault(); anadirArchivos(fs); }
  });
  // arrastrar y soltar en toda la pagina
  let nivel = 0;
  const hayArchivos = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (hayArchivos(e)) { nivel++; $('#capaSoltar').classList.remove('oculto'); } });
  window.addEventListener('dragleave', (e) => { if (hayArchivos(e) && --nivel <= 0) { nivel = 0; $('#capaSoltar').classList.add('oculto'); } });
  window.addEventListener('dragover', (e) => { if (hayArchivos(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!hayArchivos(e)) return;
    e.preventDefault(); nivel = 0; $('#capaSoltar').classList.add('oculto');
    anadirArchivos(e.dataTransfer.files);
  });

  $('#dlgZoom').addEventListener('click', () => $('#dlgZoom').close());

  // claves
  const abrirClaves = () => { $('#resultadoClave').textContent = ''; $('#claveGemini').value = ''; $('#dlgClaves').showModal(); };
  $('#btnClaves').addEventListener('click', abrirClaves);
  $('#btnClaveAviso').addEventListener('click', abrirClaves);
  $('#btnProbarClave').addEventListener('click', async () => {
    const out = $('#resultadoClave');
    out.textContent = 'Comprobando…';
    try {
      const v = $('#claveGemini').value.trim();
      if (v) await api('/api/claves', { claves: { gemini: v } });
      $('#claveGemini').value = '';
      const r = await api('/api/estudio/probar', {});
      out.textContent = r.mensaje;
      out.style.color = r.ok ? 'var(--ok)' : 'var(--error)';
      estadoClave();
    } catch (e) { out.textContent = e.message; out.style.color = 'var(--error)'; }
  });
}

iniciar().catch((e) => { document.body.prepend(el('div', { clase: 'aviso', texto: 'No se pudo iniciar el Estudio: ' + e.message })); });

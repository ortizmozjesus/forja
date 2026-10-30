const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const refUrl = (a) => (window.FORJA_WEB ? window.FORJA_WEB.refUrl(a) : '/referencias/' + encodeURIComponent(a));
const estado = { proveedores: {}, refs: [], filas: null, carpetaRel: '', total: 0, hechos: 0, fallidos: 0, modo: 'libre' };

// ------------------------------------------------------------ arranque
init();
async function init() {
  const d = await (await fetch('/api/estado')).json();
  estado.proveedores = d.proveedores;
  $('#proveedor').innerHTML = Object.entries(d.proveedores)
    .map(([k, v]) => `<option value="${k}">${v.nombre}</option>`).join('');
  $('#recetasGuardadas').innerHTML = '<option value="">— recetas —</option>' +
    d.recetas.map((r) => `<option>${r}</option>`).join('');
  estado.refs = d.referencias.map((archivo) => ({ archivo, alias: aliasDe(archivo), fija: false, rol: 'otra' }));
  $('#base').value = d.base || '';
  $('#proveedor').value = 'gemini';
  cambiarProveedor();
  if (d.ultima) cargarReceta(d.ultima);
  pintarRefs();
  if (!$$('.variable').length) { anadirVariable('tipo', ''); anadirVariable('hora', ''); }
  conectarEventos();
  previsualizar();
}

const aliasDe = (f) => f.replace(/\.[^.]+$/, '').replace(/[^\wáéíóúñ-]/gi, '-').toLowerCase();

function cambiarProveedor() {
  const p = estado.proveedores[$('#proveedor').value];
  $('#listaModelos').innerHTML = (p?.modelos || []).map((m) => `<option>${m}</option>`).join('');
  if (!$('#modelo').value || !p?.modelos?.includes($('#modelo').value)) $('#modelo').value = p?.modelos?.[0] || '';
  $('#campoBase').classList.toggle('oculto', $('#proveedor').value !== 'compatible');
}

// ------------------------------------------------------------ variables
function anadirVariable(nombre = '', valores = '') {
  const div = document.createElement('div');
  div.className = 'variable';
  div.innerHTML = `<input class="vnombre" placeholder="nombre" value="${nombre}">
    <input class="vvalores" placeholder="valor 1, valor 2, valor 3" value="${valores}">
    <button class="borrar" title="quitar">×</button>`;
  div.querySelector('.borrar').onclick = () => { div.remove(); previsualizar(); };
  div.oninput = previsualizar;
  $('#variables').append(div);
}

function leerVariables() {
  const v = {};
  for (const f of $$('.variable')) {
    const n = f.querySelector('.vnombre').value.trim();
    const val = f.querySelector('.vvalores').value;
    if (n && val.trim()) v[n] = val.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  }
  return v;
}

// ------------------------------------------------------------ referencias
const ROLES = [['otra', 'referencia suelta'], ['base', 'base · foto del sitio'], ['objeto', 'objeto a insertar'], ['material', 'material / textura'], ['estilo', 'estilo · concepto 3D']];

const ORDEN_ROLES = ['base', 'objeto', 'material', 'estilo', 'otra'];

function pintarRefs() {
  const comp = estado.modo === 'composicion';
  if (comp) {
    estado.refs.sort((a, b) => ORDEN_ROLES.indexOf(a.rol || 'otra') - ORDEN_ROLES.indexOf(b.rol || 'otra'));
  }
  $('#refs').innerHTML = estado.refs.map((r, i) => `
    <div class="ref ${r.rol === 'base' ? 'esbase' : ''}" data-i="${i}">
      ${comp ? `<span class="orden">${i + 1}</span>` : `<button class="fijar ${r.fija ? 'activo' : ''}" title="enviar en todas las imágenes"></button>`}
      <button class="quitar" title="quitar">×</button>
      <img src="${refUrl(r.archivo)}" title="insertar @${r.alias} en la plantilla">
      <input class="alias" value="${r.alias}">
      <select class="rol">${ROLES.map(([v, t]) => `<option value="${v}" ${r.rol === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
    </div>`).join('');
  $$('#refs .ref').forEach((el) => {
    const i = +el.dataset.i;
    el.querySelector('img').onclick = () => insertar(`@${estado.refs[i].alias}`);
    const fijar = el.querySelector('.fijar');
    if (fijar) fijar.onclick = () => { estado.refs[i].fija = !estado.refs[i].fija; pintarRefs(); previsualizar(); };
    el.querySelector('.rol').onchange = (e) => { estado.refs[i].rol = e.target.value; pintarRefs(); previsualizar(); };
    el.querySelector('.quitar').onclick = async () => {
      await fetch('/api/referencias/borrar', { method: 'POST', body: JSON.stringify({ archivo: estado.refs[i].archivo }) });
      estado.refs.splice(i, 1); pintarRefs(); previsualizar();
    };
    el.querySelector('.alias').oninput = (e) => {
      estado.refs[i].alias = e.target.value.trim().replace(/\s+/g, '-') || 'ref';
      previsualizar();
    };
  });
}

async function subirRefs(archivos) {
  for (const f of archivos) {
    if (!f.type.startsWith('image/')) continue;
    const datos = await new Promise((res) => { const l = new FileReader(); l.onload = () => res(l.result); l.readAsDataURL(f); });
    const r = await (await fetch('/api/referencias', { method: 'POST', body: JSON.stringify({ nombre: f.name, datos }) })).json();
    if (r.archivo && !estado.refs.some((x) => x.archivo === r.archivo)) {
      const usados = estado.refs.map((x) => x.rol);
      const sugerido = estado.modo === 'composicion'
        ? (!usados.includes('base') ? 'base' : !usados.includes('objeto') ? 'objeto' : 'estilo')
        : 'otra';
      estado.refs.push({ archivo: r.archivo, alias: aliasDe(r.archivo), fija: false, rol: sugerido });
    }
  }
  pintarRefs(); previsualizar();
}

function insertar(txt) {
  const t = $('#plantilla');
  const p = t.selectionStart ?? t.value.length;
  t.value = t.value.slice(0, p) + (p && t.value[p - 1] !== ' ' ? ' ' : '') + txt + t.value.slice(p);
  t.focus(); previsualizar();
}

// ------------------------------------------------------------ receta
function receta() {
  const referencias = {};
  for (const r of estado.refs) referencias[r.alias] = { ruta: 'referencias/' + r.archivo, rol: r.rol || 'otra' };
  return {
    nombre: ($('#salida').value || 'lote').split('/').pop(),
    proveedor: $('#proveedor').value,
    modelo: $('#modelo').value,
    base: $('#base').value,
    modo: estado.modo,
    conservar: $('#conservar').value,
    plantilla: $('#plantilla').value,
    sufijo: $('#sufijo').value,
    variables: leerVariables(),
    filas: estado.filas,
    referencias,
    refsGlobales: estado.refs.filter((r) => r.fija).map((r) => r.alias),
    variantes: +$('#variantes').value || 1,
    concurrencia: +$('#concurrencia').value || 3,
    salida: $('#salida').value || '',
    patronNombre: $('#patron').value,
    opciones: {
      aspecto: $('#aspecto').value,
      tamano: $('#tamano').value,
      formato: $('#formato').value,
      calidad: $('#calidad').value,
      fidelidad: estado.refs.length ? 'high' : undefined,
    },
  };
}

function cargarReceta(r) {
  cambiarModo(r.modo === 'composicion' ? 'composicion' : 'libre');
  $('#conservar').value = r.conservar || '';
  $('#proveedor').value = r.proveedor || 'gemini'; cambiarModo(estado.modo); cambiarProveedor();
  $('#modelo').value = r.modelo || $('#modelo').value;
  $('#plantilla').value = r.plantilla || '';
  $('#sufijo').value = r.sufijo || '';
  $('#variantes').value = r.variantes || 1;
  $('#concurrencia').value = r.concurrencia || 3;
  $('#salida').value = r.salida || '';
  $('#patron').value = r.patronNombre || '{{indice}}-{{resumen}}-v{{variante}}';
  for (const [k, v] of Object.entries(r.opciones || {})) { const el = $('#' + (k === 'tamano' ? 'tamano' : k)); if (el && v) el.value = v; }
  $('#variables').innerHTML = '';
  for (const [k, v] of Object.entries(r.variables || {})) anadirVariable(k, (v || []).join(', '));
  estado.filas = r.filas || null;
  const globales = r.refsGlobales || [];
  for (const ref of estado.refs) {
    ref.fija = globales.includes(ref.alias);
    if (r.referencias?.[ref.alias]?.rol) ref.rol = r.referencias[ref.alias].rol;
  }
  avisoFilas();
}

// ------------------------------------------------------------ previsualizacion
let temporizador;
const previsualizar = () => { clearTimeout(temporizador); temporizador = setTimeout(hacerPrevia, 250); };
async function hacerPrevia() {
  try {
    const r = await (await fetch('/api/previsualizar', { method: 'POST', body: JSON.stringify({ receta: receta() }) })).json();
    estado.total = r.total;
    $('#contador').textContent = `${r.total} ${r.total === 1 ? 'imagen' : 'imágenes'}`;
    const v = +$('#variantes').value || 1;
    $('#detalleContador').textContent = r.total ? `${r.total / v} prompts × ${v} variante${v > 1 ? 's' : ''}` : 'define una plantilla';
    $('#previa').innerHTML = r.ejemplos.map((e) =>
      `<div><b>${e.n}</b>${escapar(e.prompt)}${e.referencias.length ? ` <span class="refbadge">${e.referencias.map((x) => '@' + x).join(' ')}</span>` : ''}</div>`
    ).join('') + (r.total > r.ejemplos.length ? `<div style="opacity:.6">… y ${r.total - r.ejemplos.length} más</div>` : '');
    $('#btnGenerar').disabled = !r.total;
    const av = $('#avisoRefs');
    av.classList.toggle('oculto', !(r.faltantes || []).length);
    if ((r.faltantes || []).length)
      av.innerHTML = `No existe ninguna referencia llamada ${r.faltantes.map((f) => `<code>@${f}</code>`).join(', ')}. Súbela abajo y ponle ese nombre, o el texto se enviará tal cual.`;
  } catch (e) { console.error(e); }
}
const escapar = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// ------------------------------------------------------------ ejecucion
async function generar() {
  document.documentElement.style.setProperty('--rel', ($('#aspecto').value || '3:2').replace(':', '/'));
  $('#galeria').innerHTML = '';
  $('#log').textContent = '';
  estado.hechos = estado.fallidos = 0;
  const r = await (await fetch('/api/lote', { method: 'POST', body: JSON.stringify({ receta: receta() }) })).json();
  if (r.error) return registrar('Aviso: ' + r.error);
  $('#btnGenerar').disabled = true;
  $('#btnCancelar').classList.remove('oculto');
  $('#barra').classList.remove('oculta');
}

function conectarSSE() {
  const es = new EventSource('/api/eventos');
  es.onmessage = (m) => manejar(JSON.parse(m.data));
  es.onerror = () => registrar('· conexión perdida, reintentando…');
}

function manejar(ev) {
  if (ev.tipo === 'inicio') {
    estado.carpetaRel = ev.carpetaRel;
    $('#rutaSalida').textContent = '' + ev.carpetaRel;
    $('#galeria').innerHTML = ev.trabajos.map((t) => `<div class="tarjeta espera" id="c-${t.id}">${t.n}</div>`).join('');
    registrar(`▶ ${ev.total} imágenes en ${ev.carpetaRel}`);
  }
  if (ev.tipo === 'trabajo:ok') {
    const c = document.getElementById('c-' + ev.id);
    if (c) {
      c.className = 'tarjeta';
      const resumen = ev.prompt.includes('Tarea:') ? ev.prompt.split('Tarea:')[1] : ev.prompt;
      c.innerHTML = `<img src="${ev.url}" title="${escapar(ev.prompt)}"><div class="pie">${escapar(resumen.trim()).slice(0, 90)}</div>`;
      c.querySelector('img').onclick = () => window.open(ev.url, '_blank');
    }
    avanzar(ev);
  }
  if (ev.tipo === 'trabajo:error') {
    const c = document.getElementById('c-' + ev.id);
    if (c) { c.className = 'tarjeta fallo'; c.textContent = ev.error; }
    registrar(`Error #${ev.n}: ${ev.error}`);
    avanzar(ev);
  }
  if (ev.tipo === 'trabajo:reintento') registrar(`Reintento #${ev.n} intento ${ev.intento} (${Math.round(ev.espera / 1000)}s): ${ev.error}`);
  if (ev.tipo === 'fin') {
    $('#btnGenerar').disabled = false;
    $('#btnCancelar').classList.add('oculto');
    registrar(`Terminado: ${ev.hechos} ok, ${ev.fallidos} fallidas ${ev.carpeta}`);
  }
  if (ev.tipo === 'fatal') {
    registrar('Aviso: ' + ev.error);
    $('#btnGenerar').disabled = false;
    $('#btnCancelar').classList.add('oculto');
  }
}

function avanzar(ev) {
  const hechas = (ev.hechos || 0) + (ev.fallidos || 0);
  $('#progreso').style.width = (100 * hechas) / (ev.total || 1) + '%';
  $('#contador').textContent = `${hechas} / ${ev.total}`;
  $('#detalleContador').textContent = `${ev.hechos} listas${ev.fallidos ? ` · ${ev.fallidos} fallidas` : ''}`;
}

const registrar = (t) => { $('#log').textContent += t + '\n'; $('#registro').open = true; };

// ------------------------------------------------------------ pasar a nano banana
async function pasarANano() {
  const btn = $('#btnNano');
  const antes = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Preparando…';
  try {
    const d = await (await fetch('/api/exportar', { method: 'POST', body: JSON.stringify({ receta: receta() }) })).json();
    if (d.error) return registrar('Aviso: ' + d.error);
    $('#nanoResumen').textContent = `${d.grupos.length} ${d.grupos.length === 1 ? 'prompt' : 'prompts'} · ${d.total} ${d.total === 1 ? 'imagen' : 'imágenes'} previstas · sin API, lo generas tú en Gemini`;
    $('#nanoCarpeta').innerHTML = `Copiadas y numeradas en <code>${d.carpetaRel}</code> (ahí tienes también <code>prompts.txt</code> y <code>LEEME.txt</code>).`;
    $('#nanoRefs').innerHTML = d.refs.length
      ? d.refs.map((r) => `<div class="ref"><span class="orden">${r.orden}</span><img src="${r.url}"><div class="etiqueta">${r.rol} · ${escapar(r.alias)}</div></div>`).join('')
      : '<p class="ayuda">Este lote no lleva imágenes de referencia.</p>';
    $('#nanoPrompts').innerHTML = d.grupos.map((g) => `
      <div class="prompt" id="p-${g.n}">
        <div class="sup">
          <span class="tit">${g.n}/${d.grupos.length} · ${escapar(g.etiqueta)}${g.veces > 1 ? `<span class="veces"> — pídelo ${g.veces} veces</span>` : ''}</span>
          <button class="copiar fantasma" data-n="${g.n}">Copiar</button>
        </div>
        <div class="tarea">${escapar(g.tarea)}</div>
        <details><summary>ver el prompt completo</summary><div class="txt">${escapar(g.prompt)}</div></details>
      </div>`).join('');
    $$('#nanoPrompts .copiar').forEach((b) => {
      b.onclick = async () => {
        const g = d.grupos.find((x) => x.n === +b.dataset.n);
        await copiar(g.prompt);
        b.textContent = 'Copiado';
        b.classList.add('copiado');
        document.getElementById('p-' + g.n).classList.add('hecho');
        setTimeout(() => { b.textContent = 'Copiar'; b.classList.remove('copiado'); }, 2500);
      };
    });
    $('#dlgNano').showModal();
  } catch (e) {
    registrar('Aviso: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = antes;
  }
}

async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    const t = document.createElement('textarea');
    t.value = texto;
    document.body.append(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
}

// ------------------------------------------------------------ csv
function leerCsv(texto) {
  const lineas = texto.trim().split(/\r?\n/);
  const sep = (lineas[0].match(/\t/g) || []).length > (lineas[0].match(/[,;]/g) || []).length ? '\t' : (lineas[0].includes(';') ? ';' : ',');
  const cab = lineas[0].split(sep).map((s) => s.trim().replace(/^"|"$/g, ''));
  return lineas.slice(1).filter((l) => l.trim()).map((l) => {
    const celdas = l.split(sep).map((s) => s.trim().replace(/^"|"$/g, ''));
    return Object.fromEntries(cab.map((c, i) => [c, celdas[i] ?? '']));
  });
}
function avisoFilas() {
  const a = $('#avisoFilas');
  a.classList.toggle('oculto', !estado.filas);
  if (estado.filas) a.innerHTML = `Tabla cargada: <b>${estado.filas.length}</b> filas · columnas: ${Object.keys(estado.filas[0]).map((c) => `<code>{{${c}}}</code>`).join(' ')} <button class="fantasma" id="quitarCsv" style="padding:2px 8px;margin-left:6px">quitar</button>`;
  const q = $('#quitarCsv');
  if (q) q.onclick = () => { estado.filas = null; avisoFilas(); previsualizar(); };
}

// ------------------------------------------------------------ enlaces UI
function cambiarModo(modo) {
  estado.modo = modo;
  const comp = modo === 'composicion';
  $('#modoLibre').classList.toggle('activo', !comp);
  $('#modoComp').classList.toggle('activo', comp);
  $('#ayudaLibre').classList.toggle('oculto', comp);
  $('#ayudaComp').classList.toggle('oculto', !comp);
  $('#campoConservar').classList.toggle('oculto', !comp);
  $('#plantilla').placeholder = comp
    ? 'coloca la máquina de @maquina [junto al muro del fondo|en el centro de la nave], a la luz de {{hora}}'
    : 'Render arquitectónico de {{tipo}} en [hormigón visto|ladrillo], luz de {{hora}}, siguiendo @moodboard';
  $('#ayudaRefs').innerHTML = comp
    ? 'Arrastra aquí las imágenes y dale un rol a cada una. Se envían <b>todas</b>, en orden: base objeto material estilo.'
    : 'Arrastra imágenes aquí. Se citan en el prompt como <code>@nombre</code>; las marcadas como fijas se envían en todas.';
  pintarRefs();
  previsualizar();
}

function conectarEventos() {
  $('#modoLibre').onclick = () => cambiarModo('libre');
  $('#modoComp').onclick = () => cambiarModo('composicion');
  $('#conservar').oninput = previsualizar;
  $('#proveedor').onchange = () => { cambiarProveedor(); previsualizar(); };
  ['#plantilla', '#sufijo', '#modelo', '#variantes', '#patron', '#salida', '#aspecto', '#tamano', '#formato', '#calidad', '#concurrencia', '#base']
    .forEach((s) => { $(s).oninput = previsualizar; $(s).onchange = previsualizar; });
  $('#btnVar').onclick = () => { anadirVariable(); };
  $('#btnGenerar').onclick = generar;
  $('#btnCancelar').onclick = () => fetch('/api/cancelar', { method: 'POST' });
  $('#btnNano').onclick = pasarANano;
  $('#cerrarNano').onclick = () => $('#dlgNano').close();
  $('#archivoRefs').onchange = (e) => subirRefs(e.target.files);
  $('.soltar').onclick = () => $('#archivoRefs').click();
  const z = $('#zonaRefs');
  ['dragover', 'dragenter'].forEach((t) => z.addEventListener(t, (e) => { e.preventDefault(); z.classList.add('encima'); }));
  ['dragleave', 'drop'].forEach((t) => z.addEventListener(t, (e) => { e.preventDefault(); z.classList.remove('encima'); }));
  z.addEventListener('drop', (e) => subirRefs(e.dataTransfer.files));
  $('#btnCsv').onclick = () => $('#csv').click();
  $('#csv').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    estado.filas = leerCsv(await f.text());
    avisoFilas(); previsualizar();
  };
  $('#btnClaves').onclick = () => $('#dlgClaves').showModal();
  $('#btnGuardarClaves').onclick = async () => {
    await fetch('/api/claves', {
      method: 'POST',
      body: JSON.stringify({
        claves: { gemini: $('#claveGemini').value, openai: $('#claveOpenai').value, compatible: $('#claveCompatible').value },
        base: $('#base').value,
      }),
    });
    $$('#dlgClaves input').forEach((i) => (i.value = ''));
  };
  $('#btnGuardarReceta').onclick = async () => {
    const nombre = prompt('Nombre de la receta:', receta().nombre || 'mi-receta');
    if (!nombre) return;
    await fetch('/api/receta', { method: 'POST', body: JSON.stringify({ nombre, receta: receta() }) });
    const d = await (await fetch('/api/estado')).json();
    $('#recetasGuardadas').innerHTML = '<option value="">— recetas —</option>' + d.recetas.map((r) => `<option>${r}</option>`).join('');
  };
  $('#recetasGuardadas').onchange = async (e) => {
    if (!e.target.value) return;
    cargarReceta(await (await fetch('/api/receta?nombre=' + encodeURIComponent(e.target.value))).json());
    pintarRefs(); previsualizar();
  };
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !$('#btnGenerar').disabled) generar();
  });
  conectarSSE();
}

// Motor de lotes: cola con concurrencia, reintentos, escritura en disco y eventos.
import fs from 'node:fs/promises';
import path from 'node:path';
import { construirTrabajos, slug } from './plantilla.js';
import { generar, ErrorProveedor, PROVEEDORES } from './proveedores.js';

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

export function preparar(receta, raiz) {
  const trabajos = construirTrabajos(receta);
  const refs = receta.referencias || {};
  const resolver = (nombre) => {
    const r = refs[nombre];
    if (!r) return null;
    const ruta = r.ruta || r;
    return path.isAbsolute(ruta) ? ruta : path.join(raiz, ruta);
  };
  return trabajos.map((t) => ({
    ...t,
    rutasRef: t.referencias.map(resolver).filter(Boolean),
  }));
}

export class Lote {
  constructor(receta, { raiz, claves = {}, emitir = () => {} }) {
    this.receta = receta;
    this.raiz = raiz;
    this.claves = claves;
    this.emitir = emitir;
    this.id = 'lote-' + Date.now().toString(36);
    this.cancelado = false;
    this.trabajos = preparar(receta, raiz);
    this.hechos = 0;
    this.fallidos = 0;
    this.resultados = [];
    this.carpeta = path.isAbsolute(receta.salida || '')
      ? receta.salida
      : path.join(raiz, receta.salida || path.join('salidas', slug(receta.nombre || 'lote') + '-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')));
  }

  cancelar() {
    this.cancelado = true;
    this.emitir({ tipo: 'cancelado' });
  }

  async ejecutar() {
    const prov = PROVEEDORES[this.receta.proveedor];
    if (!prov) { this.emitir({ tipo: 'fatal', error: `Proveedor desconocido: ${this.receta.proveedor}` }); return { carpeta: null, resultados: [] }; }
    if (prov.clave && !this.claves[this.receta.proveedor]) {
      this.emitir({ tipo: 'fatal', error: `Falta la clave de ${prov.nombre}. Ponla en "Claves API" o en la variable de entorno ${prov.clave}.` });
      return { carpeta: null, resultados: [] };
    }
    if (!this.trabajos.length) { this.emitir({ tipo: 'fatal', error: 'La plantilla no genera ningún prompt.' }); return { carpeta: null, resultados: [] }; }
    await fs.mkdir(this.carpeta, { recursive: true });
    this.carpetaRel = path.relative(this.raiz, this.carpeta).split(path.sep).join('/');
    this.emitir({
      tipo: 'inicio',
      lote: this.id,
      total: this.trabajos.length,
      carpeta: this.carpeta,
      carpetaRel: this.carpetaRel,
      trabajos: this.trabajos.map((t) => ({ id: t.id, n: t.n, prompt: t.prompt, nombre: t.nombre, referencias: t.referencias })),
    });

    const cola = [...this.trabajos];
    const hilos = Math.max(1, Math.min(12, Number(this.receta.concurrencia) || 3));
    const trabajar = async () => {
      while (cola.length && !this.cancelado) {
        const t = cola.shift();
        await this.uno(t);
      }
    };
    await Promise.all(Array.from({ length: hilos }, trabajar));

    await this.escribirManifiesto();
    this.emitir({
      tipo: 'fin',
      total: this.trabajos.length,
      hechos: this.hechos,
      fallidos: this.fallidos,
      carpeta: this.carpeta,
      carpetaRel: this.carpetaRel,
      cancelado: this.cancelado,
    });
    return { carpeta: this.carpeta, resultados: this.resultados };
  }

  async uno(t, intentosMax = 3) {
    const r = this.receta;
    this.emitir({ tipo: 'trabajo:inicio', id: t.id, n: t.n, prompt: t.prompt });
    let ultimo;
    for (let intento = 1; intento <= intentosMax; intento++) {
      if (this.cancelado) return;
      const t0 = Date.now();
      try {
        const { buffer, extension } = await generar({
          proveedor: r.proveedor,
          modelo: r.modelo,
          apiKey: this.claves[r.proveedor] || '',
          base: r.base,
          prompt: t.prompt,
          refs: t.rutasRef,
          opciones: r.opciones || {},
        });
        let archivo = path.join(this.carpeta, `${t.nombre}.${extension}`);
        archivo = await sinPisar(archivo);
        await fs.writeFile(archivo, buffer);
        if (r.guardarPrompt !== false) {
          await fs.writeFile(
            archivo.replace(/\.[^.]+$/, '.json'),
            JSON.stringify(
              { prompt: t.prompt, combinacion: t.combo, variante: t.variante, referencias: t.referencias, proveedor: r.proveedor, modelo: r.modelo, opciones: r.opciones, fecha: new Date().toISOString() },
              null, 2
            )
          );
        }
        this.hechos++;
        const res = { id: t.id, n: t.n, archivo, relativo: path.basename(archivo), url: (this.carpetaRel && !this.carpetaRel.startsWith('..')) ? '/' + this.carpetaRel + '/' + encodeURIComponent(path.basename(archivo)) : null, prompt: t.prompt, combo: t.combo, ms: Date.now() - t0, bytes: buffer.length };
        this.resultados.push(res);
        this.emitir({ tipo: 'trabajo:ok', ...res, hechos: this.hechos, fallidos: this.fallidos, total: this.trabajos.length });
        return;
      } catch (e) {
        ultimo = e;
        const reintentable = e instanceof ErrorProveedor ? e.reintentar : true;
        if (!reintentable || intento === intentosMax) break;
        const espera = (e.esperar || 2000) * intento;
        this.emitir({ tipo: 'trabajo:reintento', id: t.id, n: t.n, intento, espera, error: String(e.message).slice(0, 200) });
        await dormir(espera);
      }
    }
    this.fallidos++;
    this.resultados.push({ id: t.id, n: t.n, error: String(ultimo?.message || ultimo), prompt: t.prompt });
    this.emitir({ tipo: 'trabajo:error', id: t.id, n: t.n, error: String(ultimo?.message || ultimo).slice(0, 400), hechos: this.hechos, fallidos: this.fallidos, total: this.trabajos.length });
  }

  async escribirManifiesto() {
    const datos = { lote: this.id, fecha: new Date().toISOString(), receta: this.receta, resultados: this.resultados };
    await fs.writeFile(path.join(this.carpeta, 'manifiesto.json'), JSON.stringify(datos, null, 2));
    const ok = this.resultados.filter((r) => r.archivo);
    const filas = ok
      .map((r) => `<figure><img src="./${encodeURIComponent(r.relativo)}" loading="lazy"><figcaption>${escapar(r.prompt)}</figcaption></figure>`)
      .join('\n');
    await fs.writeFile(
      path.join(this.carpeta, 'indice.html'),
      `<!doctype html><meta charset="utf-8"><title>${escapar(this.receta.nombre || 'Lote')}</title>
<style>body{background:#111;color:#eee;font:14px/1.5 system-ui;margin:24px}h1{font-size:18px}
.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}
figure{margin:0;background:#1b1b1b;border-radius:10px;overflow:hidden}
img{width:100%;display:block}figcaption{padding:8px;font-size:12px;color:#aaa}</style>
<h1>${escapar(this.receta.nombre || 'Lote')} — ${ok.length} imagenes</h1><div class="g">${filas}</div>`
    );
  }
}

async function sinPisar(ruta) {
  let candidata = ruta;
  let i = 1;
  while (true) {
    try {
      await fs.access(candidata);
      candidata = ruta.replace(/(\.[^.]+)$/, `-${++i}$1`);
    } catch {
      return candidata;
    }
  }
}

const escapar = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

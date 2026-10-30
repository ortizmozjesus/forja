// Codificador PNG minimo (sin dependencias) para el proveedor de prueba.
import zlib from 'node:zlib';

function crc32(buf) {
  let c, tabla = crc32.t;
  if (!tabla) {
    tabla = crc32.t = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tabla[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = tabla[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(tipo, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}

/** pixel(x,y) -> [r,g,b] */
export function png(ancho, alto, pixel) {
  const filas = Buffer.alloc((ancho * 3 + 1) * alto);
  let o = 0;
  for (let y = 0; y < alto; y++) {
    filas[o++] = 0;
    for (let x = 0; x < ancho; x++) {
      const [r, g, b] = pixel(x, y);
      filas[o++] = r & 255;
      filas[o++] = g & 255;
      filas[o++] = b & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(filas, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function hash(txt) {
  let h = 2166136261;
  for (let i = 0; i < txt.length; i++) {
    h ^= txt.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Imagen de prueba determinista a partir del prompt. */
export function imagenPrueba(prompt, ancho = 768, alto = 512) {
  const h = hash(prompt);
  const c1 = [(h >> 16) & 255, (h >> 8) & 255, h & 255];
  const c2 = [255 - c1[0], (c1[1] + 90) % 255, (c1[2] + 140) % 255];
  const bandas = 4 + (h % 7);
  return png(ancho, alto, (x, y) => {
    const t = y / alto;
    const banda = Math.floor((x / ancho) * bandas);
    const mezcla = banda % 2 === 0 ? t : 1 - t;
    return [
      Math.round(c1[0] * (1 - mezcla) + c2[0] * mezcla),
      Math.round(c1[1] * (1 - mezcla) + c2[1] * mezcla),
      Math.round(c1[2] * (1 - mezcla) + c2[2] * mezcla),
    ];
  });
}

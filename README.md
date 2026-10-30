# Forja — generación de imágenes con IA por lotes

## Estudio (la pantalla principal)

Al abrir **http://localhost:4180** entras en el **Estudio**, que funciona como el chat de Nano Banana:

1. Arrastra tus imágenes (o pégalas con `Ctrl`+`V`, o usa el 📎). Se numeran: *Imagen 1*, *Imagen 2*…
2. Escribe qué quieres: «coloca el objeto de la imagen 2 en la imagen 1», «cambia el suelo por
   hormigón pulido», «crea un render de…». Sirve igual para **editar** que para **crear desde cero**.
3. Enter para enviar (Shift+Enter, salto de línea). Después sigue pidiendo cambios sobre el resultado:
   la conversación recuerda las imágenes y lo que has hecho («ahora más oscuro»).

Detalles útiles:

- **Opciones**: genera 2, 3 o 4 versiones a la vez y elige con cuál seguir.
- **Usar como referencia** lleva un resultado al siguiente mensaje (por ejemplo, en una conversación nueva).
- **Proporción** en «Como la imagen» mantiene el encuadre original al editar.
- **Modelo**: Nano Banana (2.5 Flash, el más barato), Nano Banana 2 (3.1 Flash) y Nano Banana Pro
  (3 Pro, el más caro). Al lado de cada uno ves el precio aproximado por imagen y arriba a la
  derecha el gasto estimado de la sesión. El modelo «Prueba» no llama a Google y no cuesta nada.
- **Claves API → Guardar y probar** comprueba la clave sin gastar (lista los modelos de imagen que ve tu cuenta).
- Todo se guarda en `salidas/estudio/<fecha>/`: tus imágenes de entrada, cada resultado y un
  `conversacion.json` con las instrucciones exactas.
- Si el historial da problemas, el Estudio reintenta solo con tu instrucción y el último resultado
  como imagen base, y te lo indica bajo la imagen.
- Si la conversación se hace muy pesada (límite de ~20 MB por petición), olvida los pasos más antiguos y te avisa.
- La app solo responde en tu propio ordenador (`localhost`): no se puede usar desde otros equipos de
  la red ni desde otras webs, para que nadie gaste tu clave.

Los **lotes** (plantillas con variables, tablas, etc.) siguen disponibles en **http://localhost:4180/lotes**
(botón «Lotes» arriba). Todo lo que sigue en este documento habla de ese modo.

---

Una app local para crear **decenas o cientos de imágenes de una vez** a partir de una sola
plantilla, unas variables y unas imágenes de referencia. En vez de pedir una imagen, esperar,
cambiar una palabra y volver a pedir, defines la matriz completa y la lanzas entera.

Tiene dos modos de trabajo:

- **Crear desde cero** — imágenes nuevas a partir de texto (+ referencias de estilo si quieres).
- **Componer sobre una foto** — meter un objeto real en un sitio real: partes de la foto del
  lugar, añades la foto de la máquina o el mueble, y opcionalmente un 3D conceptual como
  referencia de acabado. La app monta la instrucción y manda las imágenes en el orden correcto.

Y dos formas de ejecutarlo:

- **Generar lote** — la app llama a la API y te deja las imágenes en una carpeta (de pago,
  céntimos por imagen).
- **Pasar a Nano Banana** — la app no llama a nada: prepara las imágenes numeradas y los
  prompts listos para pegar, y tú los generas en Gemini o AI Studio con tu cuenta, gratis.

No sube nada a ningún servidor: se ejecuta en tu ordenador, habla directamente con la API que
elijas y guarda las imágenes en una carpeta tuya.

---

## 1. Instalación

1. Instala **Node.js 18 o superior** (https://nodejs.org — versión LTS).
2. Descomprime esta carpeta donde quieras.
3. Arranca:
   - **Windows**: doble clic en `iniciar.bat`
   - **macOS / Linux**: doble clic en `iniciar.command`, o `bash iniciar.sh` en la terminal
   - o desde la terminal: `node server.js`
4. Abre **http://localhost:4180** (Estudio) o **http://localhost:4180/lotes**

No hay `npm install`: la app no tiene ni una dependencia externa.

## 2. Claves API y coste real

Botón **Claves API** arriba a la derecha. Se guardan solo en `config.json`, dentro de esta
carpeta, en tu ordenador. También se leen de las variables de entorno `GEMINI_API_KEY` y
`OPENAI_API_KEY`.

**Importante**: las suscripciones de consumidor (Gemini Pro de estudiante, ChatGPT Plus o
gratis) **no dan acceso a la API**. Son productos distintos con facturación distinta. Y el
plan gratuito de la API de Gemini **no incluye los modelos de imagen**: hay que activar
facturación y se paga por imagen.

| Modelo | Precio por imagen |
|---|---|
| `gemini-2.5-flash-image` | ~0,039 $ |
| `gemini-3.1-flash-image` | ~0,067 $ (1K) · 0,151 $ (4K) |
| `gemini-3-pro-image` | ~0,134 $ (1K/2K) · 0,24 $ (4K) |

Es decir: un lote de 30 pruebas con Flash cuesta poco más de **1 €**. Pon un límite de gasto
en la consola de Google y no hay sustos.

| Proveedor | Clave | Notas |
|---|---|---|
| Google Gemini | https://aistudio.google.com/apikey | El que mejor respeta varias referencias a la vez |
| OpenAI | https://platform.openai.com/api-keys | Requiere verificación de organización para imagen |
| Compatible OpenAI | fal.ai, Together, un servidor local… | Indica la URL base, p. ej. `https://api.together.xyz/v1` |
| Prueba | — | Imágenes falsas sin coste, para ensayar el lote |

**Ensaya siempre con el proveedor «Prueba» primero.** Verás cuántas imágenes salen, cómo se
llaman los archivos y qué prompt exacto se envía, sin gastar un céntimo. Si solo necesitas
una imagen suelta, sale gratis hacerla a mano en Google AI Studio o en la app de Gemini con
tu cuenta; esta app compensa cuando quieres diez versiones de lo mismo.

## 3. Modo «crear desde cero»: tres símbolos

```
Render arquitectónico de {{tipo}} en [hormigón visto|ladrillo|estuco], luz de {{hora}}, siguiendo @moodboard
```

| Símbolo | Qué hace |
|---|---|
| `{{variable}}` | Se sustituye por cada valor de esa variable (bloque 3) |
| `[a\|b\|c]` | Alternativa rápida: multiplica el lote sin crear una variable |
| `@nombre` | Adjunta esa imagen de referencia y la nombra dentro del prompt |

Con 2 tipos × 3 materiales × 2 horas × 2 variantes salen **24 imágenes de una sola frase**. El
contador te dice cuántas van a ser antes de lanzar nada.

**Sufijo fijo**: lo que se añade a todos los prompts (estilo, cámara, «sin texto»…), para no
repetirlo en cada línea.

### Tabla en vez de matriz

Si las combinaciones no son un producto cartesiano sino una lista concreta, pulsa **Importar
CSV/TSV**: cada fila es una imagen y cada columna una variable `{{columna}}`. Ejemplo en
`ejemplos/tabla-ejemplo.csv`.

## 4. Modo «componer sobre una foto»

Para el caso de «quiero esta máquina en este sitio»:

1. Pulsa **Componer sobre una foto**.
2. Sube las imágenes y dale un **rol** a cada una:
   - **base** → la foto del lugar tal y como está hoy. Es el lienzo: se conserva su encuadre,
     perspectiva y luz.
   - **objeto** → la máquina, el mueble o el elemento que hay que meter.
   - **estilo** → tu 3D conceptual: de ahí se toma el acabado y la atmósfera, no la geometría.
   - **material** → una textura concreta, si hace falta.
3. Escribe solo **qué hay que hacer**: `coloca la máquina de @maquina [junto al muro del
   fondo|en el centro de la nave], a la luz de {{hora}}`.
4. Rellena **qué NO debe cambiar** (la estructura, las instalaciones, el encuadre…).

La app envía las imágenes **en orden de rol** (base → objeto → material → estilo) y construye
una instrucción explícita que dice qué es cada imagen y qué hacer con ella. Puedes verla
entera en la previsualización antes de gastar nada.

Lo potente: como sigue siendo un lote, con esos corchetes y `{{hora}}` sacas de una tirada las
seis o doce colocaciones posibles y eliges. Súbele **variantes por prompt** a 3 o 4 para tener
alternativas de cada una. Ejemplo listo en `ejemplos/receta-composicion.json`.

Consejos que marcan la diferencia:

- La foto base manda: cuanto mejor sea el encuadre y la luz, mejor el resultado.
- Del objeto, sube una foto limpia y de frente si puedes; si tienes dos vistas, súbelas ambas
  (la segunda con rol *objeto* también).
- Sé concreto en la posición y la escala («apoyada en el suelo, a 1 m del muro, ocupando un
  tercio del ancho de la nave»). El modelo no adivina metros.
- Si el resultado cambia cosas que no debía, escríbelo en **qué NO debe cambiar** y repite.

## 5. Pasar a Nano Banana (gratis, sin API)

Si prefieres generar tú las imágenes en la app de Gemini o en AI Studio —donde tu cuenta ya
te da Nano Banana sin coste— pulsa **Pasar a Nano Banana** en vez de *Generar lote*. La app
no llama a ninguna API: prepara el trabajo para que solo tengas que pegar.

Se abre una ventana con los tres pasos y, a la vez, se crea una carpeta
`salidas/<nombre>-nano-banana/` que contiene:

- las **referencias copiadas y numeradas por orden de uso** (`1-base-nave-actual.png`,
  `2-objeto-maquina.png`, `3-estilo-concepto-3d.png`), para arrastrarlas sin pensar;
- `prompts.txt` con todos los prompts, numerados y separados;
- `LEEME.txt` con los pasos.

En la ventana, cada prompt tiene su botón **Copiar** y se ve de un vistazo qué cambia entre
uno y otro (la posición, la hora…). Las variantes repetidas se agrupan: si pediste 2 variantes,
te dice «pídelo 2 veces» en lugar de duplicar el texto.

Detalles que la app añade sola porque en el chat no hay parámetros:

- la línea de **formato** («imagen apaisada de proporción 3:2, máxima resolución, sin texto
  ni marcas de agua»), que en la API iría como parámetro;
- el **orden y el papel de cada imagen** («la imagen 1 es la fotografía base…»), que es lo que
  hace que el modelo no confunda el sitio con el concepto.

Trabaja **en la misma conversación**: adjunta las imágenes una vez, pega el prompt 1, y para
el resto solo pega el siguiente. El modelo mantiene el contexto y los encuadres salen más
coherentes entre sí. Guarda las descargas en esa misma carpeta y lo tendrás todo junto.

## 6. Qué sale y dónde

Cada lote crea una carpeta (por defecto dentro de `salidas/`) con:

- las imágenes, nombradas según el patrón que elijas (`{{indice}}`, `{{variante}}`,
  `{{resumen}}`, `{{fecha}}` y cualquier variable tuya);
- un `.json` por imagen con el prompt exacto, la combinación, las referencias y el modelo;
- `manifiesto.json` con el lote entero;
- `indice.html`, una hoja de contactos para verlas todas juntas.

La cola trabaja en paralelo (3 a la vez por defecto) y **reintenta sola** los errores
temporales y los límites de tasa, con espera creciente. Si una imagen falla del todo, el lote
continúa y te marca cuál y por qué.

## 7. Desde la terminal

```bash
node cli.js ejemplos/receta-composicion.json
node cli.js recetas/fachadas.json --proveedor gemini --variantes 3 --concurrencia 5
```

Una «receta» es el JSON que guardas desde la interfaz con **Guardar receta** (van a
`recetas/`). Así reutilizas un montaje meses después o lo lanzas desde n8n, el Programador de
tareas o un cron.

## 8. Ajustes útiles

- **Variantes por prompt**: cuántas versiones del mismo prompt quieres, para elegir.
- **En paralelo**: súbelo si tu clave aguanta; bájalo a 1 o 2 si ves errores 429.
- **Proporción / tamaño / formato / calidad**: se traducen a los parámetros de cada API.
- **Nombre de archivo**: piensa en cómo vas a buscar las imágenes dentro de tres meses.

## 9. Añadir otro proveedor

`lib/proveedores.js`: cada proveedor es una función que recibe `{modelo, apiKey, prompt, refs,
opciones}` y devuelve `{buffer, extension}`. Copia una de las que hay, cámbiale el `fetch` y
añádela al objeto `PROVEEDORES`. Aparece sola en el desplegable.

---

### Estructura

```
server.js            servidor local + API
cli.js               lotes desde terminal
lib/plantilla.js     expansión de {{variables}}, [alternativas], @referencias y modo composición
lib/motor.js         cola, reintentos, escritura, manifiesto
lib/proveedores.js   Gemini, OpenAI, compatible, prueba
public/              interfaz
referencias/         tus imágenes de referencia
recetas/             montajes guardados
salidas/             resultados
```

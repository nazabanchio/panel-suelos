# Panel de Suelos

Dashboard estático (HTML + JS, sin backend) para explorar los análisis de suelo
de campo: análisis convencional (macro/micronutrientes, hoja "Laboratorios":
Molisol, Clínica de Suelos, AFA, AgLab) y análisis microbiológico (hoja
"TecnoSustrato"), agrupados por campo/lote, con búsqueda, filtros y líneas de
evolución por parámetro.

**Los dos estudios se tratan siempre como fuentes separadas** — nunca se
fusiona un campo convencional con uno microbiológico, aunque compartan
nombre de lote. Si "COL 3" tiene datos en ambos estudios, aparecen como dos
fichas de campo distintas, cada una con su propio badge (CONV / MICROB). El
único cruce que sí existe es la comparación Biológico vs. Químico como
prácticas de manejo, pero eso ocurre *dentro* del estudio convencional (según
la columna "Manejo/Tipo"), nunca entre los dos estudios.

**Solo se cuentan las filas visibles en el Excel.** Si una planilla futura
vuelve a usar agrupación de filas de Excel (muestras individuales colapsadas
bajo una fila visible de "▶ PROMEDIO" por lote), el panel ignora todo lo
oculto. Cuando la única fila visible es un promedio sin fecha exacta, se
estima la fecha como el 1° de julio del primer año de la Campaña (ej.
"2024/2025" → 2024-07-01), marcada con "~" en la tabla.

**Los gráficos de evolución promedian por fecha exacta.** Cuando un mismo
lote/fecha tiene varias sub-muestras (por ejemplo, AgLab suele enviar 5-6
puntos del mismo día), se grafica un solo punto promedio por fecha — si no,
quedan superpuestas como un amontonamiento vertical en vez de una tendencia
legible. La tabla de abajo del gráfico sigue mostrando cada muestra por
separado, sin promediar.

**Análisis sueltos (un PDF que todavía no está en el Excel maestro)** se
cargan en `manual_entries.json` y `extract.py` los suma en cada corrida — así
no se pierden cuando llega un Excel nuevo. Cada entrada guarda todos los
campos crudos (productor, lote, fecha, parámetros) más un `informe_url`
opcional (por ejemplo un link de Google Drive) que reemplaza al link local a
`reports/` para ese análisis. Quedan marcadas con una `_nota` explicando de
dónde salieron y qué se asumió (conversión de unidades, campaña inferida,
etc.). Cuando el dato termine apareciendo en un Excel nuevo, hay que sacar la
entrada correspondiente de `manual_entries.json` para no duplicarla (por
ejemplo, la entrada de Anahuac/Lote 5 se sacó al llegar el v9 porque ya
estaba en el Excel maestro).

**El link al informe ("Ver PDF") busca el archivo fuente por nombre,
probando tanto PDF como XLS** (algunos informes recientes de Molisol solo
existen como .xls), y usa la primera línea si la celda de origen lista dos
archivos (análisis + "Enmiendas"). Para los informes de AgLab (Agro Ideas)
de Banchio Diego, el Excel no trae un nombre de archivo real (solo repite el
nombre del lote), así que están vinculados a mano por ID de Drive en
`extract.py` (bloque `AGLAB_INFORME_URLS`), apuntando a la carpeta
compartida de Agro Ideas.

**Los lotes con nombre genérico ("Lote Único", etc.) nunca sirven de
evidencia para fusionar entre productores distintos.** Si el nombre de un
lote está compuesto enteramente por palabras genéricas ("lote", "único"...),
`normalize_core()` le asigna un núcleo vacío en vez de usar el nombre crudo
como respaldo — así "Lote Único" de un productor nunca queda igualado a
"Lote Único" de otro productor solo por casualidad de nomenclatura. La
fusión dentro de un mismo productor sigue funcionando igual (usa también el
nombre del productor como parte de la clave).

## Archivos

- `index.html` — la página final, autocontenida (esto es lo que se publica).
- `template.html` / `app.js` / `data.json` — piezas fuente que arman `index.html`.
- `extract.py` — script que lee "Analisis_Suelos_UNIFICADO_v9.xlsx", hojas
  "Laboratorios" y "TecnoSustrato" por separado, suma lo
  que haya en `manual_entries.json`, y genera `data.json`. Agrupa por
  campo/lote *dentro de cada hoja* y fusiona automáticamente los lotes que
  comparten nombre entre laboratorios del mismo estudio (con reglas
  conservadoras para evitar fusionar lotes distintos que coinciden por
  casualidad en un número). Nunca fusiona entre hojas/estudios distintos.
- `manual_entries.json` — análisis cargados a mano desde un PDF suelto (ver
  arriba).
- `build.py` — junta `template.html` + `app.js` + `data.json` en `index.html`.

**La tabla de análisis por lote tiene el encabezado fijo** (se queda visible
al bajar con el mouse) y **los gráficos de evolución muestran el valor en
cada punto**, no solo en el último, alternando arriba/abajo para no
superponerse. El color de línea Biológico (verde) y Químico (azul) usa tonos
bien distintos entre sí, y las fechas debajo del gráfico se muestran en
tamaño más grande y color más oscuro para que se lean fácil impresas o en
pantallas chicas.

## Actualizar los datos

Cuando cambie el Excel de origen, actualizá `SRC_FILE` al inicio de
`extract.py` con el nombre nuevo (misma estructura de hojas "Laboratorios" /
"TecnoSustrato"):

```
python3 extract.py   # regenera data.json a partir del Excel
python3 build.py      # reconstruye index.html
```

Después, commitear y pushear `index.html` (y `data.json` si querés versión
histórica de los datos) a GitHub para que se actualice la página publicada.

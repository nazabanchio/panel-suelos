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

**Solo se cuentan las filas visibles en el Excel.** La planilla usa
agrupación de filas de Excel: las muestras individuales (por profundidad, o
M1/M2/M3 en TecnoSustrato) quedan colapsadas/ocultas debajo de una fila
visible de "▶ PROMEDIO" por lote. El panel ignora todo lo oculto y usa solo
lo visible — que a veces es la fila de promedio, sin fecha exacta. En esos
casos se estima la fecha como el 1° de julio del primer año de la Campaña
(ej. "2024/2025" → 2024-07-01), marcada con "~" en la tabla.

## Archivos

- `index.html` — la página final, autocontenida (esto es lo que se publica).
- `template.html` / `app.js` / `data.json` — piezas fuente que arman `index.html`.
- `extract.py` — script que lee "Analisis_Suelos_UNIFICADO_v7.xlsx", hojas
  "Laboratorios" y "TecnoSustrato" por separado, y genera `data.json`. Agrupa
  por campo/lote *dentro de cada hoja* y fusiona automáticamente los lotes que
  comparten nombre entre laboratorios del mismo estudio (con reglas
  conservadoras para evitar fusionar lotes distintos que coinciden por
  casualidad en un número). Nunca fusiona entre hojas/estudios distintos.
- `build.py` — junta `template.html` + `app.js` + `data.json` en `index.html`.

## Actualizar los datos

Cuando cambie el Excel de origen (mismo nombre de archivo y mismas hojas
"Laboratorios" / "TecnoSustrato"):

```
python3 extract.py   # regenera data.json a partir del Excel
python3 build.py      # reconstruye index.html
```

Después, commitear y pushear `index.html` (y `data.json` si querés versión
histórica de los datos) a GitHub para que se actualice la página publicada.

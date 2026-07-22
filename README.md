# Panel de Suelos

Dashboard estático (HTML + JS, sin backend) para explorar los análisis de suelo
de campo: análisis convencional (macro/micronutrientes) y análisis
microbiológico (TecnoSustrato), agrupados por campo/lote, con búsqueda,
filtros y líneas de evolución por parámetro.

Cuando un mismo lote tiene datos convencionales y microbiológicos (nombres de
lote coincidentes entre laboratorios), el campo se fusiona en una sola ficha
con tres vistas: **Convencional**, **Microbiológico**, y **Comparación
general** (evolución combinada de pH/CE — los únicos parámetros medidos de
forma comparable entre ambos estudios).

## Archivos

- `index.html` — la página final, autocontenida (esto es lo que se publica).
- `template.html` / `app.js` / `data.json` — piezas fuente que arman `index.html`.
- `extract.py` — script que lee "Análisis_UNIFICADO_v3.xlsx" (una sola hoja con
  los 5 laboratorios: Molisol, Clínica de Suelos, AFA, AgLab, TecnoSustrato) y
  genera `data.json`. Agrupa por campo/lote y fusiona automáticamente los
  lotes que comparten nombre entre laboratorios (con reglas conservadoras para
  evitar fusionar lotes distintos que coinciden por casualidad en un número).
- `build.py` — junta `template.html` + `app.js` + `data.json` en `index.html`.

## Actualizar los datos

Cuando cambie el Excel de origen (mismo nombre de archivo y misma hoja
"Análisis Unificado"):

```
python3 extract.py   # regenera data.json a partir del Excel
python3 build.py      # reconstruye index.html
```

Después, commitear y pushear `index.html` (y `data.json` si querés versión
histórica de los datos) a GitHub para que se actualice la página publicada.

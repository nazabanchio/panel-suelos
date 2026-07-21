# Panel de Suelos

Dashboard estático (HTML + JS, sin backend) para explorar los análisis de suelo
de campo: química convencional (macro/micronutrientes) y análisis
microbiológico (TecnoSustrato), agrupados por campo/lote, con búsqueda,
filtros y líneas de evolución por parámetro.

## Archivos

- `index.html` — la página final, autocontenida (esto es lo que se publica).
- `template.html` / `app.js` / `data.json` — piezas fuente que arman `index.html`.
- `extract.py` — script que lee los dos Excel originales ("Análisis suel TOT
  V7.xlsx" y "Análisis_Suelos_TecnoSustrato_v7.xlsx") y genera `data.json`.
- `build.py` — junta `template.html` + `app.js` + `data.json` en `index.html`.

## Actualizar los datos

Cuando cambien los Excel de origen:

```
python3 extract.py   # regenera data.json a partir de los Excel
python3 build.py     # reconstruye index.html
```

Después, commitear y pushear `index.html` (y `data.json` si querés versión
histórica de los datos) a GitHub para que se actualice la página publicada.

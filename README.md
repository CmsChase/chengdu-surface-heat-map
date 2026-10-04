# Chengdu surface heat map · 成都地表热地图

A map-first public viewer for QA-qualified, daytime Landsat land-surface temperature and the public nonthermal inputs used in the Chengdu research project. It is a **historical observation and feature explorer**, not a citywide heat-risk ranking or an operational forecast.

The site is separate from the [LA Surface Heat Atlas](https://github.com/CmsChase/LA-neighborhood-heat) because the two projects have different target geography, evidence and intended public audiences.

## What the map displays

- **82 independent Landsat overpass dates from 2021–2024**. Each date file contains a value only where the original fixed nonwater-land support passed QA and thermal validity checks. Across dates there are 1,964,794 accepted grid-date observations on a fixed 250 m technical grid.
- **Observed relative LST** = that grid's observed surface temperature minus the fixed eligible-land-area-weighted median of *QA-observed grids on the same date*. The true all-city median is unknown. Date-specific clear-sky support changes, so colors must not be interpreted as a complete same-day city map or persistent hot spots.
- **Observed absolute LST** and **valid thermal pixel fraction** for that date. Blank cells have no accepted measurement; they are not cool cells.
- Static WorldCover 2020 fixed nonwater-land class fractions, SRTM elevation and slope, plus the number of independent dates and years with valid local temperature labels.
- Date-specific ERA5-Land weather predictors. They come from a roughly 9 km background grid mapped to 250 m cells; they are not 250 m weather measurements. The two source-quality-affected precipitation dates retain null values, never zero-fill.

The first public version deliberately does **not** present a full-city model-prediction or treatment-priority layer. Neither unlabeled-grid precision nor a reliable citywide ranking has been established. Surface temperature is not air temperature, personal exposure or a health outcome; WorldCover tree class is not measured station shade. The grid boundary is a traceable technical OSM candidate, not government-certified administrative geometry.

## Rebuild the map locally

The accepted source artifacts are generated and retained by the research repository. They are not included here as raw scientific files. To regenerate the compact public map payload from an existing local research checkout:

```powershell
python scripts/export_data.py --source-root 'D:\path\to\ISEF'
npm ci
npm test
npm run dev
```

The exporter reads only these previously accepted 2021–2024 artifacts:

- `exports/CHENGDU_CITYWIDE_INPUT_FULL/static.parquet`
- `exports/CHENGDU_CITYWIDE_INPUT_FULL/weather/<date>.parquet`
- `exports/CHENGDU_CITYWIDE_THERMAL/valid_temperature_labels.parquet`
- `exports/CHENGDU_CITYWIDE_THERMAL/grid_temperature_support.parquet`

`public/data/manifest.json` records source and exported-file SHA-256 hashes, exact grid/date counts and each date's reference median. Temperature display values are encoded to 0.01 °C; static fractions to 0.1 percentage point. Weather values retain the source-quality missingness. No 2025 or 2026 evaluation targets are read by this export.

Run `npm run build` for a static `dist/` site. GitHub Actions deploys this directory to GitHub Pages.

## Data credit

Scientific products: USGS/NASA Landsat Collection 2 Surface Temperature; ESA WorldCover 2020; NASA SRTM; ECMWF/Copernicus Climate Data Store ERA5-Land. The map baselayer is [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright). The original research repository contains detailed QA, target, input and method contracts. This viewer does not modify those scientific products or methods.

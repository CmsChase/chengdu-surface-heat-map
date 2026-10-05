# Chengdu surface heat map · 成都地表热地图

A map-first public viewer for QA-qualified, daytime Landsat land-surface temperature and the public nonthermal inputs used in the Chengdu research project. It is a **historical observation and feature explorer**, not a citywide heat-risk ranking or an operational forecast.

The site is separate from the [LA Surface Heat Atlas](https://github.com/CmsChase/LA-neighborhood-heat) because the two projects have different target geography, evidence and intended public audiences.

## What the map displays

- **82 independent Landsat overpass dates from 2021–2024**. Each date file contains a value only where the original fixed nonwater-land support passed QA and thermal validity checks. Across dates there are 1,964,794 accepted grid-date observations on a fixed 250 m technical grid.
- **Observed relative LST** = that grid's observed surface temperature minus the fixed eligible-land-area-weighted median of *QA-observed grids on the same date*. The true all-city median is unknown. Date-specific clear-sky support changes, so colors must not be interpreted as a complete same-day city map or persistent hot spots.
- **Observed absolute LST** and **valid thermal pixel fraction** for that date. Blank cells have no accepted measurement; they are not cool cells.
- Static WorldCover 2020 fixed nonwater-land class fractions, SRTM elevation and slope, plus the number of independent dates and years with valid local temperature labels.
- Date-specific ERA5-Land weather predictors. They come from a roughly 9 km background grid mapped to 250 m cells; they are not 250 m weather measurements. The two source-quality-affected precipitation dates retain null values, never zero-fill.
- The frozen technical research boundary as a dashed outline. It is **not** an official administrative boundary. Layer opacity, WGS84 **latitude then longitude** positioning, and share links preserve the layer, date, center, zoom, opacity and selected grid.
- A selected positive-land grid shows its WGS84 center, fixed WorldCover/SRTM features and an optional 82-date history. The history distinguishes qualified observations from missing dates and shows absolute LST, same-date observable-support relative difference and valid thermal land-pixel fraction. Scatter points use actual acquisition dates; missingness is shown without interpolation or trend fitting.

## Fixed two-grid observation comparison

The visitor may choose two **different positive-land 250 m grids**, A and B, by clicking the map or entering WGS84 latitude then longitude while comparison mode is open. This is a visitor choice; the site never recommends a location. Both grids use the existing sparse 2021–2024 history blocks and the saved absolute LST centi-degree values. For each of the original 82 physical overpass dates, the state is exactly one of: both have QA-qualified observations, only A has one, only B has one, or neither has one. Only the first state has a difference, **ΔT(d) = A's saved absolute LST − B's saved absolute LST**. Missing values remain missing. The display shows all 82 dates, the two QA-valid land-pixel fractions, each grid's observed-date count, the shared-date count and its year/month distribution. The plot places unconnected points at the true date positions.

The sole overall description is the **equal-date median** of ΔT on shared dates and the count of dates with A warmer out of all shared dates. Exact ties remain in the denominator and are counted separately. With no shared date the site says “无法进行同日比较”; with only one shared date it reports that observation without a repeatability claim. No significance test, interpolation, trend, persistent-hotspot certificate or priority ranking is produced. Same-date comparison reduces variation in date-level weather, but does not control elevation, land cover, within-grid valid-pixel composition or other spatial differences. A tree-class fraction and a cooler LST cannot establish tree-caused cooling. These are QA-qualified grid-median surface temperatures, not station measurements, air-temperature differences, shade effects or personal heat exposure. This interactive description is neither model evaluation nor independent validation.

The first public version deliberately does **not** present a full-city model-prediction or treatment-priority layer. Neither unlabeled-grid precision nor a reliable citywide ranking has been established. Surface temperature is not air temperature, personal exposure or a health outcome; WorldCover tree class is not measured station shade. The grid boundary is a traceable technical OSM candidate, not government-certified administrative geometry.

## Rebuild the map locally

The accepted source artifacts are generated and retained by the research repository. They are not included here as raw scientific files. To regenerate the compact public map payload from an existing local research checkout:

```powershell
python scripts/export_data.py --source-root 'D:\path\to\ISEF'
python scripts/export_history.py --source-root 'D:\path\to\ISEF'
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

`scripts/export_history.py` reads the already accepted public date binaries, the matching fixed static grid identity, and the frozen research-boundary GeoJSON. It checks the original public file hashes before writing sparse per-10-km-block observation files in `public/data/history/`, plus a grid lattice and boundary. `public/data/history/manifest.json` records source, boundary and output SHA-256 hashes. Each click fetches only its block's history, then caches it in the page. Zero land and grids with no qualified observation keep their original statuses; no temperature values are synthesized. The 82-entry date table uses the same already published daily area-weighted reference, rounded in the existing manifest to 0.0001 °C.

Display rounding: LST and relative differences are shown to 0.01 °C, WorldCover fractions to 0.1 percentage point, and thermal-valid fraction to 1 percentage point. Original QA absence has no published per-grid reason, so the viewer says “no qualified temperature record” rather than attributing every gap to cloud. Values beyond a fixed legend endpoint retain their true click value while the color saturates at that endpoint. Historical observations are clear-sky surface temperature, not personal heat exposure or a persistent heat-island measure.

Run `npm run build` for a static `dist/` site. GitHub Actions deploys this directory to GitHub Pages.

## Data credit

Scientific products: USGS/NASA Landsat Collection 2 Surface Temperature; ESA WorldCover 2020; NASA SRTM; ECMWF/Copernicus Climate Data Store ERA5-Land. The map baselayer is [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright). The original research repository contains detailed QA, target, input and method contracts. This viewer does not modify those scientific products or methods.

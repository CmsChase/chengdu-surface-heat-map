"""Export compact, read-only Chengdu map layers from accepted local evidence.

This deliberately exports 2021–2024 development observations only. No model
training, target reconstruction, or 2025/2026 evaluation access occurs here.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
from pyproj import Transformer

NO_VALUE = -32768
LAND_COVER = {
    "worldcover_10_fraction": "tree",
    "worldcover_20_fraction": "shrub",
    "worldcover_30_fraction": "grass",
    "worldcover_40_fraction": "crop",
    "worldcover_50_fraction": "built",
    "worldcover_60_fraction": "bare",
    "worldcover_70_fraction": "snow",
    "worldcover_90_fraction": "wetland",
    "worldcover_95_fraction": "mangrove",
    "worldcover_100_fraction": "moss",
}
STATIC = {
    **{source: (name, 1000) for source, name in LAND_COVER.items()},
    "srtm_elevation_m": ("elevation", 1),
    "srtm_slope_deg": ("slope", 100),
}
WEATHER = [
    "t2m_last_k",
    "t2m_prior24h_mean_k",
    "d2m_last_k",
    "u10_last_m_s",
    "v10_last_m_s",
    "ssrd_prior24h_j_m2",
    "tp_prior24h_m",
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def weighted_median(values: np.ndarray, weights: np.ndarray) -> float:
    """Match the frozen Chengdu area-median tie convention."""
    order = np.argsort(values, kind="stable")
    sorted_values = values[order]
    sorted_weights = weights[order].astype(np.float64)
    cumulative = np.cumsum(sorted_weights)
    half = sorted_weights.sum() / 2
    index = int(np.searchsorted(cumulative, half, side="left"))
    if cumulative[index] == half and index + 1 < len(sorted_values):
        return float((sorted_values[index] + sorted_values[index + 1]) / 2)
    return float(sorted_values[index])


def export(source_root: Path, out: Path) -> dict:
    source_root = source_root.resolve()
    out.mkdir(parents=True, exist_ok=True)
    static_path = source_root / "exports/CHENGDU_CITYWIDE_INPUT_FULL/static.parquet"
    labels_path = source_root / "exports/CHENGDU_CITYWIDE_THERMAL/valid_temperature_labels.parquet"
    support_path = source_root / "exports/CHENGDU_CITYWIDE_THERMAL/grid_temperature_support.parquet"
    static = pd.read_parquet(static_path).sort_values("grid_id").reset_index(drop=True)
    support = pd.read_parquet(
        support_path, columns=["grid_id", "valid_temperature_date_count", "valid_year_count"]
    )
    static = static.merge(support, on="grid_id", validate="one_to_one", sort=False)
    if len(static) != 231515 or not static.grid_id.is_unique:
        raise ValueError("Fixed grid identity/count mismatch")
    applicable = static.support_state.eq("positive_land").to_numpy()
    if int(applicable.sum()) != 230978:
        raise ValueError("Fixed positive-land support mismatch")

    transformer = Transformer.from_crs("EPSG:32648", "EPSG:4326", always_xy=True)
    longitude, latitude = transformer.transform(
        static.center_easting_m.to_numpy(), static.center_northing_m.to_numpy()
    )
    coords = np.column_stack((longitude, latitude)).astype("<f4")
    if not (101 < longitude.min() < longitude.max() < 107):
        raise ValueError("Longitude range is not Chengdu")
    coords.tofile(out / "grids.bin")
    applicable.astype("u1").tofile(out / "applicable.bin")
    static[["valid_temperature_date_count", "valid_year_count"]].to_numpy(dtype="u1").tofile(
        out / "support.bin"
    )

    for source, (name, scale) in STATIC.items():
        values = static[source].to_numpy(dtype=np.float64)
        encoded = np.full(len(static), NO_VALUE, dtype="<i2")
        valid = applicable & np.isfinite(values)
        scaled = np.rint(values[valid] * scale)
        if np.any((scaled < -32767) | (scaled > 32767)):
            raise ValueError(f"Out of int16 range: {source}")
        encoded[valid] = scaled.astype("<i2")
        encoded.tofile(out / f"{name}.bin")

    weather_points = sorted(
        {
            (float(lat), float(lon))
            for lat, lon in zip(static.era5_latitude, static.era5_longitude, strict=True)
        }
    )
    weather_lookup = {point: index for index, point in enumerate(weather_points)}
    weather_index = np.fromiter(
        (
            weather_lookup[(float(lat), float(lon))]
            for lat, lon in zip(static.era5_latitude, static.era5_longitude, strict=True)
        ),
        dtype="<u2",
        count=len(static),
    )
    weather_index.tofile(out / "weather-index.bin")

    labels = pd.read_parquet(
        labels_path,
        columns=[
            "grid_id",
            "date",
            "physical_acquisition_id",
            "fixed_eligible_land_pixels",
            "thermal_valid_fraction_fixed_land",
            "development_lst_c_median",
        ],
    )
    if len(labels) != 1964794 or labels.duplicated(["date", "grid_id"]).any():
        raise ValueError("Accepted thermal labels/count mismatch")
    if labels.date.nunique() != 82 or labels.physical_acquisition_id.nunique() != 82:
        raise ValueError("Physical overpass/date identity mismatch")
    grid_lookup = pd.Series(np.arange(len(static), dtype=np.int32), index=static.grid_id)
    date_dir = out / "dates"
    weather_dir = out / "weather"
    date_dir.mkdir(exist_ok=True)
    weather_dir.mkdir(exist_ok=True)
    date_rows = []
    output_hashes: dict[str, str] = {}
    for date, group in labels.groupby("date", sort=True):
        if group.physical_acquisition_id.nunique() != 1:
            raise ValueError(f"Date has multiple physical overpasses: {date}")
        positions = grid_lookup.loc[group.grid_id].to_numpy(dtype=np.int32)
        if not np.all(applicable[positions]):
            raise ValueError(f"Label outside fixed positive-land support: {date}")
        temperatures = group.development_lst_c_median.to_numpy(dtype=np.float64)
        weights = group.fixed_eligible_land_pixels.to_numpy(dtype=np.float64)
        reference = weighted_median(temperatures, weights)
        encoded_temp = np.full(len(static), NO_VALUE, dtype="<i2")
        encoded_temp[positions] = np.rint(temperatures * 100).astype("<i2")
        qa = np.full(len(static), 255, dtype="u1")
        qa[positions] = np.rint(
            group.thermal_valid_fraction_fixed_land.to_numpy(dtype=np.float64) * 100
        ).astype("u1")
        date_path = date_dir / f"{date}.bin"
        with date_path.open("wb") as handle:
            handle.write(encoded_temp.tobytes())
            handle.write(qa.tobytes())
        weather_frame = pd.read_parquet(
            source_root / f"exports/CHENGDU_CITYWIDE_INPUT_FULL/weather/{date}.parquet"
        )
        if set(weather_frame.physical_acquisition_id) != set(group.physical_acquisition_id):
            raise ValueError(f"Weather/thermal overpass mismatch: {date}")
        weather_values = np.full((len(weather_points), len(WEATHER)), np.nan)
        for row in weather_frame.itertuples(index=False):
            index = weather_lookup[(float(row.era5_latitude), float(row.era5_longitude))]
            weather_values[index] = [getattr(row, feature) for feature in WEATHER]
        if not np.all(np.isfinite(weather_values[:, :6])):
            raise ValueError(f"Unexpected weather missingness: {date}")
        weather_path = weather_dir / f"{date}.json"
        weather_path.write_text(
            json.dumps(
                [
                    [round(float(x), 6) if np.isfinite(x) else None for x in row]
                    for row in weather_values
                ],
                separators=(",", ":"),
            ),
            encoding="utf-8",
        )
        date_rows.append(
            {
                "date": str(date),
                "rows": int(len(group)),
                "observed_area_weighted_median_c": round(reference, 4),
                "physical_acquisition_id": str(group.physical_acquisition_id.iloc[0]),
            }
        )
        output_hashes[f"dates/{date}.bin"] = sha256(date_path)
        output_hashes[f"weather/{date}.json"] = sha256(weather_path)

    for path in out.glob("*.bin"):
        output_hashes[path.name] = sha256(path)
    metadata = {
        "schema_version": 1,
        "study": "Chengdu clear-sky surface temperature map, 2021–2024 development evidence",
        "grid_count": len(static),
        "positive_land_grid_count": int(applicable.sum()),
        "date_count": len(date_rows),
        "observed_grid_date_records": len(labels),
        "weather_point_count": len(weather_points),
        "weather_fields": WEATHER,
        "static_scales": {name: scale for _, (name, scale) in STATIC.items()},
        "weather_points": weather_points,
        "dates": date_rows,
        "initial_date": "2024-08-24",
        "source_sha256": {
            "static": sha256(static_path),
            "valid_labels": sha256(labels_path),
            "grid_support": sha256(support_path),
        },
        "file_sha256": output_hashes,
        "meaning": {
            "relative": (
                "observed grid LST minus the eligible-land-area-weighted median "
                "of QA-observed grids on that same physical date; not the unknown "
                "all-city true median"
            ),
            "weather": (
                "ERA5-Land background at approximately 9 km, mapped to grid "
                "centers; not local 250 m measurements"
            ),
            "grid": (
                "fixed 250 m technical OSM boundary grid; not government-certified "
                "administrative statistics"
            ),
        },
    }
    (out / "manifest.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return metadata


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument(
        "--out", type=Path, default=Path(__file__).resolve().parents[1] / "public/data"
    )
    args = parser.parse_args()
    result = export(args.source_root, args.out)
    print(
        json.dumps(
            {
                key: result[key]
                for key in (
                    "grid_count",
                    "date_count",
                    "observed_grid_date_records",
                    "weather_point_count",
                )
            },
            ensure_ascii=False,
        )
    )

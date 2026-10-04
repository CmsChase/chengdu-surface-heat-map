"""Derive sparse per-block histories and grid identity from accepted public files."""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
from pathlib import Path

import numpy as np
import pandas as pd

NO_VALUE = -32768
GRID_LEFT_CENTER = 307500
GRID_TOP_CENTER = 3478750


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for part in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(part)
    return h.hexdigest()


def lattice_and_blocks(
    static: pd.DataFrame,
) -> tuple[np.ndarray, dict[str, np.ndarray]]:
    easting = static.center_easting_m.to_numpy(dtype=np.int64)
    northing = static.center_northing_m.to_numpy(dtype=np.int64)
    col = (easting - GRID_LEFT_CENTER) // 250
    row = (GRID_TOP_CENTER - northing) // 250
    if not (
        np.array_equal(GRID_LEFT_CENTER + col * 250, easting)
        and np.array_equal(GRID_TOP_CENTER - row * 250, northing)
        and col.min() >= 0
        and row.min() >= 0
        and col.max() <= 65535
        and row.max() <= 65535
    ):
        raise ValueError("Fixed grid lattice does not reconstruct source centers")
    lattice = np.column_stack((col, row)).astype("<u2")
    blocks: dict[str, list[int]] = {}
    for index, block in enumerate(static.execution_block_id):
        blocks.setdefault(str(block), []).append(index)
    return lattice, {
        name: np.array(indices, dtype=np.int32) for name, indices in blocks.items()
    }


def export(source_root: Path, data_dir: Path) -> dict:
    source_root = source_root.resolve()
    data_dir = data_dir.resolve()
    manifest_path = data_dir / "manifest.json"
    public_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if public_manifest["grid_count"] != 231515 or public_manifest["date_count"] != 82:
        raise ValueError("Accepted map scope changed")
    dates = [date["date"] for date in public_manifest["dates"]]
    if len(set(dates)) != 82 or any(
        not d.startswith(("2021", "2022", "2023", "2024")) for d in dates
    ):
        raise ValueError("Development dates changed")
    source_static = source_root / "exports/CHENGDU_CITYWIDE_INPUT_FULL/static.parquet"
    source_boundary = (
        source_root / "exports/CHENGDU_CITYWIDE_QA_PLAN/technical_boundary.geojson"
    )
    if sha256(source_static) != public_manifest["source_sha256"]["static"]:
        raise ValueError("Static source differs from accepted public map")
    static = (
        pd.read_parquet(
            source_static,
            columns=[
                "grid_id",
                "execution_block_id",
                "center_easting_m",
                "center_northing_m",
            ],
        )
        .sort_values("grid_id")
        .reset_index(drop=True)
    )
    if len(static) != public_manifest["grid_count"] or not static.grid_id.is_unique:
        raise ValueError("Grid keys changed")
    lattice, blocks = lattice_and_blocks(static)
    block_slots = {}
    east_all = static.center_easting_m.to_numpy(dtype=np.int64)
    north_all = static.center_northing_m.to_numpy(dtype=np.int64)
    for name, indices in blocks.items():
        block_e = int(name.split("_")[1][1:]) * 10000
        block_n = int(name.split("_")[2][1:]) * 10000
        east = east_all[indices] - 125
        north = north_all[indices] - 125
        slots = ((north - block_n) // 250 * 40 + (east - block_e) // 250).astype("<u2")
        if np.any(slots >= 1600) or len(np.unique(slots)) != len(slots):
            raise ValueError(f"Execution-block grid mapping invalid: {name}")
        order = np.argsort(slots)
        block_slots[name] = (indices[order], slots[order])
    applicable = np.fromfile(data_dir / "applicable.bin", dtype="u1")
    if len(applicable) != len(static) or int(applicable.sum()) != 230978:
        raise ValueError("Fixed positive-land mask changed")
    history_dir = data_dir / "history"
    history_dir.mkdir(exist_ok=True)
    lattice_path = history_dir / "grid-lattice.bin"
    lattice.tofile(lattice_path)
    for index, row in static.iterrows():
        if (
            row.grid_id
            != f"g250_e{int(row.center_easting_m - 125)}_n{int(row.center_northing_m - 125)}"
        ):
            raise ValueError(f"Grid ID reconstruction mismatch at {index}")
    outputs = {}
    total_records = 0
    handles = {name: (history_dir / f"{name}.bin").open("wb") for name in blocks}
    try:
        for date in dates:
            path = data_dir / "dates" / f"{date}.bin"
            if sha256(path) != public_manifest["file_sha256"][f"dates/{date}.bin"]:
                raise ValueError(f"Accepted date file hash mismatch: {date}")
            payload = path.read_bytes()
            count = len(static)
            if len(payload) != count * 3:
                raise ValueError(f"Date file length mismatch: {date}")
            temperature = np.frombuffer(payload, dtype="<i2", count=count)
            qa = np.frombuffer(payload, dtype="u1", count=count, offset=count * 2)
            if np.any((temperature == NO_VALUE) != (qa == 255)):
                raise ValueError(f"QA/temperature mask mismatch: {date}")
            date_count = 0
            for name, (indices, slots) in block_slots.items():
                present_mask = temperature[indices] != NO_VALUE
                present = indices[present_mask]
                selected_slots = slots[present_mask]
                if len(present) > 65535:
                    raise ValueError("Block record count exceeds uint16")
                handle = handles[name]
                handle.write(struct.pack("<H", len(present)))
                records = np.empty(
                    len(present),
                    dtype=np.dtype(
                        [("slot", "<u2"), ("temperature", "<i2"), ("qa", "u1")]
                    ),
                )
                records["slot"] = selected_slots
                records["temperature"] = temperature[present]
                records["qa"] = qa[present]
                handle.write(records.tobytes())
                date_count += len(present)
            if date_count != public_manifest["dates"][dates.index(date)]["rows"]:
                raise ValueError(f"Observation count mismatch: {date}")
            total_records += date_count
    finally:
        for handle in handles.values():
            handle.close()
    if total_records != 1964794:
        raise ValueError("Historical record count mismatch")
    for name in blocks:
        path = history_dir / f"{name}.bin"
        outputs[name] = {"bytes": path.stat().st_size, "sha256": sha256(path)}
    boundary = json.loads(source_boundary.read_text(encoding="utf-8"))
    if boundary.get("crs", {}).get("properties", {}).get("name") != "EPSG:4326":
        raise ValueError("Technical boundary is not WGS84")
    boundary_path = history_dir / "technical-boundary.geojson"
    boundary_path.write_text(
        json.dumps(boundary, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    metadata = {
        "schema_version": 1,
        "description": "Sparse 2021-2024 QA-qualified observations by original 10km execution block",
        "date_count": len(dates),
        "grid_count": len(static),
        "positive_land_grid_count": int(applicable.sum()),
        "observed_records": total_records,
        "date_order": dates,
        "encoding": "Per date: uint16 record count, then repeated little-endian uint16 slot, int16 LST centi-C, uint8 QA valid fraction percent; slot is south-to-north row*40+west-to-east column inside b10k block. Missing records have no entry.",
        "grid_lattice": {
            "file": "grid-lattice.bin",
            "bytes": lattice_path.stat().st_size,
            "sha256": sha256(lattice_path),
            "encoding": "little-endian uint16 grid column then row; center=(307500+250*col,3478750-250*row) EPSG:32648",
        },
        "boundary": {
            "file": "technical-boundary.geojson",
            "sha256": sha256(boundary_path),
            "source_sha256": sha256(source_boundary),
            "meaning": "frozen technical research extent, not official administrative boundary",
        },
        "source_sha256": {
            "accepted_map_manifest": sha256(manifest_path),
            "static": sha256(source_static),
            "accepted_labels": public_manifest["source_sha256"]["valid_labels"],
        },
        "blocks": outputs,
    }
    (history_dir / "manifest.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return metadata


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "public/data",
    )
    args = parser.parse_args()
    result = export(args.source_root, args.data_dir)
    print(
        json.dumps(
            {"blocks": len(result["blocks"]), "records": result["observed_records"]}
        )
    )

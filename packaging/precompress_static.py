#!/usr/bin/env python3
"""
Precompress static assets at maximum gzip + zstd levels.

Used after frontend builds (new-api web dist / sub2api web dist) so the edge
(Caddy `file_server { precompressed zstd gzip }`) can serve prebuilt siblings
without dynamic compression.

Usage:
  python packaging/precompress_static.py path/to/dist
  python packaging/precompress_static.py path/to/dist --ext .js,.css,.html,.svg,.json,.map,.txt,.wasm
"""
from __future__ import annotations

import argparse
import gzip
import os
import sys
from pathlib import Path

# Prefer zstandard if installed; otherwise try zstd CLI.
try:
    import zstandard as zstd  # type: ignore

    _HAS_ZSTD = True
except Exception:  # noqa: BLE001
    zstd = None  # type: ignore
    _HAS_ZSTD = False

DEFAULT_EXTS = {
    ".js",
    ".css",
    ".html",
    ".htm",
    ".svg",
    ".json",
    ".map",
    ".txt",
    ".xml",
    ".wasm",
    ".mjs",
    ".cjs",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
}

SKIP_SUFFIXES = (".gz", ".zst", ".br")


def should_compress(path: Path, exts: set[str], min_bytes: int) -> bool:
    if not path.is_file():
        return False
    name = path.name
    if name.endswith(SKIP_SUFFIXES):
        return False
    if path.suffix.lower() not in exts:
        return False
    try:
        return path.stat().st_size >= min_bytes
    except OSError:
        return False


def write_gzip(src: Path, dst: Path, level: int = 9) -> int:
    data = src.read_bytes()
    # mtime=0 for reproducible builds
    with gzip.GzipFile(filename="", mode="wb", fileobj=open(dst, "wb"), compresslevel=level, mtime=0) as gz:
        gz.write(data)
    return dst.stat().st_size


def write_zstd(src: Path, dst: Path, level: int = 22) -> int:
    data = src.read_bytes()
    if _HAS_ZSTD:
        cctx = zstd.ZstdCompressor(level=level)  # type: ignore[union-attr]
        out = cctx.compress(data)
        dst.write_bytes(out)
        return len(out)
    # fallback: zstd CLI
    import subprocess

    # --ultra allows levels > 19 (max 22)
    cmd = ["zstd", "-f", f"-{level}", "--ultra", "-o", str(dst), str(src)]
    # some builds use -22 without --ultra on older zstd; try ultra first
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        cmd = ["zstd", "-f", f"-{level}", "-o", str(dst), str(src)]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f"zstd failed for {src}: {r.stderr or r.stdout}")
    return dst.stat().st_size


def precompress_tree(
    root: Path,
    *,
    exts: set[str] | None = None,
    min_bytes: int = 256,
    gzip_level: int = 9,
    zstd_level: int = 22,
    dry_run: bool = False,
) -> dict:
    root = root.resolve()
    if not root.is_dir():
        raise FileNotFoundError(f"not a directory: {root}")
    exts = exts or set(DEFAULT_EXTS)
    stats = {
        "root": str(root),
        "files_seen": 0,
        "files_compressed": 0,
        "gzip_bytes": 0,
        "zstd_bytes": 0,
        "original_bytes": 0,
        "errors": [],
        "zstd_backend": "python-zstandard" if _HAS_ZSTD else "cli",
    }
    for dirpath, _, filenames in os.walk(root):
        for name in filenames:
            path = Path(dirpath) / name
            stats["files_seen"] += 1
            if not should_compress(path, exts, min_bytes):
                continue
            orig = path.stat().st_size
            stats["original_bytes"] += orig
            gz_path = Path(str(path) + ".gz")
            zst_path = Path(str(path) + ".zst")
            if dry_run:
                stats["files_compressed"] += 1
                continue
            try:
                gsz = write_gzip(path, gz_path, level=gzip_level)
                zsz = write_zstd(path, zst_path, level=zstd_level)
                stats["gzip_bytes"] += gsz
                stats["zstd_bytes"] += zsz
                stats["files_compressed"] += 1
            except Exception as e:  # noqa: BLE001
                stats["errors"].append(f"{path}: {e}")
    return stats


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Max-level gzip+zstd precompress for static assets")
    p.add_argument("root", type=Path, help="Static root directory (e.g. web/dist)")
    p.add_argument(
        "--ext",
        default=",".join(sorted(DEFAULT_EXTS)),
        help="Comma-separated extensions to compress",
    )
    p.add_argument("--min-bytes", type=int, default=256)
    p.add_argument("--gzip-level", type=int, default=9)
    p.add_argument("--zstd-level", type=int, default=22)
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args(argv)
    exts = {e if e.startswith(".") else f".{e}" for e in args.ext.split(",") if e.strip()}
    stats = precompress_tree(
        args.root,
        exts=exts,
        min_bytes=args.min_bytes,
        gzip_level=args.gzip_level,
        zstd_level=args.zstd_level,
        dry_run=args.dry_run,
    )
    print(
        f"precompress root={stats['root']} compressed={stats['files_compressed']}/{stats['files_seen']} "
        f"orig={stats['original_bytes']} gzip={stats['gzip_bytes']} zstd={stats['zstd_bytes']} "
        f"backend={stats['zstd_backend']}"
    )
    for err in stats["errors"]:
        print("ERROR", err, file=sys.stderr)
    return 1 if stats["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())

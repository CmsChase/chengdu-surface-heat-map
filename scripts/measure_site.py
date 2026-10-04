"""Serve a built site and record local response bodies for request audits."""

from __future__ import annotations

import argparse
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


def serve(root: Path, log_path: Path, port: int) -> None:
    root = root.resolve()
    log_path.parent.mkdir(parents=True, exist_ok=True)

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(root), **kwargs)

        def copyfile(self, source, outputfile):
            count = 0
            while chunk := source.read(64 * 1024):
                outputfile.write(chunk)
                count += len(chunk)
            with log_path.open("a", encoding="utf-8") as log:
                log.write(
                    json.dumps({"path": urlsplit(self.path).path, "body_bytes": count})
                    + "\n"
                )

    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--log", type=Path, required=True)
    parser.add_argument("--port", type=int, default=5174)
    args = parser.parse_args()
    serve(args.root, args.log, args.port)

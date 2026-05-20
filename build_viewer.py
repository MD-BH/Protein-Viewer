#!/usr/bin/env python3
from __future__ import annotations

import argparse
import functools
import http.server
import json
import socketserver
import sys
import webbrowser
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PDB_DIR = ROOT / "pdbs"
HOTSPOT_DIR = ROOT / "hotspots"
VIEWER_SRC = ROOT / "viewer_src"
OUTPUT = ROOT / "hotspot_viewer.html"
MANIFEST = PDB_DIR / "manifest.json"
HOTSPOT_MANIFEST = HOTSPOT_DIR / "manifest.json"
TEMPLATE = VIEWER_SRC / "template.html"
STYLES = VIEWER_SRC / "styles.css"
VIEWER_SCRIPT = VIEWER_SRC / "viewer.js"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765


def read_source(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise SystemExit(f"Missing viewer source file: {path}") from exc


def render_html() -> str:
    template = read_source(TEMPLATE)
    styles = read_source(STYLES).rstrip("\n")
    viewer_script = read_source(VIEWER_SCRIPT).rstrip("\n")
    required = ("{{VIEWER_STYLES}}", "{{VIEWER_SCRIPT}}")
    missing = [placeholder for placeholder in required if placeholder not in template]
    if missing:
        raise SystemExit(f"Missing template placeholder(s): {', '.join(missing)}")
    return (
        template.replace("{{VIEWER_STYLES}}", styles)
        .replace("{{VIEWER_SCRIPT}}", viewer_script)
    )


def build_manifest(directory: Path, extension: str, url_prefix: str) -> list[dict[str, str]]:
    return [
        {"name": path.name, "path": f"{url_prefix}/{path.name}"}
        for path in sorted(directory.glob(f"*{extension}"))
    ]


def write_json(path: Path, data: object) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def build_files() -> list[dict[str, str]]:
    PDB_DIR.mkdir(parents=True, exist_ok=True)
    HOTSPOT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = build_manifest(PDB_DIR, ".pdb", "pdbs")
    hotspot_manifest = build_manifest(HOTSPOT_DIR, ".txt", "hotspots")
    write_json(MANIFEST, manifest)
    write_json(HOTSPOT_MANIFEST, hotspot_manifest)
    OUTPUT.write_text(render_html(), encoding="utf-8")
    print(
        f"Wrote {OUTPUT}, {MANIFEST}, and {HOTSPOT_MANIFEST} "
        f"with {len(manifest)} PDB entry/entries and {len(hotspot_manifest)} hotspot file entry/entries."
    )
    return manifest


def serve(host: str, port: int, open_browser: bool) -> None:
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    url = f"http://{host}:{port}/hotspot_viewer.html"

    class ReusableTCPServer(socketserver.TCPServer):
        allow_reuse_address = True

    try:
        with ReusableTCPServer((host, port), handler) as httpd:
            print(f"Serving {ROOT}")
            print(f"Open {url}")
            print("Press Ctrl+C to stop.")
            if open_browser:
                webbrowser.open(url)
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    except OSError as exc:
        print(f"Could not start server on {host}:{port}: {exc}", file=sys.stderr)
        print(f"The port may already be in use. Try a different port, for example: --port {port + 1}", file=sys.stderr)
        raise SystemExit(1) from exc


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build the dynamic protein hotspot viewer and optionally serve it on localhost."
    )
    parser.add_argument("--host", default=DEFAULT_HOST, help=f"Host address to bind. Default: {DEFAULT_HOST}")
    parser.add_argument("--port", default=DEFAULT_PORT, type=int, help=f"Port to bind. Default: {DEFAULT_PORT}")
    parser.add_argument("--no-browser", action="store_true", help="Do not automatically open a browser.")
    parser.add_argument("--build-only", action="store_true", help="Only build HTML/manifest; do not start the server.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    build_files()
    if args.build_only:
        return
    serve(args.host, args.port, open_browser=not args.no_browser)


if __name__ == "__main__":
    main()

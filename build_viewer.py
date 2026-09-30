#!/usr/bin/env python3
from __future__ import annotations

import argparse
import functools
import http.server
import json
import re
import sys
import threading
import time
import webbrowser
from pathlib import Path
from urllib.parse import parse_qs, urlsplit


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
DEFAULT_PORT = 8766
VIEWER_HEARTBEAT_TIMEOUT = 60
VIEWER_CLOSE_GRACE = 15
VIEWER_SESSION_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,80}\Z")


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


class ViewerSessions:
    def __init__(
        self,
        heartbeat_timeout: float = VIEWER_HEARTBEAT_TIMEOUT,
        close_grace: float = VIEWER_CLOSE_GRACE,
        clock=time.monotonic,
    ) -> None:
        self._heartbeat_timeout = heartbeat_timeout
        self._close_grace = close_grace
        self._clock = clock
        self._sessions: dict[str, float] = {}
        self._closed_sessions: dict[str, float] = {}
        self._seen_session = False
        self._shutdown_at: float | None = None
        self._stopping = False
        self._lock = threading.Lock()

    def heartbeat(self, session_id: str) -> None:
        now = self._clock()
        with self._lock:
            if self._stopping:
                return
            closed_at = self._closed_sessions.get(session_id)
            if closed_at is not None:
                if now - closed_at < self._heartbeat_timeout:
                    return
                del self._closed_sessions[session_id]
            self._sessions[session_id] = now
            self._seen_session = True
            self._shutdown_at = None

    def close(self, session_id: str) -> bool:
        now = self._clock()
        with self._lock:
            if self._stopping or session_id not in self._sessions:
                return False
            del self._sessions[session_id]
            self._closed_sessions[session_id] = now
            if not self._sessions:
                self._shutdown_at = now + self._close_grace
            return True

    def should_shutdown(self) -> bool:
        now = self._clock()
        with self._lock:
            expired = [
                session_id
                for session_id, last_seen in self._sessions.items()
                if now - last_seen >= self._heartbeat_timeout
            ]
            for session_id in expired:
                del self._sessions[session_id]
                self._closed_sessions[session_id] = now

            for session_id, closed_at in list(self._closed_sessions.items()):
                if now - closed_at >= self._heartbeat_timeout:
                    del self._closed_sessions[session_id]

            if self._stopping or not self._seen_session:
                return self._stopping
            if expired and not self._sessions:
                self._stopping = True
                return True
            if not self._sessions and self._shutdown_at is not None and now >= self._shutdown_at:
                self._stopping = True
                return True
            return False


class ViewerRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, directory: str, sessions: ViewerSessions, **kwargs) -> None:
        self.viewer_sessions = sessions
        super().__init__(*args, directory=directory, **kwargs)

    def _is_same_origin_request(self) -> bool:
        site = self.headers.get("Sec-Fetch-Site")
        if site and site != "same-origin":
            return False
        source = self.headers.get("Origin") or self.headers.get("Referer")
        if not source:
            return site == "same-origin"
        source_url = urlsplit(source)
        return source_url.scheme == "http" and source_url.netloc == self.headers.get("Host")

    def do_GET(self) -> None:
        request = urlsplit(self.path)
        if request.path == "/__viewer/heartbeat":
            if not self._is_same_origin_request():
                self.send_error(403, "Viewer session endpoints are same-origin only")
                return
            session_ids = parse_qs(request.query).get("session", [])
            if len(session_ids) != 1 or not VIEWER_SESSION_PATTERN.fullmatch(session_ids[0]):
                self.send_error(400, "Invalid viewer session")
                return
            self.viewer_sessions.heartbeat(session_ids[0])
            self.send_response(204)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return
        super().do_GET()

    def do_POST(self) -> None:
        if urlsplit(self.path).path != "/__viewer/close":
            self.send_error(404, "Not found")
            return
        if not self._is_same_origin_request():
            self.send_error(403, "Viewer session endpoints are same-origin only")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if not 1 <= length <= 80:
            self.send_error(400, "Invalid viewer session")
            return
        session_id = self.rfile.read(length).decode("ascii", errors="ignore")
        if not VIEWER_SESSION_PATTERN.fullmatch(session_id):
            self.send_error(400, "Invalid viewer session")
            return
        self.viewer_sessions.close(session_id)
        self.send_response(204)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def log_message(self, format: str, *args) -> None:
        if urlsplit(self.path).path.startswith("/__viewer/"):
            return
        super().log_message(format, *args)


class ViewerHTTPServer(http.server.ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def create_viewer_server(host: str, port: int, directory: Path, sessions: ViewerSessions) -> ViewerHTTPServer:
    handler = functools.partial(ViewerRequestHandler, directory=str(directory), sessions=sessions)
    return ViewerHTTPServer((host, port), handler)


def monitor_viewer_sessions(httpd: ViewerHTTPServer, sessions: ViewerSessions, stop_event: threading.Event) -> None:
    while not stop_event.wait(0.5):
        if sessions.should_shutdown():
            httpd.shutdown()
            return


def serve(host: str, port: int, open_browser: bool) -> None:
    url = f"http://{host}:{port}/hotspot_viewer.html"
    try:
        sessions = ViewerSessions()
        with create_viewer_server(host, port, ROOT, sessions) as httpd:
            stop_monitor = threading.Event()
            stopped_after_viewers = threading.Event()
            monitor = threading.Thread(
                target=monitor_viewer_sessions,
                args=(httpd, sessions, stop_monitor),
                daemon=True,
            )
            monitor.start()
            print(f"Serving {ROOT}")
            print(f"Open {url}")
            print("Press Ctrl+C to stop.")
            try:
                if open_browser:
                    webbrowser.open(url)
                httpd.serve_forever()
                stopped_after_viewers.set()
            finally:
                stop_monitor.set()
                monitor.join()
            if stopped_after_viewers.is_set():
                print("No viewer pages remain. Server stopped.")
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

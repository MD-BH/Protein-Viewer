from __future__ import annotations

import subprocess
import io
import sys
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from pathlib import Path
from unittest import mock
from urllib.error import HTTPError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import build_viewer as builder  # noqa: E402


class ViewerBuildTests(unittest.TestCase):
    def test_browser_launcher_skips_terminal_browsers_and_handles_failures(self) -> None:
        with mock.patch.object(builder.webbrowser, "get") as get_browser, \
                mock.patch.object(builder.webbrowser, "open") as fallback, \
                mock.patch("sys.stdout", new_callable=io.StringIO) as output:
            browser = mock.Mock()
            get_browser.return_value = browser
            for name in ("w3m", "lynx", "links", "links2", "elinks", "www-browser"):
                browser.name = name
                builder.open_viewer_browser("http://127.0.0.1:8766/")
            browser.open.assert_not_called()
            with tempfile.TemporaryDirectory() as tmp:
                target = Path(tmp) / "w3m"
                target.touch()
                alias = Path(tmp) / "custom-browser"
                alias.symlink_to(target)
                browser.name = str(alias)
                builder.open_viewer_browser("http://127.0.0.1:8766/")
                browser.open.assert_not_called()
            browser.name = "/missing/browser-helper"
            browser.open.return_value = False
            builder.open_viewer_browser("http://127.0.0.1:8766/")
            browser.open.side_effect = OSError("launcher missing")
            builder.open_viewer_browser("http://127.0.0.1:8766/")
            get_browser.side_effect = builder.webbrowser.Error("no browser")
            builder.open_viewer_browser("http://127.0.0.1:8766/")
            fallback.assert_not_called()
            self.assertIn("Open manually", output.getvalue())
            self.assertIn("http://127.0.0.1:8766/", output.getvalue())

    def test_browser_launch_never_blocks_http_serving(self) -> None:
        for mode in ("blocking", "failed", "terminal", "disabled"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                (root / "hotspot_viewer.html").write_text("viewer", encoding="utf-8")
                server = builder.create_viewer_server("127.0.0.1", 0, root, builder.ViewerSessions())
                started = threading.Event()
                opened = threading.Event()
                release = threading.Event()
                result = []
                errors = []
                original_serve = server.serve_forever

                def serve_forever():
                    started.set()
                    original_serve(poll_interval=0.01)

                def open_browser(url):
                    try:
                        if mode == "failed":
                            return False
                        with urlopen(url, timeout=1) as response:
                            result.append(response.read())
                        result.append(threading.current_thread().daemon)
                    except Exception as exc:
                        result.append(exc)
                    finally:
                        opened.set()
                    release.wait(timeout=3)
                    return True

                def run():
                    try:
                        builder.serve("127.0.0.1", 0, open_browser=mode != "disabled")
                    except BaseException as exc:
                        errors.append(exc)

                browser = mock.Mock()
                browser.name = "w3m" if mode == "terminal" else "/test/desktop-browser"
                browser.open.side_effect = open_browser
                with mock.patch.object(builder, "create_viewer_server", return_value=server), \
                        mock.patch.object(server, "serve_forever", side_effect=serve_forever), \
                        mock.patch.object(builder.webbrowser, "get", return_value=browser) as get_browser:
                    thread = threading.Thread(target=run, daemon=True)
                    thread.start()
                    try:
                        self.assertTrue(started.wait(timeout=3), "HTTP loop must start independently of the browser")
                        with urlopen(f"http://127.0.0.1:{server.server_port}/hotspot_viewer.html", timeout=2) as response:
                            self.assertEqual(response.read(), b"viewer")
                        if mode in ("blocking", "failed"):
                            self.assertTrue(opened.wait(timeout=3))
                        if mode == "blocking":
                            self.assertEqual(result, [b"viewer", True])
                        if mode == "disabled":
                            get_browser.assert_not_called()
                        if mode in ("terminal", "disabled"):
                            browser.open.assert_not_called()
                    finally:
                        release.set()
                        if started.wait(timeout=3):
                            server.shutdown()
                        thread.join(timeout=3)
                        server.server_close()
                    self.assertFalse(thread.is_alive())
                    self.assertEqual(errors, [])

    def test_build_manifest_sorts_matching_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            (directory / "zeta.pdb").write_text("", encoding="utf-8")
            (directory / "alpha.pdb").write_text("", encoding="utf-8")
            (directory / "notes.txt").write_text("", encoding="utf-8")

            self.assertEqual(
                builder.build_manifest(directory, ".pdb", "pdbs"),
                [
                    {"name": "alpha.pdb", "path": "pdbs/alpha.pdb"},
                    {"name": "zeta.pdb", "path": "pdbs/zeta.pdb"},
                ],
            )

    def test_render_html_inlines_viewer_assets(self) -> None:
        html = builder.render_html()

        self.assertIn("https://cdn.jsdelivr.net/npm/3dmol@2.5.4/build/3Dmol-min.js", html)
        self.assertEqual(html.count('id="viewer"'), 1)
        self.assertEqual(html.count('$3Dmol.createViewer('), 1)
        self.assertIn("fetch('pdbs/manifest.json'", html)
        self.assertIn("fetch('hotspots/manifest.json'", html)
        self.assertIn(builder.VIEWER_SCRIPT.read_text(encoding="utf-8").strip(), html)
        self.assertIn(builder.STYLES.read_text(encoding="utf-8").strip(), html)
        self.assertIn('src="viewer_src/vendor/gif.js-0.2.0/gif.js"', html)
        self.assertNotIn("{{VIEWER_STYLES}}", html)
        self.assertNotIn("{{VIEWER_SCRIPT}}", html)

    def test_default_port_is_documented_localhost_port(self) -> None:
        with mock.patch.object(sys, "argv", ["build_viewer.py"]):
            args = builder.parse_args()

        self.assertEqual(builder.DEFAULT_PORT, 8766)
        self.assertEqual(args.host, "127.0.0.1")
        self.assertEqual(args.port, 8766)

    def test_viewer_sessions_wait_for_all_tabs_then_close_after_grace(self) -> None:
        now = [0.0]
        sessions = builder.ViewerSessions(clock=lambda: now[0])

        sessions.heartbeat("tab-a")
        sessions.heartbeat("tab-b")
        sessions.close("tab-a")
        now[0] = 15
        self.assertFalse(sessions.should_shutdown())

        sessions.close("tab-b")
        now[0] = 29.9
        self.assertFalse(sessions.should_shutdown())
        now[0] = 30
        self.assertTrue(sessions.should_shutdown())

    def test_viewer_session_reopen_cancels_close_grace(self) -> None:
        now = [0.0]
        sessions = builder.ViewerSessions(clock=lambda: now[0])

        sessions.heartbeat("tab-a")
        sessions.close("tab-a")
        now[0] = 10
        sessions.heartbeat("tab-b")
        now[0] = 15
        self.assertFalse(sessions.should_shutdown())

        sessions.close("tab-b")
        now[0] = 30
        self.assertTrue(sessions.should_shutdown())

    def test_viewer_session_heartbeat_timeout_recovers_lost_close_signal(self) -> None:
        now = [0.0]
        sessions = builder.ViewerSessions(clock=lambda: now[0])

        self.assertFalse(sessions.should_shutdown())
        sessions.heartbeat("tab-a")
        now[0] = 59
        self.assertFalse(sessions.should_shutdown())
        now[0] = 60
        self.assertTrue(sessions.should_shutdown())

    def test_viewer_server_still_serves_files_and_session_endpoints(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "index.html").write_text("viewer", encoding="utf-8")
            (root / "hotspot_viewer.html").write_text("protein viewer", encoding="utf-8")
            (root / "asset.txt").write_text("asset", encoding="utf-8")
            now = [0.0]
            sessions = builder.ViewerSessions(clock=lambda: now[0])
            server = builder.create_viewer_server("127.0.0.1", 0, root, sessions)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            stop_monitor = threading.Event()
            monitor = threading.Thread(
                target=builder.monitor_viewer_sessions,
                args=(server, sessions, stop_monitor),
                daemon=True,
            )
            monitor.start()
            base_url = f"http://127.0.0.1:{server.server_address[1]}"
            try:
                connection = HTTPConnection("127.0.0.1", server.server_address[1], timeout=2)
                try:
                    for method in ("GET", "HEAD"):
                        for path in ("/", "/?from=forwarded-port"):
                            connection.request(method, path)
                            response = connection.getresponse()
                            self.assertEqual(response.status, 302)
                            self.assertEqual(response.getheader("Location"), "hotspot_viewer.html")
                            self.assertEqual(response.read(), b"")
                finally:
                    connection.close()
                for path in ("/", "/hotspot_viewer.html"):
                    with urlopen(base_url + path) as response:
                        self.assertEqual(response.geturl(), base_url + "/hotspot_viewer.html")
                        self.assertEqual(response.read(), b"protein viewer")
                with urlopen(base_url + "/asset.txt") as response:
                    self.assertEqual(response.read(), b"asset")
                with urlopen(f"{base_url}/index.html") as response:
                    self.assertEqual(response.read(), b"viewer")
                heartbeat = Request(
                    f"{base_url}/__viewer/heartbeat?session=tab-a",
                    headers={"Referer": f"{base_url}/index.html", "Sec-Fetch-Site": "same-origin"},
                )
                with urlopen(heartbeat) as response:
                    self.assertEqual(response.status, 204)
                with self.assertRaises(HTTPError) as cross_origin_error:
                    urlopen(Request(
                        f"{base_url}/__viewer/heartbeat?session=attacker",
                        headers={"Referer": "https://example.invalid/", "Sec-Fetch-Site": "cross-site"},
                    ))
                self.assertEqual(cross_origin_error.exception.code, 403)
                request = Request(
                    f"{base_url}/__viewer/close",
                    data=b"tab-a",
                    headers={"Referer": f"{base_url}/index.html", "Sec-Fetch-Site": "same-origin"},
                    method="POST",
                )
                with urlopen(request) as response:
                    self.assertEqual(response.status, 204)
                now[0] = 15
                thread.join(timeout=2)
                self.assertFalse(thread.is_alive(), "the server should stop after the final session grace period")
            finally:
                stop_monitor.set()
                if thread.is_alive():
                    server.shutdown()
                    thread.join()
                monitor.join()
                server.server_close()

    def test_build_only_rebuilds_outputs_without_embedding_pdb_files(self) -> None:
        result = subprocess.run(
            [sys.executable, "build_viewer.py", "--build-only"],
            cwd=ROOT,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

        html = (ROOT / "hotspot_viewer.html").read_text(encoding="utf-8")
        self.assertIn("Wrote", result.stdout)
        self.assertTrue((ROOT / "pdbs" / "manifest.json").is_file())
        self.assertTrue((ROOT / "hotspots" / "manifest.json").is_file())
        self.assertLess(
            len(html),
            100_000,
            "Generated HTML should not embed full PDB file contents.",
        )


if __name__ == "__main__":
    unittest.main()

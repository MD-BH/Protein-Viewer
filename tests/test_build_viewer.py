from __future__ import annotations

import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock
from urllib.error import HTTPError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import build_viewer as builder  # noqa: E402


class ViewerBuildTests(unittest.TestCase):
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
        self.assertIn('id="viewer"', html)
        self.assertIn("fetch('pdbs/manifest.json'", html)
        self.assertIn("fetch('hotspots/manifest.json'", html)
        self.assertIn("const AA3_TO_AA1", html)
        self.assertIn("--viewer: #111817", html)
        self.assertEqual(html.count("<style>"), 1)
        self.assertEqual(html.count("</style>"), 1)
        self.assertEqual(html.count("<script>"), 1)
        self.assertEqual(html.count("</script>"), 2)
        self.assertIn("  <script>\n    const AA3_TO_AA1", html)
        self.assertIn("  </script>\n</body>", html)
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

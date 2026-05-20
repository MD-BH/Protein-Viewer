from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


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

        self.assertEqual(builder.DEFAULT_PORT, 8765)
        self.assertEqual(args.host, "127.0.0.1")
        self.assertEqual(args.port, 8765)

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

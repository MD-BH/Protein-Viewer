# protein_viewer

Standalone browser-based PDB hotspot viewer for inspecting protein structures with
3Dmol.js. The app loads local PDB files through a small Python build/server script,
lets you add residue hotspots such as `A128`, colors chains and individual
hotspots, and keeps the generated HTML ready for direct use.

## Features

- Dynamic PDB selection from `pdbs/manifest.json`.
- Dynamic hotspot TXT import from `hotspots/manifest.json`.
- Manual hotspot input supporting forms such as `A128`, `A:128`, and `A 128`.
- Per-hotspot color, deletion, and labels rendered in the 3D viewer.
- Chain color controls for chain A and chain B.
- Generated static HTML that does not embed full PDB contents.
- Export a looping rotation GIF of the current structure view to `gifs/`.

## Quick Start

From the parent directory:

```bash
python protein_viewer/build_viewer.py
```

Then open:

```text
http://127.0.0.1:8766/
```

The root address redirects directly to the viewer, including when opening a
VS Code forwarded port. The `/hotspot_viewer.html` address still works.

The local server stops 15 seconds after the last open viewer page closes. If the
browser cannot send a close signal, the server stops after 60 seconds without a
viewer heartbeat. With `--no-browser`, it waits for the first viewer page to open.

From inside the repository:

```bash
python build_viewer.py
```

Useful options:

```bash
python build_viewer.py --build-only
python build_viewer.py --no-browser
python build_viewer.py --port 8766
python build_viewer.py --host 127.0.0.1
```

Browser auto-opening runs separately from the HTTP server, so a slow or blocked
browser launcher cannot prevent the page from loading. Terminal browsers such as
`w3m` are skipped because the viewer needs WebGL. If auto-opening fails, open the
printed URL in a desktop browser, or start with `--no-browser` to skip the launcher.

When running through remote VS Code, forward port **8766** in the **Ports** panel
and open the forwarded URL in your local desktop browser. If VS Code assigns a
different local port, use the URL shown in that panel. A stale `BROWSER` environment
variable can prevent auto-opening, but does not prevent the server from responding.

## Project Layout

```text
protein_viewer/
├── build_viewer.py              # Builds manifests/HTML and optionally serves locally
├── hotspot_viewer.html          # Generated viewer kept for immediate use
├── viewer_src/                  # Source HTML template, CSS, and browser JS
├── pdbs/                        # PDB data and generated PDB manifest
├── hotspots/                    # Hotspot TXT files and generated hotspot manifest
├── gifs/                        # GIF exports, created on first save and ignored by Git
└── tests/                       # Standard-library unittest coverage for the builder
```

`hotspot_viewer.html`, `pdbs/manifest.json`, and `hotspots/manifest.json` are
generated outputs. They are intentionally kept in the repository so the viewer is
ready to run after checkout.

## Data Workflow

Add PDB files under `pdbs/`, then rebuild:

```bash
python build_viewer.py --build-only
```

Add hotspot TXT files under `hotspots/`, then rebuild. TXT contents use the same
syntax as manual hotspot input, for example:

```text
A18, A200
```

Use a local HTTP server rather than `file://`, because browser `fetch()` calls for
local PDB and TXT files are not reliable from `file://`.

## Rotation GIF export

Start the viewer with `python build_viewer.py`, arrange the view and hotspots,
then use **Rotation GIF → Export GIF**. The export captures only the 3D canvas,
including its background, chain colors, hotspots, labels and selected highlight.
It starts from the current angle, rotates once around the screen's vertical axis,
and loops forever. Zoom and framing stay as they are; anything outside the view
is cropped during rotation.

The default is a **640 px long edge, 4 seconds per turn, 20 fps**. Choose a
480/640/800 px long edge, 2/4/6 seconds, and 10/20 fps. The canvas aspect ratio is
preserved. GIF uses a limited color palette, so some color quantization is normal.

Structure controls are temporarily locked while exporting. Progress shows capture,
encoding and saving; **Cancel** is available until saving starts. The original
view and controls are restored on success, cancellation or failure.

The project server creates `gifs/` on the first successful export and saves
`PDBname-UTCtimestamp-uniqueID.gif` without overwriting existing files. A link to
the saved file appears below the controls. `gifs/` is excluded from Git.
Saving requires this project's server, not a generic static server or `file://`.
Uploads are limited to 64 MiB; if exporting fails, try fewer frames or a smaller
size and check that the server can write to the project directory.

GIF encoding uses the locally bundled **gif.js 0.2.0** and Web Workers under
`viewer_src/vendor/gif.js-0.2.0/` (MIT license included). It adds no Python runtime
dependencies. 3Dmol.js still requires network access as before.

## Development

Validate the builder and generated output:

```bash
python -m py_compile build_viewer.py
python build_viewer.py --build-only
python -m unittest discover tests
```

Optional browser integration checks (development only, requires Playwright,
its Chromium browser, and Pillow):

```bash
python tests/verify_gif_browser.py
```

This builds the page, saves a sample GIF in `gifs/`, checks its decoded frames and
timing, and exercises cancellation, worker failures, heartbeat and save failures.

The browser app source lives in `viewer_src/`. After editing `viewer_src/` or
`build_viewer.py`, rerun:

```bash
python build_viewer.py --build-only
```

## Requirements

- Python 3.11+ recommended.
- Browser with WebGL support.
- Network access to jsDelivr for `3Dmol.js`.

## Notes

- Full PDB contents must not be embedded in `hotspot_viewer.html`.
- PDB and hotspot filenames are preserved because they often carry biological
  identifiers.
- Browser warnings about WebGL performance in headless tests are acceptable;
  `3Dmol.js failed to load` is not.

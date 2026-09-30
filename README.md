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

## Quick Start

From the parent directory:

```bash
python protein_viewer/build_viewer.py
```

Then open:

```text
http://127.0.0.1:8766/hotspot_viewer.html
```

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

## Project Layout

```text
protein_viewer/
├── build_viewer.py              # Builds manifests/HTML and optionally serves locally
├── hotspot_viewer.html          # Generated viewer kept for immediate use
├── viewer_src/                  # Source HTML template, CSS, and browser JS
├── pdbs/                        # PDB data and generated PDB manifest
├── hotspots/                    # Hotspot TXT files and generated hotspot manifest
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

## Development

Validate the builder and generated output:

```bash
python -m py_compile build_viewer.py
python build_viewer.py --build-only
python -m unittest discover tests
```

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

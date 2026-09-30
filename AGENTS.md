# protein_viewer Agent Guide

## Purpose
`protein_viewer` is a standalone browser-based PDB hotspot viewer. It uses a static HTML page plus 3Dmol.js to display protein structures, add hotspots, color individual hotspots, delete hotspots, and render hotspot labels such as `A128`.

## Architecture
- `viewer_src/` contains the browser source of truth. Edit these files first:
  - `viewer_src/template.html` for page structure.
  - `viewer_src/styles.css` for styling.
  - `viewer_src/viewer.js` for PDB parsing, hotspot state, and 3Dmol rendering.
- `build_viewer.py` assembles `viewer_src/` and generates the runtime files.
- `hotspot_viewer.html` is generated output kept for direct use.
- `pdbs/manifest.json` and `hotspots/manifest.json` are generated output. Do not hand-edit them.
- `hotspot_viewer.html` dynamically fetches `pdbs/manifest.json`, then fetches the selected `.pdb` file on demand.
- Hotspot TXT files live under `hotspots/` and are also loaded dynamically from `hotspots/manifest.json`.
- Full PDB contents must not be embedded in `hotspot_viewer.html`.
- 3Dmol.js is loaded from jsDelivr CDN, so the browser needs network access.

## Commands
Run the viewer locally:

```bash
python protein_viewer/build_viewer.py
```

Default URL:

```text
http://127.0.0.1:8766/hotspot_viewer.html
```

The server stops 15 seconds after the last viewer page closes, or after 60
seconds without a heartbeat if the browser cannot send a close signal. When
started with `--no-browser`, it waits for the first viewer page before applying
the shutdown timers.

Build generated files without starting the server:

```bash
python protein_viewer/build_viewer.py --build-only
```

Useful server options:

```bash
python protein_viewer/build_viewer.py --no-browser
python protein_viewer/build_viewer.py --port 8766
python protein_viewer/build_viewer.py --host 127.0.0.1
```

Validate the script:

```bash
python -m py_compile protein_viewer/build_viewer.py
python protein_viewer/build_viewer.py --build-only
python -m unittest discover protein_viewer/tests
```

## PDB Workflow
- Add PDB files under `protein_viewer/pdbs/`.
- Rerun the build script after adding, deleting, or renaming PDB files.
- The build script regenerates `pdbs/manifest.json` from `pdbs/*.pdb`.
- Use localhost, not `file://`, because dynamic `fetch()` of local PDB files is not reliable from `file://`.

## Hotspot TXT Workflow
- Add hotspot text files under `protein_viewer/hotspots/`.
- TXT contents use the same syntax as manual hotspot input, for example `A18, A200`.
- Rerun the build script after adding, deleting, or renaming TXT files.
- The build script regenerates `hotspots/manifest.json` from `hotspots/*.txt`.
- Selecting a TXT file in the UI directly adds its hotspots with the currently selected "Color for new hotspots".

## Invariants
- Keep exactly one HTML element with `id="viewer"`.
- Keep rendering to a single active `$3Dmol.createViewer(...)` instance.
- `renderStructure()` must clear `#viewer` before creating a new 3Dmol viewer.
- Keep PDB loading dynamic through `fetch('pdbs/manifest.json')` and per-PDB `fetch(pdb.path)`.
- Keep hotspot TXT loading dynamic through `fetch('hotspots/manifest.json')` and per-file `fetch(hotspotFile.path)`.
- Do not reintroduce notebook, ipywidgets, or cell-output rendering as the primary UI.
- Preserve the current hotspot behavior unless explicitly changing it: parse `A128`, `A:128`, `A 128`; avoid duplicate hotspots; allow per-hotspot color, deletion, and `Axxx` labels.
- Regenerate `hotspot_viewer.html` after changing `viewer_src/` or `build_viewer.py`.

## Maintenance Notes
- `__pycache__/` is generated and should not be kept.
- `hotspot_viewer.html` is generated, but it is intentionally kept so users can run the viewer immediately.
- `.brooks-lint.yaml` intentionally ignores generated output and PDB data so structure reviews focus on source files.
- If the HTML grows close to PDB file sizes, check that PDB contents were not accidentally embedded.
- Browser warnings about WebGL performance in headless tests are acceptable; `3Dmol.js failed to load` is not.

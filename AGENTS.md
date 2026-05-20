# Protein_viewer Agent Guide

## Purpose
`Protein_viewer` is a standalone browser-based PDB hotspot viewer. It uses a static HTML page plus 3Dmol.js to display protein structures, add hotspots, color individual hotspots, delete hotspots, and render hotspot labels such as `A128`.

## Architecture
- `build_hotspot_viewer_html.py` is the source of truth. Edit this file first.
- `hotspot_viewer.html` is generated output kept for direct use.
- `pdbs/manifest.json` and `hotspots/manifest.json` are generated output. Do not hand-edit them.
- `hotspot_viewer.html` dynamically fetches `pdbs/manifest.json`, then fetches the selected `.pdb` file on demand.
- Hotspot TXT files live under `hotspots/` and are also loaded dynamically from `hotspots/manifest.json`.
- Full PDB contents must not be embedded in `hotspot_viewer.html`.
- 3Dmol.js is loaded from jsDelivr CDN, so the browser needs network access.

## Commands
Run the viewer locally:

```bash
python Protein_viewer/build_hotspot_viewer_html.py
```

Default URL:

```text
http://127.0.0.1:8765/hotspot_viewer.html
```

Build generated files without starting the server:

```bash
python Protein_viewer/build_hotspot_viewer_html.py --build-only
```

Useful server options:

```bash
python Protein_viewer/build_hotspot_viewer_html.py --no-browser
python Protein_viewer/build_hotspot_viewer_html.py --port 8766
python Protein_viewer/build_hotspot_viewer_html.py --host 127.0.0.1
```

Validate the script:

```bash
python -m py_compile Protein_viewer/build_hotspot_viewer_html.py
python Protein_viewer/build_hotspot_viewer_html.py --build-only
```

## PDB Workflow
- Add PDB files under `Protein_viewer/pdbs/`.
- Rerun the build script after adding, deleting, or renaming PDB files.
- The build script regenerates `pdbs/manifest.json` from `pdbs/*.pdb`.
- Use localhost, not `file://`, because dynamic `fetch()` of local PDB files is not reliable from `file://`.

## Hotspot TXT Workflow
- Add hotspot text files under `Protein_viewer/hotspots/`.
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

## Maintenance Notes
- `__pycache__/` is generated and should not be kept.
- `hotspot_viewer.html` is generated, but it is intentionally kept so users can run the viewer immediately.
- If the HTML grows close to PDB file sizes, check that PDB contents were not accidentally embedded.
- Browser warnings about WebGL performance in headless tests are acceptable; `3Dmol.js failed to load` is not.

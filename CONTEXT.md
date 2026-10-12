# Protein Viewer

This context defines the browser session and local serving process used by the protein hotspot viewer.

## Runtime

**Viewer session**:
One open browser page running the protein hotspot viewer. Multiple viewer sessions can use the same local viewer server.
_Avoid_: Portal process

**Local viewer server**:
The Python process that serves the generated page, manifests, and local protein files to viewer sessions.
_Avoid_: Viewer page

## Exports

**Rotation GIF export**:
A looping animation of the current protein view completing one horizontal turn,
including its colors, hotspots, labels and selected highlight, with a white or
dark background chosen independently of the page theme. It preserves the current
framing and excludes the surrounding page controls.
_Avoid_: Screen recording

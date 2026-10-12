"""Optional Playwright/Pillow integration test; saves one comparison GIF."""
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_viewer as b
from playwright.sync_api import sync_playwright
from PIL import Image


def transformed_pdb(text):
    lines = []
    for line in text.splitlines():
        if line.startswith(('ATOM  ', 'HETATM')):
            x, y, z = (float(line[start:start+8]) for start in (30, 38, 46))
            # A fits exactly; B has a known displacement to make the overlay visible.
            if line[21] == 'B':
                z += 8
            line = line[:30] + f'{-y+30:8.3f}{x-40:8.3f}{z+15:8.3f}' + line[54:]
        lines.append(line)
    return '\n'.join(lines) + '\n'


def main():
    b.build_files()
    server = b.create_viewer_server('127.0.0.1', 0, b.ROOT, b.ViewerSessions())
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
            page = browser.new_page(viewport={'width': 1280, 'height': 960})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(f'http://127.0.0.1:{server.server_port}/')
            page.wait_for_function('state.viewer && !state.pendingLoads')
            assert page.evaluate('!state.comparison.result && !state.comparison.pdb')
            source = page.evaluate('state.pdbText')
            residue = page.evaluate("[...state.parsed.residues.values()].find(r => r.ca && !r.icode).residueId")
            page.locator('#hotspotInput').fill(residue)
            page.locator('#addHotspots').click()
            page.locator('#labelText').fill('Reference hotspot')
            page.locator('#labelPinned').check()
            page.locator('#comparisonSection').evaluate('e => e.open = true')
            comparison_path = page.evaluate('state.pdbs[1].path')
            page.route('**/' + comparison_path, lambda route: route.fulfill(body=transformed_pdb(source)))
            page.locator('#comparisonPdb').select_option('1')
            page.wait_for_function('!state.comparison.busy && state.comparison.parsed')
            page.locator('#referenceChain').select_option('A')
            page.locator('#comparisonChain').select_option('A')
            page.locator('#alignComparison').click()
            page.wait_for_function('state.comparison.result && !state.comparison.busy')
            assert page.evaluate('state.comparison.result.rmsd') < 1e-8
            assert page.evaluate('state.comparison.result.identity') == 1
            assert page.evaluate('state.pdbText') == source
            assert page.locator('#viewer canvas').count() == 1
            assert page.evaluate('state.viewer.getModel(1).selectedAtoms({}).length') > 0
            assert page.evaluate("state.viewer.getModel(0).selectedAtoms({}).some(a => a.style.sphere)")
            assert page.evaluate("state.viewer.getModel(1).selectedAtoms({}).every(a => !a.style.sphere)")
            assert 'Reference hotspot' in page.evaluate('state.labelBoxes.map(b => b.text)')
            view = page.evaluate('state.viewer.getView()')
            page.locator('#comparisonColor').select_option('#7AA6FF')
            assert page.evaluate('state.viewer.getView()') == view
            page.locator('#comparisonColor').select_option('#58C9D2')
            page.locator('#showReference').uncheck()
            assert page.evaluate('state.labelBoxes.length') == 0
            assert page.locator('#locateHotspot').is_disabled()
            assert page.evaluate('state.viewer.getView()') == view
            page.locator('#showComparison').uncheck()
            assert page.locator('#exportGif').is_disabled()
            page.locator('#showReference').check()
            page.locator('#showComparison').check()
            assert page.evaluate('state.viewer.getView()') == view
            assert 'Reference hotspot' in page.evaluate('state.labelBoxes.map(b => b.text)')
            page.screenshot(path='/tmp/protein-viewer-comparison.png')
            if '--skip-gif' not in sys.argv:
                page.locator('#gifSize').select_option('480')
                page.locator('#gifDuration').select_option('2')
                page.locator('#gifFps').select_option('10')
                page.locator('#exportGif').click()
                page.wait_for_function('state.gifExportBusy')
                assert page.locator('#comparisonSection').evaluate('e => e.inert')
                page.wait_for_function('!state.gifExportBusy', timeout=180000)
                assert page.locator('#gifResult').is_visible(), page.locator('#gifStatus').inner_text()
                gif_path = b.ROOT / page.locator('#gifResult').get_attribute('href')
                with Image.open(gif_path) as image:
                    assert image.n_frames == 20 and image.info['loop'] == 0
                    cyan = gray = yellow = duration = 0
                    for i in range(image.n_frames):
                        image.seek(i)
                        duration += image.info['duration']
                        colors = image.convert('RGB').getcolors(image.width * image.height)
                        cyan += sum(n for n,(r,g,b_) in colors if g > r*1.35 and b_ > r*1.35)
                        gray += sum(n for n,(r,g,b_) in colors if 50 < r < 200 and abs(r-g) < 35 and abs(g-b_) < 35)
                        yellow += sum(n for n,(r,g,b_) in colors if r>180 and g>140 and b_<170 and r>b_+60)
                    assert cyan > 100 and gray > 100 and yellow > 0, (cyan,gray,yellow)
                    assert duration == 2000
                assert page.evaluate('state.viewer.getView()') == view
                print('PASS: transformed pair, model isolation, labels, visibility/colors, comparison GIF', flush=True)
            # Chain change invalidates the previous fit; removal restores reference view.
            page.locator('#referenceChain').select_option('B')
            assert page.evaluate('!state.comparison.result')
            page.locator('#removeComparison').click()
            assert page.evaluate('!state.comparison.pdb && state.hotspots.length === 1')
            page.unroute('**/' + comparison_path)
            page.locator('#comparisonPdb').select_option('1')
            page.wait_for_function('state.comparison.parsed && !state.comparison.busy')
            page.locator('#alignComparison').click()
            page.wait_for_function('!state.comparison.busy')
            assert page.evaluate('state.comparison.result !== null')
            identity = page.evaluate('state.comparison.result.identity')
            assert 0 <= identity <= 1
            # These unrelated chains can exceed the practical threshold after global alignment.
            assert ('Low sequence identity' in page.locator('#comparisonStatus').inner_text()) == (identity < .3)
            page.locator('#removeComparison').click()
            low_identity = '\n'.join(line[:17] + 'TRP' + line[20:] if line.startswith('ATOM') else line
                                     for line in source.splitlines())
            page.route('**/' + comparison_path, lambda route: route.fulfill(body=low_identity))
            page.locator('#comparisonPdb').select_option('1')
            page.wait_for_function('state.comparison.parsed && !state.comparison.busy')
            page.locator('#alignComparison').click()
            page.wait_for_function('!state.comparison.busy')
            assert page.evaluate('state.comparison.result.identity') < .3
            assert 'Low sequence identity' in page.locator('#comparisonStatus').inner_text()
            page.unroute('**/' + comparison_path)
            # Failures retain reference and hotspots.
            page.locator('#removeComparison').click()
            page.route('**/' + comparison_path, lambda route: route.fulfill(status=500, body='failed'))
            page.locator('#comparisonPdb').select_option('1')
            page.wait_for_function('!state.comparison.busy')
            assert 'failed' in page.locator('#comparisonStatus').inner_text().lower()
            assert page.evaluate('state.viewer && state.hotspots.length === 1 && !state.comparison.result')
            page.unroute('**/' + comparison_path)
            # A delayed request must not resurrect a removed comparison.
            page.evaluate("""() => {
              window.originalFetchText = fetchText;
              fetchText = async file => { if (file.path === state.pdbs[1].path) {
                await new Promise(resolve => window.releaseComparison = resolve);
              } return originalFetchText(file); };
            }""")
            page.locator('#comparisonPdb').select_option('0')
            page.wait_for_function('!state.comparison.busy')
            page.locator('#comparisonPdb').select_option('1')
            page.wait_for_function('Boolean(state.comparison.busy && window.releaseComparison)')
            page.locator('#removeComparison').click()
            page.evaluate('releaseComparison()')
            page.wait_for_timeout(500)
            assert page.evaluate('!state.comparison.pdb && !state.comparison.parsed && !state.comparison.result')
            page.evaluate('() => { fetchText = originalFetchText; }')
            page.locator('#comparisonPdb').select_option('0')
            page.wait_for_function('state.comparison.parsed && !state.comparison.busy')
            page.locator('#reloadPdb').click()
            page.wait_for_function('!state.pendingLoads')
            assert page.evaluate('!state.comparison.pdb && !state.hotspots.length')
            assert not errors, errors
            print('PASS: unrelated structures warning, selection invalidation, failures, stale requests, reload', flush=True)
            browser.close()
    finally:
        server.shutdown()
        thread.join()
        server.server_close()


if __name__ == '__main__':
    main()

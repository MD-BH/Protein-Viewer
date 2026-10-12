"""Optional screenshot checks: Playwright, Chromium, Pillow; saves sample PNGs."""
import base64
import io
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_viewer as b
from playwright.sync_api import sync_playwright
from PIL import Image
from verify_comparison_browser import transformed_pdb


def main():
    b.build_files()
    server = b.create_viewer_server('127.0.0.1', 0, b.ROOT, b.ViewerSessions())
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
            page = browser.new_page(viewport={'width': 1280, 'height': 960}, device_scale_factor=2)
            errors, uploads = [], []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('request', lambda request: uploads.append(request.url) if '/__viewer/export-screenshot?' in request.url else None)
            page.goto(f'http://127.0.0.1:{server.server_port}/')
            page.wait_for_function('state.viewer && !state.pendingLoads')
            residue = page.evaluate("[...state.parsed.residues.values()].find(r => r.ca && !r.icode).residueId")
            page.locator('#hotspotInput').fill(residue)
            page.locator('#addHotspots').click()
            page.locator('#labelText').fill('Snapshot label')
            page.locator('#labelPinned').check()
            for theme, expected in [('light', (255,255,255)), ('dark', (7,16,25))]:
                page.evaluate('theme => setTheme(theme)', theme)
                view = page.evaluate('state.viewer.getView()')
                size = page.evaluate('[state.viewer.getCanvas().width, state.viewer.getCanvas().height]')
                page.locator('#saveScreenshot').click()
                page.wait_for_function('!state.screenshotBusy')
                assert page.locator('#screenshotResult').is_visible(), page.locator('#screenshotStatus').inner_text()
                path = b.ROOT / page.locator('#screenshotResult').get_attribute('href')
                with Image.open(path) as image:
                    assert image.format == 'PNG' and image.size == tuple(size)
                    rgb = image.convert('RGB')
                    assert rgb.getpixel((0,0)) == expected
                    colors = rgb.getcolors(image.width * image.height)
                    assert len(colors) > 32
                    assert any(r>180 and g>140 and r>b_+50 for _,(r,g,b_) in colors), 'Missing selected label'
                assert page.evaluate('state.viewer.getView()') == view
            # A screenshot contains both models, while using reference labels.
            source = page.evaluate('state.pdbText')
            comparison_path = page.evaluate('state.pdbs[1].path')
            page.route('**/' + comparison_path, lambda route: route.fulfill(body=transformed_pdb(source)))
            page.locator('#comparisonSection').evaluate('e => e.open = true')
            page.locator('#comparisonPdb').select_option('1')
            page.wait_for_function('state.comparison.parsed && !state.comparison.busy')
            page.locator('#alignComparison').click()
            page.wait_for_function('state.comparison.result && !state.comparison.busy')
            assert page.evaluate("() => {locateSelectedHotspot(); return screenshotEls.saveScreenshot.disabled;}")
            page.wait_for_function('!state.viewer.isAnimated() && !screenshotEls.saveScreenshot.disabled')
            page.locator('#renderButton').click()
            # Delay PNG encoding; the synchronous snapshot must survive later edits.
            page.evaluate("""() => {
              window.originalToBlob = HTMLCanvasElement.prototype.toBlob;
              HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
                window.expectedSnapshot = this.toDataURL('image/png');
                window.releaseSnapshot = () => originalToBlob.call(this, callback, ...args);
              };
            }""")
            before_uploads = len(uploads)
            page.locator('#saveScreenshot').click()
            assert page.evaluate('state.screenshotBusy && !state.gifExportBusy')
            assert page.locator('#exportGif').is_disabled()
            page.evaluate('() => { saveScreenshot(); exportRotationGif(); }')
            assert not page.evaluate('state.gifExportBusy')
            expected_png = page.evaluate('window.expectedSnapshot')
            page.evaluate("state.viewer.rotate(40, 'vy')")
            changed_view = page.evaluate('state.viewer.getView()')
            page.locator('#labelText').fill('Edited after capture')
            page.evaluate('() => { HTMLCanvasElement.prototype.toBlob = originalToBlob; releaseSnapshot(); }')
            page.wait_for_function('!state.screenshotBusy')
            assert len(uploads) == before_uploads + 1
            assert page.evaluate('state.viewer.getView()') == changed_view
            path = b.ROOT / page.locator('#screenshotResult').get_attribute('href')
            with Image.open(path) as actual, Image.open(io.BytesIO(base64.b64decode(expected_png.split(',')[1]))) as expected_image:
                assert actual.convert('RGBA').tobytes() == expected_image.convert('RGBA').tobytes()
                colors = actual.convert('RGB').getcolors(actual.width * actual.height)
                assert any(g>r*1.35 and b_>r*1.35 for _,(r,g,b_) in colors), 'Missing cyan comparison'
                assert any(50<r<200 and abs(r-g)<35 and abs(g-b_)<35 for _,(r,g,b_) in colors), 'Missing reference'
            page.evaluate('() => { exportRotationGif(); }')
            assert page.evaluate('state.gifExportBusy && screenshotEls.saveScreenshot.disabled')
            page.locator('#cancelGif').click()
            page.wait_for_function('!state.gifExportBusy')
            assert page.locator('#saveScreenshot').is_enabled()
            saved = set((b.ROOT / 'screenshots').glob('*.png'))
            page.evaluate('() => { HTMLCanvasElement.prototype.toBlob = callback => callback(null); }')
            page.locator('#saveScreenshot').click()
            page.wait_for_function('!state.screenshotBusy')
            assert 'encoding failed' in page.locator('#screenshotStatus').inner_text()
            assert page.locator('#saveScreenshot').is_enabled()
            page.evaluate('() => { HTMLCanvasElement.prototype.toBlob = originalToBlob; }')
            page.route('**/__viewer/export-screenshot?*', lambda route: route.fulfill(status=500, body='disk full'))
            page.locator('#saveScreenshot').click()
            page.wait_for_function('!state.screenshotBusy')
            assert 'HTTP 500' in page.locator('#screenshotStatus').inner_text()
            assert page.locator('#screenshotResult').is_hidden()
            assert page.locator('#saveScreenshot').is_enabled()
            assert set((b.ROOT / 'screenshots').glob('*.png')) == saved
            assert page.evaluate('state.viewer.getView()') == changed_view
            page.locator('#showReference').uncheck()
            page.locator('#showComparison').uncheck()
            assert page.locator('#saveScreenshot').is_disabled()
            assert not errors, errors
            print('PASS: PNG native dimensions/backgrounds, two models, labels, immutable snapshot, mutual exclusion, animation, empty view and failure recovery', flush=True)
            browser.close()
    finally:
        server.shutdown()
        thread.join()
        server.server_close()


if __name__ == '__main__':
    main()

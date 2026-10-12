"""Optional integration check: requires Playwright, Chromium and Pillow; saves two sample GIFs."""
import hashlib
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_viewer as b
from playwright.sync_api import sync_playwright
from PIL import Image


def canvas_background(page):
    return page.evaluate("""() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(state.viewer.getCanvas(), 0, 0, 1, 1, 0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
    }""")


def check_labels(page):
    return page.evaluate("""() => {
      const ctx = els.hotspotLabels.getContext('2d');
      const calls = {boxes: [], anchors: [], texts: []};
      const originals = {};
      for (const [method, key] of [['fillRect', 'boxes'], ['moveTo', 'anchors'], ['fillText', 'texts']]) {
        originals[method] = ctx[method];
        ctx[method] = function (...args) { calls[key].push(args); return originals[method].apply(this, args); };
      }
      try { state.viewer.render(); } finally { Object.assign(ctx, originals); }
      const rect = state.viewer.getCanvas().getBoundingClientRect();
      const expected = buildHotspotRows().filter(r => r.found && r.coord).map(r => {
        const p = state.viewer.modelToScreen(r.coord);
        return [p.x - rect.left - scrollX, p.y - rect.top - scrollY];
      }).filter(([x, y]) => x >= 0 && x <= rect.width && y >= 0 && y <= rect.height);
      if (!calls.texts.length) throw new Error('Missing hotspot labels');
      for (const [x, y] of calls.anchors) {
        if (!expected.some(([ex, ey]) => Math.abs(ex-x) < 0.01 && Math.abs(ey-y) < 0.01))
          throw new Error('Leader line misses hotspot');
      }
      for (const [i, a] of calls.boxes.entries()) {
        if (a[0] < 0 || a[1] < 0 || a[0]+a[2] > rect.width || a[1]+a[3] > rect.height)
          throw new Error('Label outside viewport');
        for (const b of calls.boxes.slice(i+1)) {
          if (a[0] < b[0]+b[2] && a[0]+a[2] > b[0] && a[1] < b[1]+b[3] && a[1]+a[3] > b[1])
            throw new Error('Overlapping labels');
        }
      }
      return calls;
    }""")


def main():
    b.build_files()
    server = b.create_viewer_server('127.0.0.1', 0, b.ROOT, b.ViewerSessions())
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f'http://127.0.0.1:{server.server_address[1]}'
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
            page = browser.new_page(viewport={'width': 1280, 'height': 960}, device_scale_factor=2)
            page.add_init_script("if (!localStorage.getItem('protein-viewer-theme')) localStorage.setItem('protein-viewer-theme', 'light');")
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            heartbeats = []
            page.on('request', lambda r: heartbeats.append(r.url) if '/__viewer/heartbeat' in r.url else None)
            page.goto(url + '/hotspot_viewer.html')
            page.wait_for_function('state.viewer !== null', timeout=60000)
            page.wait_for_function('!state.pendingLoads')
            print('loaded', page.locator('#status').inner_text(), flush=True)
            assert canvas_background(page) == [255, 255, 255]
            assert page.locator('#gifBackground').input_value() == '#ffffff'
            # Reload must re-read the PDB rather than reuse a permanent text cache.
            pdb = page.evaluate('state.pdbs[state.pdbIndex]')
            updated_pdb = page.evaluate('state.pdbText') + '\nREMARK reload regression check\n'
            page.route('**/' + pdb['path'], lambda route: route.fulfill(body=updated_pdb))
            page.locator('#reloadPdb').click()
            page.wait_for_function("!state.pendingLoads && state.pdbText.includes('REMARK reload regression check')")
            page.unroute('**/' + pdb['path'])
            assert canvas_background(page) == [255, 255, 255]
            text = 'A1'
            page.route('**/hotspots/reload-check.txt', lambda route: route.fulfill(body=text))
            read_hotspots = "fetchText({path: 'hotspots/reload-check.txt'})"
            assert page.evaluate(read_hotspots) == 'A1'
            text = 'A2'
            assert page.evaluate(read_hotspots) == 'A2'
            page.unroute('**/hotspots/reload-check.txt')
            # Exact matches must not scan insertion codes; missing residues still explain them.
            rows = page.evaluate("""() => {
              const saved = {parsed: state.parsed, hotspots: state.hotspots};
              const residue = {chain: 'A', resseq: 1, icode: '', residueId: 'A1',
                resname3: 'ALA', resname1: 'A', coord: {x: 0, y: 0, z: 0}};
              const residues = new Map([['A|1|', residue]]);
              try {
                state.parsed = {residues, chains: new Map([['A', [residue]]])};
                state.hotspots = [{chain: 'A', resseq: 1, colorName: 'Red', colorHex: '#FF7185'}];
                residues.values = () => { throw new Error('Unnecessary residue scan'); };
                const exact = buildHotspotRows()[0];
                delete residues.values;
                residues.set('A|2|B', {...residue, resseq: 2, icode: 'B'});
                state.hotspots[0].resseq = 2;
                const insertion = buildHotspotRows()[0];
                state.hotspots[0].resseq = 3;
                return [exact, insertion, buildHotspotRows()[0]];
              } finally { Object.assign(state, saved); }
            }""")
            assert rows[0]['found'] and rows[0]['context'] == 'A1..A1: [A]'
            assert not rows[1]['found'] and rows[1]['context'].endswith('insertion codes present: B')
            assert not rows[2]['found'] and rows[2]['context'] == 'missing'
            page.locator('#hotspotInput').fill(page.evaluate('([...state.parsed.residues.values()].find(r => r.residueId === "A128") || [...state.parsed.residues.values()].find(r => !r.icode)).residueId'))
            page.locator('#addHotspots').click()
            page.evaluate("state.viewer.rotate(35, 'vx'); state.viewer.rotate(20, 'vy'); state.viewer.render()")
            assert page.evaluate('buildHotspotRows().some(row => row.found)')
            page.evaluate("""() => {
    window.liveGifWorkers = 0;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); window.liveGifWorkers++; this.terminated = false; }
      terminate() {
        if (!this.terminated) { window.liveGifWorkers--; this.terminated = true; }
        return super.terminate();
      }
    };
  }""")
            check_labels(page)
            assert page.locator('#hotspotLabels').evaluate("e => getComputedStyle(e).pointerEvents") == 'none'
            # Dense labels, overflow, selected-label priority, scroll and DPR alignment.
            page.evaluate("window.savedHotspots = state.hotspots.slice()")
            page.evaluate("""() => {
              state.hotspots = [...state.parsed.residues.values()].filter(r => !r.icode).slice(0, 100)
                .map(r => ({chain:r.chain, resseq:r.resseq, colorName:'Red', colorHex:'#FF7185'}));
              renderAll('Dense label check');
            }""")
            check_labels(page)
            page.evaluate("state.viewer.rotate(80, 'vy'); window.scrollTo(0, 200)")
            check_labels(page)
            page.screenshot(path='/tmp/protein-viewer-leader-labels.png')
            page.evaluate("state.hotspots = window.savedHotspots; renderAll('Restore hotspots'); window.scrollTo(0, 0)")
            check_labels(page)
            # Real pointer drag pins the label without rotating the protein.
            box = page.evaluate('state.labelBoxes[0]')
            canvas_rect = page.locator('#hotspotLabels').bounding_box()
            drag_view = page.evaluate('state.viewer.getView()')
            x, y = canvas_rect['x'] + box['x'] + 5, canvas_rect['y'] + box['y'] + 5
            page.mouse.move(x, y)
            page.mouse.down()
            page.mouse.move(x - 70, y + 40, steps=6)
            page.mouse.up()
            assert page.evaluate('state.viewer.getView()') == drag_view
            assert page.locator('#labelPinned').is_checked()
            pinned = page.evaluate('({...selectedLabelHotspot().labelPosition})')
            initial_box = page.evaluate('state.labelBoxes.find(b => b.selected)')
            page.evaluate("state.viewer.rotate(15, 'vy')")
            rotated_box = page.evaluate('state.labelBoxes.find(b => b.selected)')
            assert abs(initial_box['x'] - rotated_box['x']) < 0.01
            assert abs(initial_box['y'] - rotated_box['y']) < 0.01
            page.locator('#labelText').fill('活性位点 <A128> & test')
            assert page.evaluate('state.labelBoxes.find(b => b.selected).text') == '活性位点 <A128> & test'
            page.locator('#labelText').fill('X' * 80)
            assert page.evaluate("state.labelBoxes.find(b => b.selected).text.endsWith('…')")
            assert len(page.locator('#labelText').input_value()) == 80
            page.locator('#labelText').fill('   ')
            assert page.evaluate('state.labelBoxes.find(b => b.selected).text') == box['text']
            page.locator('#labelPinned').uncheck()
            assert page.evaluate('!selectedLabelHotspot().labelPosition')
            page.locator('#labelPinned').check()
            page.locator('#labelText').fill('Active site A128')
            label_settings = page.evaluate('({text:selectedLabelHotspot().labelText, pos:selectedLabelHotspot().labelPosition})')
            before = page.evaluate('state.viewer.getView()')
            assert canvas_background(page) == [255, 255, 255]
            page.evaluate('window.viewerBeforeTheme = state.viewer')
            page.locator('#themeToggle').click()
            assert page.evaluate('state.viewer === window.viewerBeforeTheme')
            assert page.evaluate('state.viewer.getView()') == before
            assert canvas_background(page) == [7, 16, 25]
            assert page.locator('#gifBackground').input_value() == '#ffffff'
            ratio = page.evaluate('state.viewer.getCanvas().width / state.viewer.getCanvas().height')
            page.locator('#exportGif').click()
            page.wait_for_function('state.gifExportBusy')
            assert canvas_background(page) == [255, 255, 255]
            page.wait_for_function('!state.gifExportBusy', timeout=180000)
            print('export status', page.locator('#gifStatus').inner_text(), flush=True)
            assert page.locator('#gifResult').is_visible()
            path = b.ROOT / page.locator('#gifResult').get_attribute('href')
            image = Image.open(path)
            print('gif', path.name, image.size, image.n_frames, image.info, flush=True)
            assert max(image.size) == 640 and image.n_frames == 80 and (image.info['loop'] == 0)
            assert abs(image.width / image.height - ratio) < 0.01
            frames = []
            duration = 0
            pink_pixels = 0
            label_pixels = 0
            for i in range(image.n_frames):
                image.seek(i)
                duration += image.info['duration']
                rgb = image.convert('RGB')
                # The source is exactly white; GIF palette quantization can shift it by one level.
                assert all(channel >= 254 for channel in rgb.getpixel((0, 0)))
                label_pixels += sum(count for count, (r, g, b_) in rgb.getcolors(image.width * image.height)
                                    if r > 180 and g > 140 and r > b_ + 60 and g > b_ + 30)
                frames.append(hashlib.sha256(rgb.tobytes()).digest())
                pink_pixels += sum(count for count, (red, green, blue) in rgb.getcolors(image.width * image.height)
                                   if red > 80 and red > green * 1.3 and blue > green * 1.05 and red > blue)
            assert label_pixels > 0, 'Selected yellow label must be composited into the GIF'
            assert pink_pixels > 0, 'GIF quantization must preserve the colored hotspot'
            assert duration == 4000 and len(set(frames)) > 60
            assert len(image.convert('RGB').getcolors(image.width * image.height)) > 32
            image.close()
            assert page.evaluate('state.viewer.getView()') == before
            assert not page.locator('.stage').evaluate('(e)=>e.inert')
            assert page.locator('#viewer canvas').count() == 1

            expected_background = [7, 16, 25]

            def assert_restored():
                check_labels(page)
                assert page.evaluate('({text:selectedLabelHotspot().labelText, pos:selectedLabelHotspot().labelPosition})') == label_settings
                assert canvas_background(page) == expected_background
                assert page.evaluate('state.viewer.getView()') == before
                assert page.evaluate('window.liveGifWorkers') == 0
                assert not page.locator('.stage').evaluate('(e)=>e.inert')
                assert not page.locator('#gifSettings').evaluate('(e)=>e.inert')
                assert page.locator('#exportGif').is_enabled()
                assert page.locator('#cancelGif').is_hidden()
                assert page.locator('#viewer canvas').count() == 1
            assert_restored()
            page.locator('#gifSize').select_option('480')
            page.locator('#gifDuration').select_option('2')
            page.locator('#gifFps').select_option('10')
            # Inverse combination: light page, dark GIF, then restore the light canvas.
            page.locator('#themeToggle').click()
            expected_background = [255, 255, 255]
            page.locator('#gifBackground').select_option('#071019')
            assert_restored()
            page.locator('#exportGif').click()
            page.wait_for_function('state.gifExportBusy')
            assert canvas_background(page) == [7, 16, 25]
            page.wait_for_function('!state.gifExportBusy', timeout=180000)
            assert page.locator('#gifResult').is_visible()
            dark_path = b.ROOT / page.locator('#gifResult').get_attribute('href')
            with Image.open(dark_path) as dark_gif:
                assert max(dark_gif.size) == 480 and dark_gif.n_frames == 20
                assert dark_gif.info['loop'] == 0
                duration = 0
                for i in range(dark_gif.n_frames):
                    dark_gif.seek(i)
                    duration += dark_gif.info['duration']
                    pixel = dark_gif.convert('RGB').getpixel((0, 0))
                    assert all(abs(actual - expected) <= 2 for actual, expected in zip(pixel, (7, 16, 25)))
                assert duration == 2000
            assert_restored()
            saved = set((b.ROOT / 'gifs').glob('*.gif'))
            # Capture cancellation also exercises duplicate clicks and viewport resizing.
            page.locator('#exportGif').click()
            page.wait_for_function('state.gifExportBusy')
            assert page.locator('.stage').evaluate('(e)=>e.inert')
            page.evaluate('exportRotationGif()')
            page.set_viewport_size({'width': 1200, 'height': 900})
            page.locator('#cancelGif').click()
            page.wait_for_function('!state.gifExportBusy')
            assert 'cancelled' in page.locator('#gifStatus').inner_text()
            assert_restored()
            page.set_viewport_size({'width': 1280, 'height': 960})
            # Delay encoding to verify heartbeats continue and cancellation stays responsive.
            worker = (b.ROOT / 'viewer_src/vendor/gif.js-0.2.0/gif.worker.js').read_text()
            delayed = worker + '\nconst handleGifFrame = self.onmessage; self.onmessage = event => setTimeout(() => handleGifFrame(event), 20000);'
            page.route('**/gif.worker.js', lambda route: route.fulfill(body=delayed, content_type='text/javascript'))
            page.locator('#exportGif').click()
            page.wait_for_function("document.getElementById('gifStatus').textContent.startsWith('Encoding')", timeout=60000)
            heartbeat_count = len(heartbeats)
            page.wait_for_timeout(11000)
            assert len(heartbeats) > heartbeat_count
            page.locator('#cancelGif').click()
            page.wait_for_function('!state.gifExportBusy')
            assert_restored()
            page.unroute('**/gif.worker.js')
            # Worker and save failures must release resources and unlock the view.
            page.route('**/gif.worker.js', lambda route: route.abort())
            page.locator('#exportGif').click()
            page.wait_for_function('!state.gifExportBusy', timeout=60000)
            assert 'worker failed' in page.locator('#gifStatus').inner_text()
            assert_restored()
            page.unroute('**/gif.worker.js')
            page.route('**/__viewer/export-gif?*', lambda route: route.fulfill(status=500, body='Disk full'))
            page.locator('#exportGif').click()
            page.wait_for_function('!state.gifExportBusy', timeout=60000)
            assert 'HTTP 500' in page.locator('#gifStatus').inner_text()
            assert page.locator('#gifResult').is_hidden()
            assert_restored()
            page.unroute('**/__viewer/export-gif?*')
            assert set((b.ROOT / 'gifs').glob('*.gif')) == saved
            page.reload()
            page.wait_for_function('state.viewer !== null && !state.pendingLoads')
            assert canvas_background(page) == [255, 255, 255]
            assert page.locator('#gifBackground').input_value() == '#ffffff'
            assert not errors, errors
            print('PASS: theme/backgrounds, reload, hotspot matching, GIF frames/timing/loop, view restoration, cancellation, workers, heartbeat, failed save', flush=True)
            browser.close()
    finally:
        server.shutdown()
        thread.join()
        server.server_close()


if __name__ == '__main__':
    main()

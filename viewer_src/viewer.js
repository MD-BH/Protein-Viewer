    const AA3_TO_AA1 = {
      ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C',
      GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H', ILE: 'I',
      LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P',
      SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V',
      MSE: 'M', SEC: 'U', PYL: 'O', ASX: 'B', GLX: 'Z', UNK: 'X'
    };
    const COLORS = [
      { name: 'Red', hex: '#FF7185' },
      { name: 'Orange', hex: '#FF995E' },
      { name: 'Pink', hex: '#F080CF' },
      { name: 'Purple', hex: '#C18BFF' },
      { name: 'Blue', hex: '#7AA6FF' },
      { name: 'Cyan', hex: '#58C9D2' },
      { name: 'Green', hex: '#70D6A2' },
      { name: 'Lime', hex: '#B8DA69' }
    ];
    const DEFAULT_COLOR = COLORS[0];
    const CHAIN_COLORS = [{ name: 'Gray', hex: '#B7C8D6' }, ...COLORS];
    const DEFAULT_CHAIN_COLOR = CHAIN_COLORS[0];
    const COLORABLE_CHAINS = ['A', 'B'];
    const HOTSPOT_PATTERN = /(^|[^A-Za-z0-9_])([A-Za-z_])\s*:?\s*(-?\d+)(?=$|[^A-Za-z0-9_])/g;

    const state = {
      pdbs: [],
      hotspotFiles: [],
      pdbIndex: 0,
      pdbLoadRequest: 0,
      pdbText: '',
      parsed: null,
      hotspots: [],
      chainColors: { A: DEFAULT_CHAIN_COLOR.name, B: DEFAULT_CHAIN_COLOR.name },
      viewer: null,
      pendingLoads: 0,
      comparison: { request: 0, text: '', parsed: null, pdb: null, result: null, busy: false },
      labelBoxes: [],
      redrawLabels: null,
      labelBackground: null,
      screenshotBusy: false,
      gifExportBusy: false
    };

    const els = {
      pdbSelect: document.getElementById('pdbSelect'),
      hotspotFileSelect: document.getElementById('hotspotFileSelect'),
      loadHotspotFile: document.getElementById('loadHotspotFile'),
      hotspotInput: document.getElementById('hotspotInput'),
      newColor: document.getElementById('newColor'),
      addHotspots: document.getElementById('addHotspots'),
      renderButton: document.getElementById('renderButton'),
      clearHotspots: document.getElementById('clearHotspots'),
      reloadPdb: document.getElementById('reloadPdb'),
      chainAColor: document.getElementById('chainAColor'),
      chainBColor: document.getElementById('chainBColor'),
      chainColorNote: document.getElementById('chainColorNote'),
      status: document.getElementById('status'),
      labelText: document.getElementById('labelText'),
      labelPinned: document.getElementById('labelPinned'),
      selectedHotspot: document.getElementById('selectedHotspot'),
      selectedHotspotSection: document.getElementById('selectedHotspotSection'),
      selectedColor: document.getElementById('selectedColor'),
      deleteSelected: document.getElementById('deleteSelected'),
      locateHotspot: document.getElementById('locateHotspot'),
      locateNote: document.getElementById('locateNote'),
      sequencePanel: document.getElementById('sequencePanel'),
      sequenceSummary: document.getElementById('sequenceSummary'),
      hotspotPanel: document.getElementById('hotspotPanel'),
      hotspotSummary: document.getElementById('hotspotSummary'),
      hotspotResultsSection: document.getElementById('hotspotResultsSection'),
      viewer: document.getElementById('viewer'),
      hotspotLabels: document.getElementById('hotspotLabels'),
      viewerTitle: document.getElementById('viewerTitle'),
      viewerMeta: document.getElementById('viewerMeta'),
      themeToggle: document.getElementById('themeToggle'),
      themeToggleLabel: document.getElementById('themeToggleLabel')
    };

    const THEME_STORAGE_KEY = document.documentElement.dataset.themeStorageKey || 'protein-viewer-theme';

    const gifEls = Object.fromEntries([
      'gifSize', 'gifDuration', 'gifFps', 'gifBackground', 'gifSettings', 'exportGif',
      'cancelGif', 'gifProgress', 'gifStatus', 'gifResult'
    ].map(id => [id, document.getElementById(id)]));

    const comparisonEls = Object.fromEntries([
      'comparisonPdb', 'referenceChain', 'comparisonChain', 'alignComparison',
      'removeComparison', 'comparisonColor', 'showReference', 'showComparison',
      'comparisonLegend', 'comparisonStatus'
    ].map(id => [id, document.getElementById(id)]));

    function updateComparisonControls() {
      const c = state.comparison;
      comparisonEls.comparisonPdb.disabled = !state.parsed || state.pendingLoads > 0;
      comparisonEls.referenceChain.disabled = !state.parsed || state.pendingLoads > 0 || (c.busy && !c.parsed);
      comparisonEls.comparisonChain.disabled = !c.parsed;
      comparisonEls.alignComparison.disabled = c.busy || state.pendingLoads > 0 ||
        !state.parsed || !c.parsed || !comparisonEls.referenceChain.value || !comparisonEls.comparisonChain.value;
      comparisonEls.removeComparison.disabled = !c.pdb;
      comparisonEls.comparisonLegend.replaceChildren();
      const legend = (name, colors) => {
        const line = document.createElement('div');
        line.append(document.createTextNode(name + ' — '));
        for (const [text, color] of colors) {
          const swatch = document.createElement('span');
          swatch.className = 'color-swatch'; swatch.style.backgroundColor = color;
          line.append(swatch, document.createTextNode(text + ' '));
        }
        comparisonEls.comparisonLegend.append(line);
      };
      if (state.parsed) legend('Reference: ' + state.pdbs[state.pdbIndex].name,
        [...state.parsed.chains.keys()].map(chain => {
          const color = COLORABLE_CHAINS.includes(chain) ? chainColorByName(state.chainColors[chain]) : {name:'Gray',hex:'#cbd5e1'};
          return [`${chain} ${color.name}`,color.hex];
        }));
      if (c.result) legend('Comparison: ' + c.pdb.name,
        [[comparisonEls.comparisonColor.selectedOptions[0].text, comparisonEls.comparisonColor.value]]);
    }

    function fillComparisonChains(select, parsed) {
      select.replaceChildren();
      for (const chain of parsed?.chains.keys() || []) select.add(new Option(chain, chain));
    }

    function clearComparisonResult() {
      state.comparison.request++;
      state.comparison.busy = false;
      state.comparison.result = null;
      comparisonEls.comparisonStatus.textContent = 'Choose chains, then align and overlay.';
      comparisonEls.comparisonStatus.classList.remove('warning-note');
      updateGifAvailability();
      renderStructure({ preserveView: true });
    }

    function resetComparison() {
      const c = state.comparison;
      c.request++;
      Object.assign(c, {text:'', parsed:null, pdb:null, result:null, busy:false});
      comparisonEls.comparisonPdb.value = '';
      comparisonEls.comparisonChain.replaceChildren();
      comparisonEls.showReference.checked = comparisonEls.showComparison.checked = true;
      comparisonEls.comparisonStatus.textContent = 'Choose a comparison PDB and one chain from each structure.';
      comparisonEls.comparisonStatus.classList.remove('warning-note');
      updateGifAvailability();
    }

    async function loadComparison() {
      if (state.gifExportBusy) return;
      const value = comparisonEls.comparisonPdb.value;
      resetComparison();
      comparisonEls.comparisonPdb.value = value;
      renderStructure({ preserveView: true });
      if (!value) return;
      const c = state.comparison, request = ++c.request;
      c.pdb = state.pdbs[Number(value)];
      c.busy = true;
      comparisonEls.comparisonStatus.textContent = 'Loading comparison…';
      updateGifAvailability();
      try {
        const text = await fetchText(c.pdb);
        if (request !== c.request) return;
        c.text = text;
        c.parsed = parsePdbText(text);
        if (!c.parsed.chains.size) throw new Error('No protein residues found in comparison PDB.');
        fillComparisonChains(comparisonEls.comparisonChain, c.parsed);
        comparisonEls.comparisonStatus.textContent = 'Choose chains, then align and overlay.';
      } catch (error) {
        if (request !== c.request) return;
        c.parsed = null;
        comparisonEls.comparisonStatus.textContent = `Comparison failed: ${error.message}`;
      } finally {
        if (request === c.request) { c.busy = false; updateGifAvailability(); }
      }
    }

    async function alignComparison() {
      const c = state.comparison;
      if (c.busy || state.pendingLoads || state.gifExportBusy || !state.parsed || !c.parsed) return;
      const initialView = state.viewer?.getView().slice();
      clearComparisonResult();
      const request = c.request;
      const check = () => { if (request !== c.request) throw new DOMException('Selection changed', 'AbortError'); };
      c.busy = true;
      comparisonEls.comparisonStatus.textContent = 'Aligning sequences and fitting Cα pairs…';
      updateGifAvailability();
      try {
        const matched = await ProteinAlignment.matchResidues(
          state.parsed.chains.get(comparisonEls.referenceChain.value) || [],
          c.parsed.chains.get(comparisonEls.comparisonChain.value) || [], check);
        const fit = await ProteinAlignment.fit(matched.pairs, check);
        check();
        c.result = { ...fit, count: matched.pairs.length, identity: matched.identity,
          referenceCoverage: matched.referenceCoverage, comparisonCoverage: matched.comparisonCoverage };
        const pct = value => `${(100*value).toFixed(1)}%`;
        comparisonEls.comparisonStatus.textContent = `${c.result.count} Cα pairs · RMSD ${fit.rmsd.toFixed(3)} Å · ` +
          `Sequence identity ${pct(matched.identity)} · Coverage: reference ${pct(matched.referenceCoverage)}, comparison ${pct(matched.comparisonCoverage)}. ` +
          'Metrics describe only the matched parts of the selected chains; sequence identity alone does not establish homology.' +
          (matched.identity < 0.3 ? ' Low sequence identity: this RMSD may not represent a meaningful comparison. The 30% threshold is a practical reminder, not a homology test.' : '');
        comparisonEls.comparisonStatus.classList.toggle('warning-note', matched.identity < 0.3);
        renderStructure({ preserveView: false });
      } catch (error) {
        if (request === c.request) {
          const hadResult = Boolean(c.result);
          c.result = null;
          if (hadResult) {
            renderStructure({ preserveView: false });
            if (initialView) state.viewer.setView(initialView);
          }
          comparisonEls.comparisonStatus.textContent = `Alignment failed: ${error.message}`;
        }
      } finally {
        if (request === c.request) { c.busy = false; updateGifAvailability(); }
      }
    }

    function initComparison() {
      for (const color of COLORS) comparisonEls.comparisonColor.add(new Option(color.name, color.hex));
      comparisonEls.comparisonColor.value = '#58C9D2';
      comparisonEls.comparisonPdb.addEventListener('change', loadComparison);
      comparisonEls.alignComparison.addEventListener('click', alignComparison);
      comparisonEls.removeComparison.addEventListener('click', () => {
        resetComparison(); renderStructure({ preserveView: true });
      });
      for (const el of [comparisonEls.referenceChain, comparisonEls.comparisonChain]) el.addEventListener('change', clearComparisonResult);
      for (const el of [comparisonEls.comparisonColor, comparisonEls.showReference, comparisonEls.showComparison])
        el.addEventListener('change', () => { renderStructure({ preserveView: true }); updateLocateControl(); });
    }

    const screenshotEls = Object.fromEntries(['saveScreenshot', 'screenshotStatus', 'screenshotResult']
      .map(id => [id, document.getElementById(id)]));

    async function saveScreenshot() {
      updateGifAvailability();
      if (screenshotEls.saveScreenshot.disabled) return;
      const viewer = state.viewer;
      const pdbName = state.pdbs[state.pdbIndex].name;
      const canvas = document.createElement('canvas');
      state.screenshotBusy = true;
      updateGifAvailability();
      screenshotEls.screenshotResult.hidden = true;
      screenshotEls.screenshotStatus.textContent = 'Capturing PNG…';
      try {
        // Copy both layers synchronously: later edits cannot change this snapshot.
        viewer.render();
        const source = viewer.getCanvas();
        canvas.width = source.width;
        canvas.height = source.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Could not create a capture canvas.');
        context.drawImage(source, 0, 0);
        context.drawImage(els.hotspotLabels, 0, 0);
        const blob = await new Promise((resolve, reject) => {
          canvas.toBlob(result => result ? resolve(result) : reject(new Error('PNG encoding failed.')), 'image/png');
        });
        if (blob.size > 64 * 1024 * 1024) throw new Error('PNG exceeds 64 MiB. Try a smaller viewer window.');
        screenshotEls.screenshotStatus.textContent = 'Saving to screenshots/…';
        const response = await fetch(`/__viewer/export-screenshot?pdb=${encodeURIComponent(pdbName)}`, {
          method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob,
          signal: AbortSignal.timeout(60000)
        });
        if (!response.ok) throw new Error(`Save failed (HTTP ${response.status}). Check screenshots/ permissions.`);
        const result = await response.json();
        screenshotEls.screenshotResult.href = result.path;
        screenshotEls.screenshotResult.textContent = result.path;
        screenshotEls.screenshotResult.hidden = false;
        screenshotEls.screenshotStatus.textContent = 'Screenshot saved. Open the file below to view it.';
      } catch (error) {
        screenshotEls.screenshotStatus.textContent = `Screenshot failed: ${error.message}`;
      } finally {
        canvas.width = canvas.height = 0;
        state.screenshotBusy = false;
        updateGifAvailability();
      }
    }

    function updateGifAvailability() {
      gifEls.exportGif.disabled = state.gifExportBusy || state.screenshotBusy || state.pendingLoads > 0 || state.comparison.busy || !state.viewer ||
        (!comparisonEls.showReference.checked && !(state.comparison.result && comparisonEls.showComparison.checked));
      screenshotEls.saveScreenshot.disabled = gifEls.exportGif.disabled || Boolean(state.viewer?.isAnimated());
      updateComparisonControls();
    }

    function encodeGif(encoder, signal) {
      return new Promise((resolve, reject) => {
        const finish = (error, blob) => {
          clearTimeout(timeout);
          signal.removeEventListener('abort', cancel);
          error ? reject(error) : resolve(blob);
        };
        const cancel = () => finish(new DOMException('Export cancelled', 'AbortError'));
        const timeout = setTimeout(() => finish(new Error('GIF encoding timed out. Try a smaller size.')), 120000);
        signal.addEventListener('abort', cancel, { once: true });
        encoder.on('finished', blob => finish(null, blob));
        encoder.on('progress', fraction => {
          gifEls.gifProgress.value = 40 + fraction * 50;
          gifEls.gifStatus.textContent = `Encoding GIF: ${Math.round(fraction * 100)}%`;
        });
        // gif.js 0.2.0 does not forward worker failures. Attach handlers before
        // dispatching work, so a missing/broken worker cannot leave the UI locked.
        const spawnWorkers = encoder.spawnWorkers;
        encoder.spawnWorkers = function () {
          const count = spawnWorkers.call(this);
          for (const worker of this.freeWorkers) {
            const failed = () => finish(new Error('GIF worker failed. Reload the page and try again.'));
            worker.addEventListener('error', failed);
            worker.addEventListener('messageerror', failed);
          }
          return count;
        };
        try {
          signal.throwIfAborted();
          encoder.render();
        } catch (error) {
          finish(error);
        }
      });
    }

    async function exportRotationGif() {
      if (state.gifExportBusy || state.screenshotBusy) return;
      const viewer = state.viewer;
      if (!viewer || state.pendingLoads || state.comparison.busy || viewer.isAnimated()) {
        gifEls.gifStatus.textContent = 'Wait for the structure to finish loading or moving, then export.';
        return;
      }
      if (!window.GIF) {
        gifEls.gifStatus.textContent = 'GIF encoder is missing. Check the local viewer_src/vendor files and reload.';
        return;
      }
      const size = Number(gifEls.gifSize.value);
      const seconds = Number(gifEls.gifDuration.value);
      const fps = Number(gifEls.gifFps.value);
      const background = gifEls.gifBackground.value;
      if (!['#ffffff', '#071019'].includes(background)) return;
      if (![480, 640, 800].includes(size) || ![2, 4, 6].includes(seconds) || ![10, 20].includes(fps)) return;
      const initialView = viewer.getView().slice();
      const originalStyle = els.viewer.getAttribute('style');
      const bounds = els.viewer.getBoundingClientRect();
      const locked = [...document.querySelectorAll('.sidebar > :not(#gifExportSection), .stage, #gifSettings')]
        .map(element => [element, element.inert]);
      const controller = new AbortController();
      const cancel = () => controller.abort();
      let encoder;
      let frameCanvas;
      state.gifExportBusy = true;
      updateGifAvailability();
      locked.forEach(([element]) => { element.inert = true; });
      gifEls.cancelGif.hidden = false;
      gifEls.cancelGif.disabled = false;
      gifEls.cancelGif.addEventListener('click', cancel);
      gifEls.gifProgress.hidden = false;
      gifEls.gifProgress.value = 0;
      gifEls.gifResult.hidden = true;
      gifEls.gifStatus.textContent = 'Capturing rotation…';
      try {
        state.labelBackground = background;
        viewer.setBackgroundColor(background, 1);
        // Freeze the viewport aspect ratio even if the browser window is resized.
        els.viewer.style.width = `${bounds.width}px`;
        els.viewer.style.height = `${bounds.height}px`;
        viewer.resize();
        const source = viewer.getCanvas();
        const scale = size / Math.max(source.width, source.height);
        frameCanvas = document.createElement('canvas');
        frameCanvas.width = Math.max(1, Math.round(source.width * scale));
        frameCanvas.height = Math.max(1, Math.round(source.height * scale));
        const context = frameCanvas.getContext('2d');
        if (!context) throw new Error('Could not create a capture canvas.');
        encoder = new GIF({
          // Sample every pixel so small colored hotspots survive GIF quantization.
          workers: 2, quality: 1, repeat: 0,
          width: frameCanvas.width, height: frameCanvas.height,
          workerScript: 'viewer_src/vendor/gif.js-0.2.0/gif.worker.js'
        });
        const frameCount = seconds * fps;
        for (let frame = 0; frame < frameCount; frame += 1) {
          // Yield between captures so progress, cancellation and heartbeats work.
          await new Promise(resolve => setTimeout(resolve, 0));
          controller.signal.throwIfAborted();
          viewer.setView(initialView);
          // rotate() renders immediately in 3Dmol; no geometry rebuild is needed.
          viewer.rotate(360 * frame / frameCount, 'vy');
          context.drawImage(source, 0, 0, frameCanvas.width, frameCanvas.height);
          context.drawImage(els.hotspotLabels, 0, 0, frameCanvas.width, frameCanvas.height);
          encoder.addFrame(context, { copy: true, delay: 1000 / fps });
          gifEls.gifProgress.value = 40 * (frame + 1) / frameCount;
          gifEls.gifStatus.textContent = `Capturing rotation: ${frame + 1}/${frameCount} frames`;
        }
        viewer.setView(initialView);
        viewer.render();
        gifEls.gifStatus.textContent = 'Encoding GIF…';
        const blob = await encodeGif(encoder, controller.signal);
        controller.signal.throwIfAborted();
        if (blob.size > 64 * 1024 * 1024) throw new Error('GIF exceeds 64 MiB. Try a smaller size or fewer frames.');
        gifEls.cancelGif.disabled = true;
        gifEls.gifStatus.textContent = 'Saving to gifs/…';
        gifEls.gifProgress.value = 90;
        const pdbName = state.pdbs[state.pdbIndex].name;
        const response = await fetch(`/__viewer/export-gif?pdb=${encodeURIComponent(pdbName)}`, {
          method: 'POST', headers: { 'Content-Type': 'image/gif' }, body: blob,
          signal: AbortSignal.timeout(60000)
        });
        if (!response.ok) {
          throw new Error(`Save failed (HTTP ${response.status}). Run build_viewer.py and check gifs/ permissions.`);
        }
        const result = await response.json();
        gifEls.gifResult.href = result.path;
        gifEls.gifResult.textContent = result.path;
        gifEls.gifResult.hidden = false;
        gifEls.gifProgress.value = 100;
        gifEls.gifStatus.textContent = 'GIF saved. Open the file below to view it.';
      } catch (error) {
        gifEls.gifStatus.textContent = controller.signal.aborted ? 'Export cancelled. No GIF was saved.' : `Export failed: ${error.message}`;
      } finally {
        if (encoder) {
          // abort() only terminates active workers; completed workers also need cleanup.
          for (const worker of [...encoder.activeWorkers, ...encoder.freeWorkers]) worker.terminate();
          encoder.frames = [];
          encoder.imageParts = [];
          encoder.activeWorkers = [];
          encoder.freeWorkers = [];
        }
        if (frameCanvas) frameCanvas.width = frameCanvas.height = 0;
        if (originalStyle === null) els.viewer.removeAttribute('style');
        else els.viewer.setAttribute('style', originalStyle);
        try {
          state.labelBackground = null;
          viewer.setBackgroundColor(viewerBackgroundColor(), 1);
          viewer.resize();
          viewer.setView(initialView);
          viewer.render();
        } finally {
          locked.forEach(([element, inert]) => { element.inert = inert; });
          state.gifExportBusy = false;
          updateGifAvailability();
          gifEls.cancelGif.removeEventListener('click', cancel);
          gifEls.cancelGif.hidden = true;
          gifEls.gifProgress.hidden = true;
        }
      }
    }

    function currentTheme() {
      return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    }

    function viewerBackgroundColor() {
      return getComputedStyle(document.documentElement).getPropertyValue('--viewer').trim();
    }

    function updateThemeToggle() {
      const targetTheme = currentTheme() === 'dark' ? 'light' : 'dark';
      const action = 'Switch to ' + targetTheme + ' theme';
      els.themeToggleLabel.textContent = targetTheme[0].toUpperCase() + targetTheme.slice(1) + ' mode';
      els.themeToggle.setAttribute('aria-label', action);
      els.themeToggle.title = action;
    }

    function setTheme(theme) {
      const nextTheme = theme === 'light' ? 'light' : 'dark';
      document.documentElement.dataset.theme = nextTheme;
      try {
        localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      } catch {}
      updateThemeToggle();
      state.viewer?.setBackgroundColor(viewerBackgroundColor(), 1);
    }

    function initThemeToggle() {
      updateThemeToggle();
      els.themeToggle.addEventListener('click', () => {
        setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
      });
    }

    function newViewerSessionId() {
      return window.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    }

    let viewerSessionId = newViewerSessionId();
    let viewerSessionClosed = false;
    let viewerHeartbeatTimer = null;

    function heartbeatViewerSession() {
      if (viewerSessionClosed) return;
      fetch(`/__viewer/heartbeat?session=${encodeURIComponent(viewerSessionId)}`, { cache: 'no-store', keepalive: true }).catch(() => {});
    }

    function startViewerSession() {
      viewerSessionId = newViewerSessionId();
      viewerSessionClosed = false;
      heartbeatViewerSession();
      viewerHeartbeatTimer = setInterval(heartbeatViewerSession, 10000);
    }

    function closeViewerSession() {
      if (viewerSessionClosed) return;
      viewerSessionClosed = true;
      clearInterval(viewerHeartbeatTimer);
      if (navigator.sendBeacon) navigator.sendBeacon('/__viewer/close', viewerSessionId);
    }

    heartbeatViewerSession();
    viewerHeartbeatTimer = setInterval(heartbeatViewerSession, 10000);
    window.addEventListener('pagehide', closeViewerSession);
    window.addEventListener('pageshow', event => {
      if (event.persisted && viewerSessionClosed) startViewerSession();
    });

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[char]));
    }

    function residueLabel(chain, resseq, icode = '') {
      return `${chain}${resseq}${icode || ''}`;
    }

    function residueKey(chain, resseq, icode = '') {
      return `${chain}|${Number(resseq)}|${icode || ''}`;
    }

    function hotspotKey(hotspot) {
      return `${hotspot.chain}|${Number(hotspot.resseq)}`;
    }

    function colorByName(name) {
      return COLORS.find(color => color.name === name) || DEFAULT_COLOR;
    }

    function chainColorByName(name) {
      return CHAIN_COLORS.find(color => color.name === name) || DEFAULT_CHAIN_COLOR;
    }

    function colorPickerValue(picker) {
      return picker.dataset.colorValue;
    }

    function setColorPickerValue(picker, colorName) {
      const color = picker.id.startsWith('chain') ? chainColorByName(colorName) : colorByName(colorName);
      picker.dataset.colorValue = color.name;
      picker.querySelector('.picker-current-name').textContent = color.name;
      picker.querySelector('.picker-current-swatch').style.setProperty('--swatch-color', color.hex);
      for (const option of picker.querySelectorAll('.color-option')) {
        option.setAttribute('aria-pressed', String(option.dataset.colorName === color.name));
      }
    }

    function setColorPickerDisabled(picker, disabled) {
      const isDisabled = Boolean(disabled);
      picker.setAttribute('aria-disabled', String(isDisabled));
      const summary = picker.querySelector('summary');
      summary.setAttribute('aria-disabled', String(isDisabled));
      summary.tabIndex = isDisabled ? -1 : 0;
      if (isDisabled) picker.open = false;
      for (const option of picker.querySelectorAll('.color-option')) {
        option.disabled = isDisabled;
      }
    }

    function setupColorPicker(picker, colors, onSelect) {
      const options = picker.querySelector('.color-options');
      const summary = picker.querySelector('summary');
      options.replaceChildren();

      for (const color of colors) {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'color-option';
        option.dataset.colorName = color.name;
        option.setAttribute('aria-pressed', 'false');
        const swatch = document.createElement('span');
        swatch.className = 'palette-swatch';
        swatch.style.setProperty('--swatch-color', color.hex);
        swatch.setAttribute('aria-hidden', 'true');
        const name = document.createElement('span');
        name.className = 'color-option-name';
        name.textContent = color.name;
        option.append(swatch, name);
        option.addEventListener('click', () => {
          if (picker.getAttribute('aria-disabled') === 'true') return;
          const changed = colorPickerValue(picker) !== color.name;
          setColorPickerValue(picker, color.name);
          picker.open = false;
          summary.focus();
          if (changed) onSelect();
        });
        options.append(option);
      }

      summary.addEventListener('click', event => {
        if (picker.getAttribute('aria-disabled') === 'true') event.preventDefault();
      });
      picker.addEventListener('keydown', event => {
        if (event.key === 'Escape' && picker.open) {
          event.preventDefault();
          picker.open = false;
          summary.focus();
        }
      });
      setColorPickerValue(picker, picker.dataset.colorValue || colors[0].name);
      setColorPickerDisabled(picker, picker.getAttribute('aria-disabled') === 'true');
    }

    function chainColorPicker(chain) {
      return chain === 'A' ? els.chainAColor : els.chainBColor;
    }

    function setStatus(message, kind = 'ok') {
      els.status.className = `status ${kind === 'warning' ? 'warn' : kind === 'error' ? 'error' : ''}`;
      els.status.textContent = message;
    }

    async function fetchManifest() {
      const response = await fetch('pdbs/manifest.json', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Could not load pdbs/manifest.json (${response.status})`);
      }
      const manifest = await response.json();
      if (!Array.isArray(manifest)) {
        throw new Error('pdbs/manifest.json must contain a JSON array.');
      }
      return manifest;
    }

    async function fetchHotspotManifest() {
      const response = await fetch('hotspots/manifest.json', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Could not load hotspots/manifest.json (${response.status})`);
      }
      const manifest = await response.json();
      if (!Array.isArray(manifest)) {
        throw new Error('hotspots/manifest.json must contain a JSON array.');
      }
      return manifest;
    }

    async function fetchText(file) {
      const response = await fetch(file.path, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Could not load ${file.path} (${response.status})`);
      }
      return response.text();
    }

    function parsePdbText(pdbText) {
      const residues = new Map();
      const chains = new Map();

      for (const line of pdbText.split(/\r?\n/)) {
        if (line.startsWith('ENDMDL')) break;
        if (!line.startsWith('ATOM')) continue;
        if (![' ', 'A'].includes(line.charAt(16))) continue;
        const resname3 = (line.slice(17, 20).trim().toUpperCase() || 'UNK');
        const chain = (line.slice(21, 22).trim() || '_');
        const resseqText = line.slice(22, 26).trim();
        const icode = line.slice(26, 27).trim().toUpperCase();
        const atomName = line.slice(12, 16).trim().toUpperCase();
        if (!resseqText) continue;
        const resseq = Number.parseInt(resseqText, 10);
        const x = Number.parseFloat(line.slice(30, 38));
        const y = Number.parseFloat(line.slice(38, 46));
        const z = Number.parseFloat(line.slice(46, 54));
        if (!Number.isFinite(resseq) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;

        const key = residueKey(chain, resseq, icode);
        const coord = { x, y, z };
        if (residues.has(key)) {
          if (atomName === 'CA') {
            if (!residues.get(key).ca) {
              residues.get(key).coord = coord;
              residues.get(key).ca = coord;
            }
          }
          continue;
        }

        const residue = {
          chain,
          resseq,
          icode,
          residueId: residueLabel(chain, resseq, icode),
          resname3,
          resname1: AA3_TO_AA1[resname3] || 'X',
          ca: atomName === 'CA' ? coord : null,
          coord
        };
        residues.set(key, residue);
        if (!chains.has(chain)) chains.set(chain, []);
        chains.get(chain).push(residue);
      }

      const sequences = new Map();
      for (const [chain, chainResidues] of chains.entries()) {
        sequences.set(chain, chainResidues.map(residue => residue.resname1).join(''));
      }
      return { residues, chains, sequences };
    }

    function parseHotspotText(text) {
      const matches = [];
      const seen = new Set();
      let remainder = text || '';
      remainder = remainder.replace(HOTSPOT_PATTERN, (full, prefix, chain, resseqText) => {
        const key = `${chain.toUpperCase()}|${Number.parseInt(resseqText, 10)}`;
        if (!seen.has(key)) {
          seen.add(key);
          matches.push({ chain: chain.toUpperCase(), resseq: Number.parseInt(resseqText, 10) });
        }
        return prefix ? prefix + ' ' : ' ';
      });
      const invalid = remainder.split(/[,;\s]+/).map(token => token.trim()).filter(Boolean);
      return { matches, invalid };
    }

    function sequenceContext(chain, resseq, windowSize = 7) {
      const residues = state.parsed?.chains.get(chain) || [];
      const index = residues.findIndex(residue => residue.resseq === Number(resseq) && !residue.icode);
      if (index < 0) return '';
      const start = Math.max(0, index - windowSize);
      const end = Math.min(residues.length, index + windowSize + 1);
      const left = residues.slice(start, index).map(residue => residue.resname1).join('');
      const right = residues.slice(index + 1, end).map(residue => residue.resname1).join('');
      return `${residues[start].residueId}..${residues[end - 1].residueId}: ${left}[${residues[index].resname1}]${right}`;
    }

    function buildHotspotRows() {
      if (!state.parsed) return [];
      const rows = [];
      for (const hotspot of state.hotspots) {
        const exact = state.parsed.residues.get(residueKey(hotspot.chain, hotspot.resseq, ''));
        if (exact) {
          rows.push({
            hotspot: residueLabel(hotspot.chain, hotspot.resseq),
            chain: hotspot.chain,
            residueNumber: hotspot.resseq,
            resname3: exact.resname3,
            resname1: exact.resname1,
            colorName: hotspot.colorName,
            colorHex: hotspot.colorHex,
            found: true,
            context: sequenceContext(hotspot.chain, hotspot.resseq),
            coord: exact.coord
          });
        } else {
          const insertionCodes = [];
          for (const residue of state.parsed.residues.values()) {
            if (residue.chain === hotspot.chain && residue.resseq === Number(hotspot.resseq) && residue.icode) {
              insertionCodes.push(residue.icode);
            }
          }
          rows.push({
            hotspot: residueLabel(hotspot.chain, hotspot.resseq),
            chain: hotspot.chain,
            residueNumber: hotspot.resseq,
            resname3: '',
            resname1: '',
            colorName: hotspot.colorName,
            colorHex: hotspot.colorHex,
            found: false,
            context: insertionCodes.length ? `missing exact residue; insertion codes present: ${insertionCodes.join(',')}` : 'missing',
            coord: null
          });
        }
      }
      return rows;
    }

    function renderSequences() {
      if (!state.parsed) {
        els.sequenceSummary.textContent = '0';
        els.sequencePanel.innerHTML = '<p class="empty">No PDB loaded.</p>';
        return;
      }
      const rows = [];
      for (const [chain, residues] of state.parsed.chains.entries()) {
        if (!residues.length) continue;
        rows.push(`
          <tr>
            <td>${escapeHtml(chain)}</td>
            <td>${residues.length}</td>
            <td>${escapeHtml(residues[0].residueId)}</td>
            <td>${escapeHtml(residues[residues.length - 1].residueId)}</td>
            <td><div class="sequence" title="${escapeHtml(state.parsed.sequences.get(chain))}">${escapeHtml(state.parsed.sequences.get(chain))}</div></td>
          </tr>`);
      }
      els.sequenceSummary.textContent = String(rows.length);
      els.sequencePanel.innerHTML = `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Chain</th><th>Residues</th><th>Start</th><th>End</th><th>Sequence</th></tr></thead>
            <tbody>${rows.join('')}</tbody>
          </table>
        </div>`;
    }

    function renderHotspotTable(rows = buildHotspotRows()) {
      els.hotspotSummary.textContent = String(rows.length);
      if (!rows.length) {
        els.hotspotPanel.innerHTML = '<p class="empty">No hotspots selected.</p>';
        return;
      }
      const selectedKey = els.selectedHotspot.value;
      els.hotspotPanel.innerHTML = `
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Residue</th><th>Chain</th><th>Position</th><th>Amino acid</th><th>Color</th><th>In model</th><th>Sequence context</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(row => {
                const key = hotspotKey({ chain: row.chain, resseq: row.residueNumber });
                const selected = key === selectedKey;
                return `
                <tr class="hotspot-row${selected ? ' is-selected' : ''}">
                  <td><button class="hotspot-select" type="button" data-hotspot-key="${escapeHtml(key)}" aria-current="${selected ? 'true' : 'false'}" aria-label="Select hotspot ${escapeHtml(row.hotspot)}">${escapeHtml(row.hotspot)}</button></td>
                  <td>${escapeHtml(row.chain)}</td>
                  <td>${row.residueNumber}</td>
                  <td>${escapeHtml(row.resname3)}${row.resname1 ? ` / ${escapeHtml(row.resname1)}` : ''}</td>
                  <td><span class="color-swatch" style="background:${escapeHtml(row.colorHex)}"></span>${escapeHtml(row.colorName)} ${escapeHtml(row.colorHex)}</td>
                  <td><span class="availability${row.found ? '' : ' missing'}">${row.found ? 'Found' : 'Missing'}</span></td>
                  <td><div class="context" title="${escapeHtml(row.context)}">${escapeHtml(row.context)}</div></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`;
    }

    function updateSelectedControls(rows) {
      const current = els.selectedHotspot.value;
      els.selectedHotspot.innerHTML = '';
      if (!state.hotspots.length) {
        els.selectedHotspotSection.hidden = true;
        els.selectedHotspot.add(new Option('No hotspots selected', ''));
        els.selectedHotspot.disabled = true;
        setColorPickerDisabled(els.selectedColor, true);
        els.deleteSelected.disabled = true;
        els.locateHotspot.disabled = true;
        els.locateNote.hidden = true;
        setColorPickerValue(els.selectedColor, DEFAULT_COLOR.name);
        return;
      }
      const wasHidden = els.selectedHotspotSection.hidden;
      els.selectedHotspotSection.hidden = false;
      if (wasHidden) els.selectedHotspotSection.open = true;
      for (const hotspot of state.hotspots) {
        const key = hotspotKey(hotspot);
        const row = rows.find(item => item.chain === hotspot.chain && item.residueNumber === hotspot.resseq);
        const identity = row?.found ? ` ${row.resname3}/${row.resname1}` : ' missing';
        els.selectedHotspot.add(new Option(`${residueLabel(hotspot.chain, hotspot.resseq)}${identity} [${hotspot.colorName}]`, key));
      }
      els.selectedHotspot.disabled = false;
      setColorPickerDisabled(els.selectedColor, false);
      els.deleteSelected.disabled = false;
      els.selectedHotspot.value = [...els.selectedHotspot.options].some(option => option.value === current) ? current : els.selectedHotspot.options[0].value;
      const selected = state.hotspots.find(hotspot => hotspotKey(hotspot) === els.selectedHotspot.value);
      setColorPickerValue(els.selectedColor, selected?.colorName || DEFAULT_COLOR.name);
      updateLabelControls();
      updateLocateControl(rows);
    }

    function updateLocateControl(rows = buildHotspotRows()) {
      const selectedKey = els.selectedHotspot.value;
      const row = rows.find(item => hotspotKey({ chain: item.chain, resseq: item.residueNumber }) === selectedKey);
      const canLocate = Boolean(row?.found);
      els.locateHotspot.disabled = !canLocate || !comparisonEls.showReference.checked;
      els.locateNote.hidden = !selectedKey || canLocate;
      els.locateNote.textContent = selectedKey && !canLocate
        ? 'This residue is not present in the loaded structure.'
        : '';
    }

    function resetChainColors() {
      for (const chain of COLORABLE_CHAINS) {
        state.chainColors[chain] = DEFAULT_CHAIN_COLOR.name;
        setColorPickerValue(chainColorPicker(chain), DEFAULT_CHAIN_COLOR.name);
      }
    }

    function updateChainColorControls() {
      const missing = [];
      for (const chain of COLORABLE_CHAINS) {
        const picker = chainColorPicker(chain);
        const exists = Boolean(state.parsed?.chains.has(chain));
        setColorPickerDisabled(picker, !exists);
        if (!exists) {
          setColorPickerValue(picker, DEFAULT_CHAIN_COLOR.name);
          missing.push(chain);
        } else {
          setColorPickerValue(picker, state.chainColors[chain] || DEFAULT_CHAIN_COLOR.name);
        }
      }
      els.chainColorNote.textContent = missing.length
        ? `Chain ${missing.join(' and chain ')} not found in this PDB.`
        : '';
    }

    function updateChainColor(chain) {
      const color = chainColorByName(colorPickerValue(chainColorPicker(chain)));
      state.chainColors[chain] = color.name;
      renderAll(`Updated chain ${chain} color to ${color.name}.`);
    }

    function selectedLabelHotspot() {
      return state.hotspots.find(h => hotspotKey(h) === els.selectedHotspot.value);
    }

    function updateLabelControls() {
      const hotspot = selectedLabelHotspot();
      els.labelText.value = hotspot?.labelText || (hotspot ? residueLabel(hotspot.chain, hotspot.resseq) : '');
      els.labelPinned.checked = Boolean(hotspot?.labelPosition);
    }

    function initLabelEditing() {
      els.labelText.addEventListener('input', () => {
        const hotspot = selectedLabelHotspot();
        if (!hotspot || state.gifExportBusy) return;
        hotspot.labelText = [...els.labelText.value.replace(/[\r\n]/g, ' ')].slice(0, 80).join('').trim();
        state.redrawLabels?.();
      });
      els.labelText.addEventListener('blur', updateLabelControls);
      els.labelPinned.addEventListener('change', () => {
        const hotspot = selectedLabelHotspot();
        if (!hotspot || state.gifExportBusy) return;
        const box = state.labelBoxes.find(b => b.key === hotspotKey(hotspot));
        const bounds = els.hotspotLabels.getBoundingClientRect();
        hotspot.labelPosition = els.labelPinned.checked
          ? { x: (box?.x ?? bounds.width / 2) / bounds.width,
              y: (box?.y ?? bounds.height / 2) / bounds.height } : null;
        state.redrawLabels?.();
        updateLabelControls();
      });
      const viewport = els.viewer.parentElement;
      let drag = null;
      const point = event => {
        const bounds = els.hotspotLabels.getBoundingClientRect();
        return { x: event.clientX - bounds.left, y: event.clientY - bounds.top, bounds };
      };
      viewport.addEventListener('pointerdown', event => {
        if (state.gifExportBusy || event.button !== 0 || drag) return;
        const p = point(event);
        const box = [...state.labelBoxes].reverse().find(b =>
          p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height);
        if (!box) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        drag = { key: box.key, id: event.pointerId, dx: p.x - box.x, dy: p.y - box.y,
          startX: p.x, startY: p.y, width: box.width, height: box.height };
        viewport.setPointerCapture(event.pointerId);
        selectHotspot(box.key);
      }, true);
      viewport.addEventListener('pointermove', event => {
        if (!drag || event.pointerId !== drag.id) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (state.gifExportBusy) return;
        const p = point(event);
        if (!drag.moved && Math.hypot(p.x - drag.startX, p.y - drag.startY) < 3) return;
        drag.moved = true;
        const hotspot = state.hotspots.find(h => hotspotKey(h) === drag.key);
        if (!hotspot) return;
        hotspot.labelPosition = {
          x: Math.max(0, Math.min(p.bounds.width - drag.width, p.x - drag.dx)) / p.bounds.width,
          y: Math.max(0, Math.min(p.bounds.height - drag.height, p.y - drag.dy)) / p.bounds.height
        };
        state.redrawLabels?.();
        els.labelPinned.checked = true;
      }, true);
      const finish = event => {
        if (!drag || event.pointerId !== drag.id) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const id = drag.id;
        drag = null;
        if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id);
      };
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) viewport.addEventListener(type, finish, true);
      // 3Dmol also listens to legacy mouse/touch events; label drags must not reach it.
      for (const type of ['mousedown', 'mousemove', 'mouseup', 'touchstart', 'touchmove', 'touchend']) {
        viewport.addEventListener(type, event => {
          if (drag) { event.preventDefault(); event.stopImmediatePropagation(); }
        }, { capture: true, passive: false });
      }
    }

    function drawHotspotLabels(viewer, rows, structureCoords) {
      const canvas = els.hotspotLabels;
      const source = viewer.getCanvas();
      const bounds = source.getBoundingClientRect();
      const width = bounds.width, height = bounds.height;
      if (!width || !height) return;
      if (canvas.width !== source.width || canvas.height !== source.height) {
        canvas.width = source.width;
        canvas.height = source.height;
      }
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
      ctx.clearRect(0, 0, width, height);
      state.labelBoxes = [];
      if (!comparisonEls.showReference.checked) return;
      // 3Dmol returns page coordinates, while this layer uses canvas-local pixels.
      const local = point => ({ x: point.x - bounds.left - window.scrollX,
        y: point.y - bounds.top - window.scrollY });
      const projected = viewer.modelToScreen(structureCoords).map(local);
      let minX = width, maxX = 0;
      for (const point of projected) {
        if (Number.isFinite(point.x)) {
          minX = Math.min(minX, point.x);
          maxX = Math.max(maxX, point.x);
        }
      }
      const center = Math.max(0, Math.min(width, (minX + maxX) / 2));
      ctx.font = '12px Arial, sans-serif';
      ctx.textBaseline = 'middle';
      const margin = 8, labelHeight = 20, gap = 5;
      const capacity = Math.max(0, Math.floor((height - 2 * margin + gap) / (labelHeight + gap)));
      const groups = [[], []];
      const pinned = [];
      const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x &&
        a.y < b.y + b.height && a.y + a.height > b.y;
      const makeBox = (row, point, selected, hotspot) => {
        let text = hotspot.labelText || row.hotspot;
        const maxWidth = Math.max(10, Math.min(width / 2 - 2 * margin, 260));
        if (ctx.measureText(text).width + 10 > maxWidth) {
          let chars = [...text];
          while (chars.length && ctx.measureText(chars.join('') + '…').width + 10 > maxWidth) chars.pop();
          text = chars.join('') + '…';
        }
        return { key: hotspotKey(hotspot), text, point, selected,
          width: ctx.measureText(text).width + 10, height: labelHeight };
      };
      for (const row of rows) {
        if (!row.found || !row.coord) continue;
        const point = local(viewer.modelToScreen(row.coord));
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y) ||
            point.x < 0 || point.x > width || point.y < 0 || point.y > height) continue;
        const selected = hotspotKey({ chain: row.chain, resseq: row.residueNumber }) === els.selectedHotspot.value;
        const hotspot = state.hotspots.find(h => h.chain === row.chain && h.resseq === row.residueNumber);
        if (!hotspot) continue;
        const box = makeBox(row, point, selected, hotspot);
        if (hotspot.labelPosition) {
          box.x = Math.max(0, Math.min(width - box.width, hotspot.labelPosition.x * width));
          box.y = Math.max(0, Math.min(height - box.height, hotspot.labelPosition.y * height));
          pinned.push(box);
        } else groups[point.x < center ? 0 : 1].push(box);
      }
      const dark = (state.labelBackground || viewerBackgroundColor()).toLowerCase() === '#071019';
      ctx.strokeStyle = dark ? '#cbd5e1' : '#475569';
      ctx.lineWidth = 1;
      for (const [side, group] of groups.entries()) {
        // Prioritize the selected hotspot if the viewport cannot fit every label.
        const visible = group.sort((a, b) => Number(b.selected) - Number(a.selected))
          .slice(0, capacity).sort((a, b) => a.point.y - b.point.y);
        let bottom = margin - gap;
        for (const item of visible) {
          item.y = Math.max(bottom + gap, Math.min(height - margin - labelHeight, item.point.y - labelHeight / 2));
          bottom = item.y + labelHeight;
        }
        let next = height - margin + gap;
        for (let i = visible.length - 1; i >= 0; i--) {
          visible[i].y = Math.min(visible[i].y, next - gap - labelHeight);
          next = visible[i].y;
        }
        for (const box of visible.sort((a, b) => Number(b.selected) - Number(a.selected))) {
          box.x = side === 0
            ? Math.max(margin, Math.min(width / 2 - box.width - gap, minX - 16 - box.width))
            : Math.min(width - margin - box.width, Math.max(width / 2 + gap, maxX + 16));
          if (pinned.some(p => overlaps(box, p))) {
            let found = false;
            for (let y = margin; y + labelHeight <= height - margin; y += labelHeight + gap) {
              box.y = y;
              if (![...pinned, ...state.labelBoxes].some(p => overlaps(box, p))) { found = true; break; }
            }
            if (!found) continue;
          }
          if (!state.labelBoxes.some(p => overlaps(box, p))) state.labelBoxes.push(box);
        }
      }
      state.labelBoxes.push(...pinned);
      state.labelBoxes.sort((a, b) => Number(a.selected) - Number(b.selected));
      // Draw all lines first so no later line can cross over a label's text.
      for (const box of state.labelBoxes) {
        ctx.beginPath();
        ctx.moveTo(box.point.x, box.point.y);
        ctx.lineTo(box.point.x < box.x + box.width / 2 ? box.x : box.x + box.width, box.y + labelHeight / 2);
        ctx.stroke();
      }
      for (const box of state.labelBoxes) {
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = box.selected ? '#f1c75b' : '#ffffff';
        ctx.fillRect(box.x, box.y, box.width, labelHeight);
        ctx.globalAlpha = 1;
        ctx.fillStyle = box.selected ? '#182520' : '#000000';
        ctx.fillText(box.text, box.x + 5, box.y + labelHeight / 2);
      }
    }

    function renderStructure({ preserveView = false, rows = buildHotspotRows() } = {}) {
      gifEls.exportGif.disabled = true;
      screenshotEls.saveScreenshot.disabled = true;
      let previousView = null;
      if (preserveView && state.viewer && typeof state.viewer.getView === 'function') {
        try { previousView = state.viewer.getView(); } catch (error) {}
      }
      state.labelBoxes = [];
      state.redrawLabels = null;
      els.hotspotLabels.width = els.hotspotLabels.height = 0;
      els.viewer.innerHTML = '';
      if (state.viewer) {
        state.viewer.setViewChangeCallback(null);
        try { state.viewer.clear(); } catch (error) {}
        state.viewer = null;
      }
      if (!state.parsed || !state.pdbText) {
        els.viewer.innerHTML = '<div class="empty">No PDB loaded.</div>';
        return;
      }
      if (!window.$3Dmol) {
        els.viewer.innerHTML = '<div class="empty" style="color: var(--danger);">3Dmol.js is not loaded. Check network access to jsDelivr.</div>';
        return;
      }
      const viewer = $3Dmol.createViewer(els.viewer, { backgroundColor: viewerBackgroundColor() });
      state.viewer = viewer;
      const reference = viewer.addModel(state.pdbText, 'pdb');
      viewer.setStyle({ model: reference }, { cartoon: { color: '#cbd5e1' } });
      for (const chain of COLORABLE_CHAINS) {
        if (!state.parsed.chains.has(chain)) continue;
        const color = chainColorByName(state.chainColors[chain]);
        viewer.setStyle({ model: reference, chain }, { cartoon: { color: color.hex } });
      }
      viewer.addStyle({ model: reference, hetflag: true }, { stick: { color: '#9ca3af', radius: 0.16 } });
      for (const row of rows) {
        if (!row.found) continue;
        const selector = { model: reference, chain: row.chain, resi: String(row.residueNumber) };
        const selected = hotspotKey({ chain: row.chain, resseq: row.residueNumber }) === els.selectedHotspot.value;
        if (selected) {
          viewer.addStyle(selector, { sphere: { color: '#f1c75b', scale: 0.72, opacity: 0.88 } });
        }
        viewer.addStyle(selector, { stick: { color: row.colorHex, radius: 0.28 } });
        viewer.addStyle(selector, { sphere: { color: row.colorHex, scale: 0.36 } });
      }
      const visibleModels = [];
      if (comparisonEls.showReference.checked) visibleModels.push(reference);
      else reference.hide();
      if (state.comparison.result) {
        const comparison = viewer.addModel(state.comparison.text, 'pdb');
        for (const atom of comparison.selectedAtoms({})) Object.assign(atom, state.comparison.result.transform(atom));
        comparison.setStyle({}, { cartoon: { color: comparisonEls.comparisonColor.value } });
        viewer.addStyle({ model: comparison, hetflag: true }, { stick: { color: comparisonEls.comparisonColor.value, radius: 0.16 } });
        if (comparisonEls.showComparison.checked) visibleModels.push(comparison);
        else comparison.hide();
      }
      // Render the annotations after WebGL, without triggering another viewer render.
      const structureCoords = viewer.selectedAtoms({ model: visibleModels }).map(({ x, y, z }) => ({ x, y, z }));
      state.redrawLabels = () => drawHotspotLabels(viewer, rows, structureCoords);
      viewer.setViewChangeCallback(state.redrawLabels);

      if (previousView && typeof viewer.setView === 'function') {
        viewer.setView(previousView);
      } else {
        if (visibleModels.length) viewer.zoomTo({ model: visibleModels });
      }
      viewer.render();
      const name = state.pdbs[state.pdbIndex]?.name || 'No PDB';
      els.viewerTitle.textContent = state.comparison.result ? `${name} + ${state.comparison.pdb.name}` : name;
      updateGifAvailability();
    }

    function renderAll(message, kind = 'ok', { preserveView = true } = {}) {
      const rows = buildHotspotRows();
      renderSequences();
      updateChainColorControls();
      updateSelectedControls(rows);
      renderHotspotTable(rows);
      renderStructure({ preserveView, rows });
      if (message) setStatus(message, kind);
      const pdbName = state.pdbs[state.pdbIndex]?.name || 'No PDB';
      els.viewerTitle.textContent = state.comparison.result ? `${pdbName} + ${state.comparison.pdb.name}` : pdbName;
      els.viewerMeta.textContent = `${state.hotspots.length} hotspot(s), one active 3Dmol viewer`;
    }

    function selectHotspot(key) {
      const optionExists = [...els.selectedHotspot.options].some(option => option.value === key);
      if (!optionExists) return;
      const hotspot = state.hotspots.find(item => hotspotKey(item) === key);
      if (!hotspot) return;
      const rows = buildHotspotRows();
      const row = rows.find(item => hotspotKey({ chain: item.chain, resseq: item.residueNumber }) === key);
      els.selectedHotspot.value = key;
      updateLabelControls();
      setColorPickerValue(els.selectedColor, hotspot.colorName);
      els.selectedHotspotSection.open = true;
      renderHotspotTable(rows);
      updateLocateControl(rows);
      renderStructure({ preserveView: true, rows });
      setStatus(row?.found ? `Selected ${residueLabel(hotspot.chain, hotspot.resseq)}.` : `${residueLabel(hotspot.chain, hotspot.resseq)} is not present in this structure.`, row?.found ? 'ok' : 'warning');
    }

    function locateSelectedHotspot() {
      const key = els.selectedHotspot.value;
      const rows = buildHotspotRows();
      const row = rows.find(item => hotspotKey({ chain: item.chain, resseq: item.residueNumber }) === key);
      if (!row?.found || !state.viewer || !comparisonEls.showReference.checked) {
        updateLocateControl(rows);
        return;
      }
      state.viewer.zoomTo({ model: 0, chain: row.chain, resi: String(row.residueNumber) }, 450);
      const updateAfterAnimation = () => {
        updateGifAvailability();
        if (state.viewer?.isAnimated()) requestAnimationFrame(updateAfterAnimation);
      };
      updateAfterAnimation();
      state.viewer.render();
      setStatus(`Centered on ${row.hotspot}.`);
    }

    async function loadPdb(index, { initialLoad = false } = {}) {
      resetComparison();
      comparisonEls.referenceChain.replaceChildren();
      const requestId = ++state.pdbLoadRequest;
      const clearedHotspots = state.hotspots.length;
      state.pdbIndex = Number(index) || 0;
      const pdb = state.pdbs[state.pdbIndex];
      if (!pdb) {
        state.pdbText = '';
        state.parsed = null;
        state.hotspots = [];
        resetChainColors();
        renderAll(clearedHotspots ? `No PDB selected. Cleared ${clearedHotspots} hotspot(s).` : 'No PDB selected.', 'warning', { preserveView: false });
        return;
      }
      setStatus(`Loading ${pdb.name}...`);
      state.pendingLoads += 1;
      updateGifAvailability();
      try {
        const pdbText = await fetchText(pdb);
        if (requestId !== state.pdbLoadRequest) return;
        state.pdbText = pdbText;
        state.parsed = parsePdbText(state.pdbText);
        fillComparisonChains(comparisonEls.referenceChain, state.parsed);
        state.hotspots = [];
        resetChainColors();
        const residueCount = state.parsed.residues.size;
        const chainCount = state.parsed.chains.size;
        const resetMessage = !initialLoad && clearedHotspots ? ` Cleared ${clearedHotspots} hotspot(s).` : '';
        renderAll(`Loaded ${pdb.name}: ${residueCount} residues across ${chainCount} chain(s).${resetMessage}`, 'ok', { preserveView: false });
      } catch (error) {
        if (requestId !== state.pdbLoadRequest) return;
        state.pdbText = '';
        state.parsed = null;
        state.hotspots = [];
        resetChainColors();
        const resetMessage = !initialLoad && clearedHotspots ? ` Cleared ${clearedHotspots} hotspot(s).` : '';
        renderAll(`Failed to load ${pdb.name}: ${error.message}.${resetMessage}`, 'error', { preserveView: false });
      } finally {
        state.pendingLoads -= 1;
        updateGifAvailability();
      }
    }

    function addParsedHotspots(matches, color) {
      const existing = new Set(state.hotspots.map(hotspotKey));
      let added = 0;
      let duplicates = 0;
      for (const match of matches) {
        const key = `${match.chain}|${match.resseq}`;
        if (existing.has(key)) {
          duplicates += 1;
          continue;
        }
        state.hotspots.push({ chain: match.chain, resseq: match.resseq, colorName: color.name, colorHex: color.hex });
        existing.add(key);
        added += 1;
      }
      return { added, duplicates };
    }

    function addHotspotsFromText(text, sourceLabel, clearManualInput = false) {
      if (!state.parsed) {
        setStatus('Select a PDB before adding hotspots.', 'warning');
        return;
      }
      const { matches, invalid } = parseHotspotText(text);
      const color = colorByName(colorPickerValue(els.newColor));
      const { added, duplicates } = addParsedHotspots(matches, color);
      if (clearManualInput) els.hotspotInput.value = '';
      const parts = [];
      if (added) parts.push(`Added ${added} hotspot(s) from ${sourceLabel} with ${color.name}.`);
      if (duplicates) parts.push(`Ignored ${duplicates} duplicate hotspot input(s).`);
      if (invalid.length) parts.push(`Skipped invalid token(s): ${invalid.join(', ')}.`);
      renderAll(parts.length ? parts.join(' ') : 'No valid hotspots were found in the input.', invalid.length ? 'warning' : 'ok');
      if (added) els.hotspotResultsSection.open = true;
    }

    function addHotspots() {
      addHotspotsFromText(els.hotspotInput.value, 'manual input', true);
    }

    async function loadHotspotFile() {
      if (!state.parsed) {
        setStatus('Select a PDB before loading hotspot files.', 'warning');
        return;
      }
      const index = Number(els.hotspotFileSelect.value);
      const hotspotFile = state.hotspotFiles[index];
      if (!hotspotFile) {
        setStatus('No hotspot TXT file selected.', 'warning');
        return;
      }
      setStatus(`Loading ${hotspotFile.name}...`);
      state.pendingLoads += 1;
      updateGifAvailability();
      try {
        const text = await fetchText(hotspotFile);
        addHotspotsFromText(text, hotspotFile.name, false);
      } catch (error) {
        setStatus(`Failed to load ${hotspotFile.name}: ${error.message}`, 'error');
      } finally {
        state.pendingLoads -= 1;
        updateGifAvailability();
      }
    }

    function clearHotspots() {
      state.hotspots = [];
      renderAll('Cleared all hotspots.');
    }

    function deleteSelected() {
      const key = els.selectedHotspot.value;
      if (!key) {
        setStatus('No hotspot selected for deletion.', 'warning');
        return;
      }
      state.hotspots = state.hotspots.filter(hotspot => hotspotKey(hotspot) !== key);
      renderAll(`Deleted hotspot ${key.replace('|', '')}.`);
    }

    function updateSelectedColor() {
      const key = els.selectedHotspot.value;
      const hotspot = state.hotspots.find(item => hotspotKey(item) === key);
      if (!hotspot) return;
      const color = colorByName(colorPickerValue(els.selectedColor));
      hotspot.colorName = color.name;
      hotspot.colorHex = color.hex;
      renderAll(`Updated ${residueLabel(hotspot.chain, hotspot.resseq)} color to ${color.name}.`);
    }

    function initOptions() {
      setupColorPicker(els.newColor, COLORS, () => {});
      setupColorPicker(els.selectedColor, COLORS, updateSelectedColor);
      setupColorPicker(els.chainAColor, CHAIN_COLORS, () => updateChainColor('A'));
      setupColorPicker(els.chainBColor, CHAIN_COLORS, () => updateChainColor('B'));
      resetChainColors();
    }

    function populatePdbOptions() {
      els.pdbSelect.innerHTML = '';
      for (let i = 0; i < state.pdbs.length; i += 1) {
        els.pdbSelect.add(new Option(state.pdbs[i].name, String(i)));
        comparisonEls.comparisonPdb.add(new Option(state.pdbs[i].name, String(i)));
      }
      els.pdbSelect.disabled = !state.pdbs.length;
    }

    function populateHotspotFileOptions() {
      els.hotspotFileSelect.innerHTML = '';
      if (!state.hotspotFiles.length) {
        els.hotspotFileSelect.add(new Option('No hotspot TXT files found', ''));
        els.hotspotFileSelect.disabled = true;
        els.loadHotspotFile.disabled = true;
        return;
      }
      for (let i = 0; i < state.hotspotFiles.length; i += 1) {
        els.hotspotFileSelect.add(new Option(state.hotspotFiles[i].name, String(i)));
      }
      els.hotspotFileSelect.disabled = false;
      els.loadHotspotFile.disabled = false;
    }

    async function init() {
      gifEls.exportGif.addEventListener('click', exportRotationGif);
      screenshotEls.saveScreenshot.addEventListener('click', saveScreenshot);
      initThemeToggle();
      initLabelEditing();
      initComparison();
      initOptions();
      els.pdbSelect.addEventListener('change', event => loadPdb(event.target.value));
      els.addHotspots.addEventListener('click', addHotspots);
      els.loadHotspotFile.addEventListener('click', loadHotspotFile);
      els.clearHotspots.addEventListener('click', clearHotspots);
      els.reloadPdb.addEventListener('click', () => loadPdb(state.pdbIndex));
      els.renderButton.addEventListener('click', () => renderAll('View reset to the full structure.', 'ok', { preserveView: false }));
      els.deleteSelected.addEventListener('click', deleteSelected);
      els.locateHotspot.addEventListener('click', locateSelectedHotspot);
      els.selectedHotspot.addEventListener('change', event => {
        selectHotspot(event.target.value);
      });
      els.hotspotPanel.addEventListener('click', event => {
        const button = event.target.closest('[data-hotspot-key]');
        if (button) selectHotspot(button.dataset.hotspotKey);
      });

      try {
        state.pdbs = await fetchManifest();
      } catch (error) {
        setStatus(`${error.message}. Start a local HTTP server from protein_viewer and rerun the build script after changing PDB files.`, 'error');
        renderSequences();
        renderHotspotTable();
        renderStructure();
        return;
      }

      try {
        state.hotspotFiles = await fetchHotspotManifest();
      } catch (error) {
        state.hotspotFiles = [];
        setStatus(`${error.message}. Hotspot TXT import is disabled until the build script regenerates hotspots/manifest.json.`, 'warning');
      }

      populatePdbOptions();
      populateHotspotFileOptions();
      if (!state.pdbs.length) {
        setStatus('No PDB files listed in pdbs/manifest.json. Add PDB files and rerun the build script.', 'error');
        renderSequences();
        renderHotspotTable();
        renderStructure();
        return;
      }
      await loadPdb(0, { initialLoad: true });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }

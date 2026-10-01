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
    const CHAIN_COLORS = [
      { name: 'Gray', hex: '#B7C8D6' },
      { name: 'Red', hex: '#FF7185' },
      { name: 'Orange', hex: '#FF995E' },
      { name: 'Pink', hex: '#F080CF' },
      { name: 'Purple', hex: '#C18BFF' },
      { name: 'Blue', hex: '#7AA6FF' },
      { name: 'Cyan', hex: '#58C9D2' },
      { name: 'Green', hex: '#70D6A2' },
      { name: 'Lime', hex: '#B8DA69' }
    ];
    const DEFAULT_CHAIN_COLOR = CHAIN_COLORS[0];
    const COLORABLE_CHAINS = ['A', 'B'];
    const HOTSPOT_PATTERN = /(^|[^A-Za-z0-9_])([A-Za-z_])\s*:?\s*(-?\d+)(?=$|[^A-Za-z0-9_])/g;

    const state = {
      pdbs: [],
      hotspotFiles: [],
      pdbTextCache: new Map(),
      hotspotTextCache: new Map(),
      pdbIndex: 0,
      pdbLoadRequest: 0,
      pdbText: '',
      parsed: null,
      hotspots: [],
      chainColors: { A: DEFAULT_CHAIN_COLOR.name, B: DEFAULT_CHAIN_COLOR.name },
      viewer: null
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
      viewerTitle: document.getElementById('viewerTitle'),
      viewerMeta: document.getElementById('viewerMeta')
    };

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

    async function fetchPdbText(pdb) {
      if (state.pdbTextCache.has(pdb.path)) {
        return state.pdbTextCache.get(pdb.path);
      }
      const response = await fetch(pdb.path, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Could not load ${pdb.path} (${response.status})`);
      }
      const text = await response.text();
      state.pdbTextCache.set(pdb.path, text);
      return text;
    }

    async function fetchHotspotText(hotspotFile) {
      if (state.hotspotTextCache.has(hotspotFile.path)) {
        return state.hotspotTextCache.get(hotspotFile.path);
      }
      const response = await fetch(hotspotFile.path, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Could not load ${hotspotFile.path} (${response.status})`);
      }
      const text = await response.text();
      state.hotspotTextCache.set(hotspotFile.path, text);
      return text;
    }

    function parsePdbText(pdbText) {
      const residues = new Map();
      const chains = new Map();

      for (const line of pdbText.split(/\r?\n/)) {
        if (!line.startsWith('ATOM')) continue;
        const resname3 = (line.slice(17, 20).trim().toUpperCase() || 'UNK');
        const chain = (line.slice(21, 22).trim().toUpperCase() || '_');
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
            residues.get(key).coord = coord;
            residues.get(key).coordAtom = atomName;
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
          coord,
          coordAtom: atomName
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
        const insertionCodes = [];
        for (const residue of state.parsed.residues.values()) {
          if (residue.chain === hotspot.chain && residue.resseq === Number(hotspot.resseq) && residue.icode) {
            insertionCodes.push(residue.icode);
          }
        }
        if (exact) {
          rows.push({
            hotspot: residueLabel(hotspot.chain, hotspot.resseq),
            chain: hotspot.chain,
            residueNumber: hotspot.resseq,
            insertionCode: '',
            resname3: exact.resname3,
            resname1: exact.resname1,
            colorName: hotspot.colorName,
            colorHex: hotspot.colorHex,
            found: true,
            context: sequenceContext(hotspot.chain, hotspot.resseq),
            coord: exact.coord
          });
        } else {
          rows.push({
            hotspot: residueLabel(hotspot.chain, hotspot.resseq),
            chain: hotspot.chain,
            residueNumber: hotspot.resseq,
            insertionCode: '',
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

    function renderHotspotTable() {
      const rows = buildHotspotRows();
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

    function updateSelectedControls() {
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
      const rows = buildHotspotRows();
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
      updateLocateControl();
    }

    function updateLocateControl() {
      const selectedKey = els.selectedHotspot.value;
      const row = buildHotspotRows().find(item => hotspotKey({ chain: item.chain, resseq: item.residueNumber }) === selectedKey);
      const canLocate = Boolean(row?.found);
      els.locateHotspot.disabled = !canLocate;
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

    function renderStructure({ preserveView = false } = {}) {
      let previousView = null;
      if (preserveView && state.viewer && typeof state.viewer.getView === 'function') {
        try { previousView = state.viewer.getView(); } catch (error) {}
      }
      els.viewer.innerHTML = '';
      if (state.viewer) {
        try { state.viewer.clear(); } catch (error) {}
        state.viewer = null;
      }
      if (!state.parsed || !state.pdbText) {
        els.viewer.innerHTML = '<div class="empty" style="padding: 18px; color: #cbd5e1;">No PDB loaded.</div>';
        return;
      }
      if (!window.$3Dmol) {
        els.viewer.innerHTML = '<div class="empty" style="padding: 18px; color: #fecaca;">3Dmol.js is not loaded. Check network access to jsDelivr.</div>';
        return;
      }
      const viewer = $3Dmol.createViewer(els.viewer, { backgroundColor: '#071019' });
      state.viewer = viewer;
      viewer.addModel(state.pdbText, 'pdb');
      viewer.setStyle({}, { cartoon: { color: '#cbd5e1' } });
      for (const chain of COLORABLE_CHAINS) {
        if (!state.parsed.chains.has(chain)) continue;
        const color = chainColorByName(state.chainColors[chain]);
        viewer.setStyle({ chain }, { cartoon: { color: color.hex } });
      }
      viewer.addStyle({ hetflag: true }, { stick: { color: '#9ca3af', radius: 0.16 } });
      for (const row of buildHotspotRows()) {
        if (!row.found) continue;
        const selector = { chain: row.chain, resi: String(row.residueNumber) };
        const selected = hotspotKey({ chain: row.chain, resseq: row.residueNumber }) === els.selectedHotspot.value;
        if (selected) {
          viewer.addStyle(selector, { sphere: { color: '#f1c75b', scale: 0.72, opacity: 0.88 } });
        }
        viewer.addStyle(selector, { stick: { color: row.colorHex, radius: 0.28 } });
        viewer.addStyle(selector, { sphere: { color: row.colorHex, scale: 0.36 } });
        if (row.coord) {
          viewer.addLabel(row.hotspot, {
            position: row.coord,
            fontColor: selected ? '#182520' : 'black',
            backgroundColor: selected ? '#f1c75b' : 'white',
            backgroundOpacity: 0.75,
            fontSize: 12,
            inFront: true
          });
        }
      }
      if (previousView && typeof viewer.setView === 'function') {
        viewer.setView(previousView);
      } else {
        viewer.zoomTo();
      }
      viewer.render();
    }

    function renderAll(message, kind = 'ok', { preserveView = true } = {}) {
      renderSequences();
      updateChainColorControls();
      updateSelectedControls();
      renderHotspotTable();
      renderStructure({ preserveView });
      if (message) setStatus(message, kind);
      const pdbName = state.pdbs[state.pdbIndex]?.name || 'No PDB';
      els.viewerTitle.textContent = pdbName;
      els.viewerMeta.textContent = `${state.hotspots.length} hotspot(s), one active 3Dmol viewer`;
    }

    function selectHotspot(key) {
      const optionExists = [...els.selectedHotspot.options].some(option => option.value === key);
      if (!optionExists) return;
      const hotspot = state.hotspots.find(item => hotspotKey(item) === key);
      if (!hotspot) return;
      const row = buildHotspotRows().find(item => hotspotKey({ chain: item.chain, resseq: item.residueNumber }) === key);
      els.selectedHotspot.value = key;
      setColorPickerValue(els.selectedColor, hotspot.colorName);
      els.selectedHotspotSection.open = true;
      renderHotspotTable();
      updateLocateControl();
      renderStructure({ preserveView: true });
      setStatus(row?.found ? `Selected ${residueLabel(hotspot.chain, hotspot.resseq)}.` : `${residueLabel(hotspot.chain, hotspot.resseq)} is not present in this structure.`, row?.found ? 'ok' : 'warning');
    }

    function locateSelectedHotspot() {
      const key = els.selectedHotspot.value;
      const row = buildHotspotRows().find(item => hotspotKey({ chain: item.chain, resseq: item.residueNumber }) === key);
      if (!row?.found || !state.viewer) {
        updateLocateControl();
        return;
      }
      state.viewer.zoomTo({ chain: row.chain, resi: String(row.residueNumber) }, 450);
      state.viewer.render();
      setStatus(`Centered on ${row.hotspot}.`);
    }

    async function loadPdb(index, { initialLoad = false } = {}) {
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
      try {
        const pdbText = await fetchPdbText(pdb);
        if (requestId !== state.pdbLoadRequest) return;
        state.pdbText = pdbText;
        state.parsed = parsePdbText(state.pdbText);
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
      try {
        const text = await fetchHotspotText(hotspotFile);
        addHotspotsFromText(text, hotspotFile.name, false);
      } catch (error) {
        setStatus(`Failed to load ${hotspotFile.name}: ${error.message}`, 'error');
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

/* ══════════════════════════════════════════════════════════════════════
   Flagship Solar — Inspections
   One inspection captured on site; exported per discipline.

   The whole discipline split is two ideas:
     1. every photo and every scope line carries a `disc` string ("E","P","S"
        or any combination, e.g. "EP" for something that belongs in both);
     2. export() filters on it and renumbers from 1.
   ══════════════════════════════════════════════════════════════════════ */
'use strict';

/* ─────────────── config ─────────────── */

const DISCIPLINES = {
  E: { label: 'Electrical', reportTitle: 'Electrical Pre-Compliance Inspection Report',
       scope: 'Electrical Installation',
       signRole: 'Registered person — Electrical',
       signReg:  'Registration no. (Dept. of Employment & Labour)' },
  P: { label: 'Plumbing',   reportTitle: 'Plumbing Pre-Compliance Inspection Report',
       scope: 'Plumbing &amp; Hot Water',
       signRole: 'Registered plumber — Plumbing',
       signReg:  'PIRB registration no.' },
  S: { label: 'Solar / PV', reportTitle: 'Solar / PV Pre-Compliance Inspection Report',
       scope: 'Solar (PV)',
       signRole: 'Registered person — Solar / PV',
       signReg:  'Registration no.' },
};

/* Sections shown in the capture UI, in report order.
   `disc` is only the DEFAULT tag for a new photo — it stays editable,
   because e.g. the earth bonding on the geyser pipework is physically at
   the geyser but belongs in the ELECTRICAL report. */
const SECTIONS = [
  { key: 'electrical', title: 'Electrical Installation', disc: 'E',
    sub: 'DB board, sockets, lights, switches, earthing.' },
  { key: 'geyser', title: 'Geyser installation', disc: 'P', parent: 'Plumbing &amp; Hot Water',
    sub: 'Cylinder, pipework, T&P valve, vacuum breakers, drip tray, lagging, rating plate.',
    altTitle: { E: 'Geyser — Electrical Bonding' } },
  { key: 'other-plumbing', title: 'Other plumbing', disc: 'P', parent: 'Plumbing &amp; Hot Water',
    sub: 'Taps, traps, toilet, shower, visible leaks.' },
  { key: 'solar', title: 'Solar / PV', disc: 'S',
    sub: 'Panels, inverter, changeover, DC isolators, cabling.' },
];

const DEFAULT_PHASE2 = [
  ['E', 'Insulation resistance'], ['E', 'Earth continuity'], ['E', 'Earth leakage'],
  ['E', 'Loop impedance'], ['E', 'Polarity'], ['E', 'Functional testing'],
  ['P', 'Pressure test of the hot water installation'],
  ['P', 'T&P safety valve operation and discharge'],
  ['P', 'Vacuum breaker installation heights'],
  ['P', 'Drip tray and overflow discharging to a visible point'],
  ['P', 'Leak check on all connections'],
];

const FOOTER = 'Flagship Solar (Pty) Ltd &nbsp;|&nbsp; 267 Main Road, Strand, Western Cape ' +
               '&nbsp;|&nbsp; +27 71 527 3924 &nbsp;|&nbsp; info@flagshipsolar.co.za ' +
               '&nbsp;|&nbsp; www.flagshipsolar.co.za';

const MAX_EDGE = 1400;      // px — photos are downscaled on capture
const JPEG_Q   = 0.82;

/* ─────────────── tiny helpers ─────────────── */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* Escape ONCE. The old app double-escaped, which is why captions printed
   as "T&amp;P valve" and "<div>no Visible corrosion</div>". */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
const escBr = s => esc(s).replace(/\r?\n/g, '<br>');

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2200);
}

/* ─────────────── storage (IndexedDB) ─────────────── */

const DB_NAME = 'flagship-inspections', STORE = 'jobs';
let _db;

function db() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE))
        r.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    r.onsuccess = () => { _db = r.result; res(_db); };
    r.onerror = () => rej(r.error);
  });
}

async function dbPut(job) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(job);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}
async function dbAll() {
  const d = await db();
  return new Promise((res, rej) => {
    const r = d.transaction(STORE).objectStore(STORE).getAll();
    r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
  });
}
async function dbDel(id) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}

/* ─────────────── state ─────────────── */

let job = null;
let saveTimer = null;

function newJob() {
  return {
    id: uid(),
    createdAt: new Date().toISOString(),
    client: { address: '', name: '', date: new Date().toISOString().slice(0, 10),
              jobNo: '', quote: '', inspector: '' },
    summary: '', disclaimer: '',
    photos: [],                                    // {id, section, disc, src, caption, sans}
    phase1: [], compliant: [],
    phase2: DEFAULT_PHASE2.map(([disc, text]) => ({ id: uid(), disc, text })),
    showSans: false,
  };
}

function save() {
  if (!job) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    job.updatedAt = new Date().toISOString();
    dbPut(job).catch(e => toast('Save failed: ' + e.message));
  }, 250);
}

/* ─────────────── photo capture ─────────────── */

function pickPhoto(sectionKey) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.multiple = true;
  inp.onchange = async () => {
    const sec = SECTIONS.find(s => s.key === sectionKey);
    for (const file of Array.from(inp.files || [])) {
      try {
        const src = await downscale(file);
        job.photos.push({ id: uid(), section: sectionKey, disc: sec.disc,
                          src, caption: '', sans: '' });
      } catch (e) { toast('Could not read ' + file.name); }
    }
    save(); renderPhotos(); renderExport();
  };
  inp.click();
}

function downscale(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width  = Math.round(img.width  * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', JPEG_Q));
      };
      img.onerror = rej;
      img.src = fr.result;
    };
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}

/* ─────────────── render: capture UI ─────────────── */

function renderDetails() {
  $('#f-address').value   = job.client.address;
  $('#f-name').value      = job.client.name;
  $('#f-date').value      = job.client.date;
  $('#f-job').value       = job.client.jobNo;
  $('#f-quote').value     = job.client.quote;
  $('#f-inspector').value = job.client.inspector;
  $('#f-summary').value    = job.summary;
  $('#f-disclaimer').value = job.disclaimer;
  $('#opt-sans').checked   = !!job.showSans;
}

function renderPhotos() {
  const host = $('#sections');
  host.innerHTML = '';
  let lastParent = null;

  SECTIONS.forEach(sec => {
    const mine = job.photos.filter(p => p.section === sec.key);
    const wrap = document.createElement('div');
    wrap.className = 'section';

    let head = '';
    if (sec.parent && sec.parent !== lastParent) head += `<h2>${sec.parent}</h2>`;
    lastParent = sec.parent || null;

    head += `<h3>${sec.title}</h3><p class="section-sub">${sec.sub}</p>`;
    wrap.innerHTML = head + '<div class="blocks"></div>' +
      `<div class="addrow"><button class="add-btn" data-photo="${sec.key}" type="button">+ Add photo</button></div>`;

    const blocks = $('.blocks', wrap);
    mine.forEach(p => blocks.appendChild(photoBlock(p)));
    host.appendChild(wrap);
  });

  $$('[data-photo]', host).forEach(b =>
    b.addEventListener('click', () => pickPhoto(b.dataset.photo)));
}

function photoBlock(p) {
  const el = document.createElement('div');
  el.className = 'block';
  el.innerHTML = `
    <div class="block-head">
      <span class="block-no">Photo</span>
      <button class="icon-btn danger" type="button" title="Remove">&times;</button>
    </div>
    <img class="block-thumb" alt="">
    <div class="block-body">
      <textarea rows="3" placeholder="What does this photo show? State the defect if there is one."></textarea>
      <input type="text" placeholder="SANS reference (optional)">
      <div class="discpick">
        <button type="button" data-d="E">Electrical</button>
        <button type="button" data-d="P">Plumbing</button>
        <button type="button" data-d="S">Solar</button>
      </div>
    </div>`;

  $('.block-thumb', el).src = p.src;
  const ta = $('textarea', el), inp = $('input', el);
  ta.value = p.caption; inp.value = p.sans;

  ta.addEventListener('input', () => { p.caption = ta.value; save(); });
  inp.addEventListener('input', () => { p.sans = inp.value; save(); });

  $$('[data-d]', el).forEach(b => {
    const d = b.dataset.d;
    if (p.disc.includes(d)) b.classList.add('on');
    b.addEventListener('click', () => {
      p.disc = p.disc.includes(d) ? p.disc.replace(d, '') : (p.disc + d);
      // never let a photo end up belonging to nothing
      if (!p.disc) { p.disc = d; }
      b.classList.toggle('on', p.disc.includes(d));
      $$('[data-d]', el).forEach(x => x.classList.toggle('on', p.disc.includes(x.dataset.d)));
      save(); renderExport();
    });
  });

  $('.icon-btn', el).addEventListener('click', () => {
    if (!confirm('Remove this photo?')) return;
    job.photos = job.photos.filter(x => x.id !== p.id);
    save(); renderPhotos(); renderExport();
  });

  return el;
}

function renderScope() {
  [['phase1', '#phase1-list'], ['compliant', '#compliant-list'], ['phase2', '#phase2-list']]
    .forEach(([key, sel]) => {
      const host = $(sel);
      host.innerHTML = '';
      job[key].forEach(item => host.appendChild(scopeItem(key, item)));
    });
}

function scopeItem(key, item) {
  const el = document.createElement('div');
  el.className = 'item';
  el.innerHTML = `<span class="tag ${item.disc}">${item.disc}</span>` +
                 `<textarea rows="2"></textarea>` +
                 `<button class="icon-btn danger" type="button">&times;</button>`;
  const ta = $('textarea', el);
  ta.value = item.text;
  ta.addEventListener('input', () => { item.text = ta.value; save(); });
  $('.icon-btn', el).addEventListener('click', () => {
    job[key] = job[key].filter(x => x.id !== item.id);
    save(); renderScope(); renderExport();
  });
  return el;
}

function renderExport() {
  const host = $('#export-buttons');
  host.innerHTML = '';

  const present = Object.keys(DISCIPLINES)
    .filter(d => job.photos.some(p => p.disc.includes(d)));

  const options = present.map(d => [d, DISCIPLINES[d].label]);
  if (present.length > 1) options.push([present.join(''), 'Combined']);

  if (!options.length) {
    host.innerHTML = '<p class="hint">Add at least one photo first.</p>';
    return;
  }

  options.forEach(([want, label]) => {
    const n = job.photos.filter(p => matches(p.disc, want) && p.src).length;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'export-btn' + (n ? '' : ' empty');
    b.innerHTML = `<span>Export — ${label}</span><span class="count">${n} photo${n === 1 ? '' : 's'}</span>`;
    b.addEventListener('click', () => exportReport(want, label));
    host.appendChild(b);
  });
}

const matches = (disc, want) => disc.split('').some(d => want.includes(d));

/* ─────────────── the export ─────────────── */

function exportReport(want, label) {
  /* 1. filter, drop anything empty, renumber from 1 --------------------- */
  let n = 0;
  const photos = job.photos
    .filter(p => matches(p.disc, want) && p.src)          // <- drops empty blocks:
    .map(p => ({ ...p, no: ++n }));                       //    no more 21 -> 26 gaps

  const phase1    = job.phase1.filter(i => matches(i.disc, want) && i.text.trim());
  const compliant = job.compliant.filter(i => matches(i.disc, want) && i.text.trim());
  const phase2    = job.phase2.filter(i => matches(i.disc, want) && i.text.trim());

  if (!photos.length && !phase1.length) { toast('Nothing to export for ' + label); return; }

  /* 2. build the sections that actually have content -------------------- */
  let sec = 0;
  const parts = [];
  let lastParent = null;

  SECTIONS.forEach(s => {
    const mine = photos.filter(p => p.section === s.key);
    if (!mine.length) return;

    const title = (s.altTitle && s.altTitle[want]) || s.title;
    if (s.parent && want.includes('P')) {
      if (s.parent !== lastParent) parts.push(`<h2>Section ${++sec} — ${s.parent}</h2>`);
      parts.push(`<h3>${title}</h3>`);
      lastParent = s.parent;
    } else {
      parts.push(`<h2>Section ${++sec} — ${title}</h2>`);
      lastParent = null;
    }
    parts.push(grid(mine));
  });

  /* 3. scope of works --------------------------------------------------- */
  const multi = want.length > 1;
  let scopeHtml = '';
  ['E', 'P', 'S'].filter(d => want.includes(d)).forEach(d => {
    const items = phase1.filter(i => i.disc.includes(d));
    if (!items.length) return;
    scopeHtml += `<h3>Phase 1 — ${multi ? DISCIPLINES[d].label + ' repairs' : 'Repairs'}</h3>` +
                 `<ol>${items.map(i => `<li>${escBr(i.text)}</li>`).join('')}</ol>`;
  });
  if (compliant.length)
    scopeHtml += `<div class="compliant"><b>Noted as compliant at the time of inspection:</b>` +
                 `<ul>${compliant.map(i => `<li>${escBr(i.text)}</li>`).join('')}</ul></div>`;
  if (phase2.length)
    scopeHtml += `<h3>Phase 2 — Full compliance testing</h3>` +
                 `<ul>${phase2.map(i => `<li>${escBr(i.text)}</li>`).join('')}</ul>`;
  scopeHtml += `<h3>Phase 3 — Follow-up</h3><p>If further faults show up once Phase 1 and ` +
               `Phase 2 are done, a supplementary quotation will be issued.</p>`;
  if (scopeHtml) parts.push(`<h2>Section ${++sec} — Recommended Scope of Works</h2>${scopeHtml}`);

  /* 4. recommendation, disclaimer, sign-off ----------------------------- */
  const q = job.client.quote.trim();
  parts.push(`<h2>Final Recommendation</h2><p>The items listed under Phase 1 above require repair ` +
    `or replacement before a Certificate of Compliance can be issued.` +
    (q ? ` These items are covered by quotation <b>${esc(q)}</b>.` : '') +
    ` Once the Phase 1 work is complete and Phase 2 testing has been carried out successfully, ` +
    `a Certificate of Compliance can be issued.</p>`);

  if (job.disclaimer.trim())
    parts.push(`<h2>Disclaimer</h2><p>${escBr(job.disclaimer)}</p>`);

  let sign = '';
  if (multi) sign += `<p class="note2">A Certificate of Compliance for each discipline may only be ` +
                     `issued and signed by a person registered for that discipline.</p>`;
  ['E', 'P', 'S'].filter(d => want.includes(d)).forEach(d => {
    const cfg = DISCIPLINES[d];
    const rows = ['Name', cfg.signReg, 'Signature', 'Date']
      .map(k => `<tr><th>${esc(k)}</th><td></td></tr>`).join('');
    sign += (multi ? `<h3>${esc(cfg.signRole)}</h3>` : '') + `<table class="kv">${rows}</table>`;
  });
  parts.push(`<h2>Signed by</h2>${sign}`);

  /* 5. header ----------------------------------------------------------- */
  const single = want.length === 1 ? DISCIPLINES[want] : null;
  const title = single ? single.reportTitle : 'Pre-Compliance Inspection Report';
  const scope = single ? single.scope
    : want.split('').map(d => DISCIPLINES[d].scope).join(' &nbsp;&bull;&nbsp; ');
  const suffix = want.length === 1 ? '-' + want : '';
  const reportNo = job.client.jobNo.trim() ? `COC-${esc(job.client.jobNo.trim())}${suffix}` : '';

  const rows = [
    ['Property address', escBr(job.client.address)],
    ['Client name',      esc(job.client.name)],
    ['Inspection date',  esc(fmtDate(job.client.date))],
    ['Report number',    reportNo],
    ['Related quotation', esc(q)],
    ['Inspection by',    'Flagship Solar (Pty) Ltd'],
    ['Inspector name',   esc(job.client.inspector)],
    ['Contact',          '+27 71 527 3924 &nbsp;|&nbsp; info@flagshipsolar.co.za'],
  ].filter(([, v]) => v)                                  // <- blank fields are omitted
   .map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('');

  const summary = job.summary.trim()
    ? `<h2>Executive Summary</h2><p>${escBr(job.summary)}</p>` : '';

  /* 6. assemble — ONE table, letterhead in <thead> ---------------------- */
  $('#report').innerHTML = `
<table class="page">
  <thead><tr><th>
    <div class="letterhead"><img src="assets/letterhead.png" alt="Flagship Solar"></div>
  </th></tr></thead>
  <tfoot><tr><td><div class="runfoot">${FOOTER}</div></td></tr></tfoot>
  <tbody><tr><td>
    <h1>${title}</h1>
    <p class="subtitle">${scope}</p>
    <table class="kv">${rows}</table>
    <p class="note"><b>Please note:</b> This document is a pre-compliance inspection report
      documenting visual findings and test results recorded during the site visit. It is not an
      issued Certificate of Compliance (CoC). A legal CoC can only be issued by a registered person
      once all outstanding remedial work has been completed and full compliance testing has been
      successfully carried out.</p>
    ${summary}
    ${parts.join('\n')}
  </td></tr></tbody>
</table>`;

  /* 7. print. Chrome uses document.title as the suggested filename. ----- */
  const prev = document.title;
  const place = (job.client.address.split(',')[0] || 'Inspection').trim();
  document.title = `FS-${reportNo || 'COC'} ${label} - ${place}`;
  const restore = () => { document.title = prev; window.removeEventListener('afterprint', restore); };
  window.addEventListener('afterprint', restore);
  setTimeout(() => window.print(), 120);
}

function grid(items) {
  let out = '';
  for (let i = 0; i < items.length; i += 2) {
    const pair = items.slice(i, i + 2);
    let cells = pair.map(cell).join('');
    if (pair.length === 1) cells += '<div class="cell ghost"></div>';
    out += `<div class="row">${cells}</div>`;
  }
  return out;
}

function cell(p) {
  const missing = !p.caption.trim();
  const cap = missing ? 'Caption outstanding — please complete.' : escBr(p.caption);
  const sans = (job.showSans && p.sans.trim())
    ? `<div class="sans">${esc(p.sans)}</div>` : '';
  return `<figure class="cell">
      <div class="cellhead">Photo ${p.no}</div>
      <div class="imgwrap"><img src="${p.src}" alt="Photo ${p.no}"></div>
      <figcaption class="cap${missing ? ' todo' : ''}">${cap}</figcaption>${sans}
    </figure>`;
}

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/* ─────────────── job list ─────────────── */

async function renderJobs() {
  const all = (await dbAll()).sort((a, b) =>
    (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
  const host = $('#jobs-container');
  host.innerHTML = all.length ? '' : '<p class="hint">No saved inspections yet.</p>';

  all.forEach(j => {
    const row = document.createElement('div');
    row.className = 'jobrow' + (j.id === job.id ? ' current' : '');
    row.innerHTML = `<div class="meta">
        <div class="t">${esc(j.client.name || j.client.address || 'Untitled')}</div>
        <div class="s">${esc(fmtDate(j.client.date))} · ${j.photos.length} photos</div>
      </div>
      <button class="ghost-btn" type="button">Open</button>
      <button class="icon-btn danger" type="button">&times;</button>`;
    $('.ghost-btn', row).addEventListener('click', () => {
      job = j; renderAll(); $('#joblist').hidden = true; toast('Opened');
    });
    $('.icon-btn', row).addEventListener('click', async () => {
      if (!confirm('Delete this inspection permanently?')) return;
      await dbDel(j.id);
      if (j.id === job.id) { job = newJob(); await dbPut(job); renderAll(); }
      renderJobs();
    });
    host.appendChild(row);
  });
}

/* ─────────────── wiring ─────────────── */

function renderAll() { renderDetails(); renderPhotos(); renderScope(); renderExport(); }

function bindField(sel, apply) {
  $(sel).addEventListener('input', e => { apply(e.target.value); save(); });
}

function init() {
  // tabs
  $$('.tab').forEach(t => t.addEventListener('click', () => {
    $$('.tab').forEach(x => x.classList.remove('active'));
    $$('.pane').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    $('#pane-' + t.dataset.tab).classList.add('active');
    if (t.dataset.tab === 'export') renderExport();
  }));

  bindField('#f-address',   v => job.client.address = v);
  bindField('#f-name',      v => job.client.name = v);
  bindField('#f-date',      v => job.client.date = v);
  bindField('#f-job',       v => job.client.jobNo = v);
  bindField('#f-quote',     v => job.client.quote = v);
  bindField('#f-inspector', v => job.client.inspector = v);
  bindField('#f-summary',    v => job.summary = v);
  bindField('#f-disclaimer', v => job.disclaimer = v);

  $('#opt-sans').addEventListener('change', e => { job.showSans = e.target.checked; save(); });

  $$('[data-add]').forEach(b => b.addEventListener('click', () => {
    job[b.dataset.add].push({ id: uid(), disc: b.dataset.disc, text: '' });
    save(); renderScope(); renderExport();
  }));

  $('#btn-jobs').addEventListener('click', () => { $('#joblist').hidden = false; renderJobs(); });
  $('#btn-close-jobs').addEventListener('click', () => { $('#joblist').hidden = true; });
  $('#btn-new-job').addEventListener('click', async () => {
    job = newJob(); await dbPut(job); renderAll();
    $('#joblist').hidden = true; toast('New inspection started');
  });

  $('#btn-save-json').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(job)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `inspection-${job.client.jobNo || job.id}.json`;
    a.click(); URL.revokeObjectURL(a.href);
  });
  $('#btn-load-json').addEventListener('click', () => $('#file-json').click());
  $('#file-json').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const loaded = JSON.parse(await f.text());
      loaded.id = uid();                       // never clobber an existing job
      job = loaded; await dbPut(job); renderAll(); toast('Loaded');
    } catch (err) { toast('Could not read that file'); }
    e.target.value = '';
  });
}

(async function start() {
  init();
  const all = await dbAll();
  job = all.sort((a, b) =>
    (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt))[0] || newJob();
  await dbPut(job);
  renderAll();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();

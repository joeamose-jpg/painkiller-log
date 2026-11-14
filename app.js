(function () {
  var PK = window.PK, H = PK.H, KEY = 'painkiller-log-v1';
  var state = load();
  var qtyState = {}, whenMode = '0', pendingRm = null, toastTimer = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function fresh() { return { v: 1, updatedAt: 0, custom: [], hidden: PK.DEFAULT_HIDDEN.slice(), doses: [], settings: {} }; }
  function sane(s) {
    if (!s || typeof s !== 'object') return fresh();
    var f = fresh();
    f.updatedAt = Number(s.updatedAt) || 0;
    f.custom = Array.isArray(s.custom) ? s.custom : [];
    f.hidden = Array.isArray(s.hidden) ? s.hidden : f.hidden;
    f.doses = Array.isArray(s.doses) ? s.doses.filter(function (d) { return d && typeof d.t === 'number'; }) : [];
    f.settings = (s.settings && typeof s.settings === 'object') ? s.settings : {};
    return f;
  }
  function load() { try { var raw = localStorage.getItem(KEY); if (raw) return sane(JSON.parse(raw)); } catch (e) {} return fresh(); }
  function save() {
    var cutoff = Date.now() - 7 * 24 * H;
    state.doses = state.doses.filter(function (d) { return d.t > cutoff; });
    state.updatedAt = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function allMeds() { return PK.PRESETS.concat(state.custom); }
  function visibleMeds() { return allMeds().filter(function (m) { return state.hidden.indexOf(m.id) < 0; }); }
  function ctx() { return { doses: state.doses, settings: state.settings }; }
  function medById(id) { return allMeds().filter(function (m) { return m.id === id; })[0]; }

  function getT() {
    var now = Date.now();
    if (whenMode === 'pick') {
      var v = $('pick-time').value;
      if (/^\d\d:\d\d$/.test(v)) {
        var p = v.split(':').map(Number), d = new Date(); d.setHours(p[0], p[1], 0, 0);
        var t = d.getTime(); if (t > now + 60000) t -= 864e5; return t;
      }
      return now;
    }
    return now - Number(whenMode) * 60000;
  }
  function getQty(m) { var q = qtyState[m.id]; if (!q) q = 1; return Math.max(1, Math.min(m.maxPerDose + 2, q)); }

  function renderMeters() {
    var now = Date.now(), cp = PK.caps(state.settings), w = PK.inWindow(state.doses, now);
    $('meters').innerHTML = ['paracetamol', 'ibuprofen'].map(function (k) {
      var r = PK.BASE[k], used = PK.sumMg(w, k), cap = cp[k];
      var ws = w.filter(function (d) { return d.mg && d.mg[k] > 0; }).sort(function (a, b) { return a.t - b.t; });
      var cls = used >= cap ? 'bad' : used >= cap * 0.75 ? 'warn' : '';
      var pct = Math.min(100, used / cap * 100);
      var line = ws.length
        ? ws.length + ' ' + (ws.length === 1 ? 'dose' : 'doses') + ' so far. The oldest drops out of the count at ' + PK.fmtTime(ws[0].t + 24 * H, now) + '.'
        : 'No ' + r.label.toLowerCase() + ' in the last 24 hours.';
      return '<div class="meter"><div class="meter-head"><b>' + r.label + '</b><span class="num">' + PK.fmtMg(used) + ' of ' + PK.fmtMg(cap) + '</span></div>' +
        '<div class="bar ' + cls + '" role="progressbar" aria-label="' + r.label + ' used in 24 hours" aria-valuemin="0" aria-valuemax="' + cap + '" aria-valuenow="' + Math.round(used) + '"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
        '<small>' + line + '</small></div>';
    }).join('');
  }

  function cardHTML(m, t, now) {
    var qty = getQty(m), c = ctx(), issues = PK.check(c, m, qty, t), isBlocked = PK.blocked(issues);
    var blocks = issues.filter(function (i) { return i.level === 'block'; }), warns = issues.filter(function (i) { return i.level === 'warn'; });
    var pillCls = 'ok', pill = 'OK to take', statusCls = '', status;
    var unit = m.unit || 'tablet';
    if (isBlocked) {
      var keys = blocks.map(function (i) { return i.key; });
      var onlyGap = keys.every(function (k) { return k === 'gap'; });
      if (keys.indexOf('perdose') >= 0) { pillCls = 'bad'; pill = 'Too many at once'; }
      else if (onlyGap) { pillCls = 'warn'; pill = 'Wait'; }
      else { pillCls = 'bad'; pill = 'Limit reached'; }
      var nx = PK.nextAllowed(c, m, Math.min(qty, m.maxPerDose), Math.max(t, now));
      status = nx ? 'Earliest next dose: <b class="num">' + PK.fmtTime(nx, now) + '</b>' + (nx > now ? ' (in ' + PK.fmtDur(nx - now) + ')' : '') + '.' : 'No dose is possible in the next 48 hours at this size.';
      statusCls = pillCls === 'warn' ? 'warn' : 'bad';
    } else {
      var hr = PK.headroom(c, m, t);
      status = 'Room for up to <b class="num">' + hr + '</b> more ' + PK.plural(unit, hr) + ' in this 24 hour window.';
    }
    var list = blocks.concat(warns).map(function (i) { return '<li class="' + i.level + '">' + esc(i.text) + '</li>'; }).join('');
    var whenTxt = whenMode === '0' ? 'now' : 'at ' + PK.fmtTime(t, now);
    var btn = isBlocked
      ? '<button class="btn risk" data-act="log" data-med="' + esc(m.id) + '">Already taken? Log ' + qty + ' ' + PK.plural(unit, qty) + ' ' + whenTxt + '</button>'
      : '<button class="btn" data-act="log" data-med="' + esc(m.id) + '">Log ' + qty + ' ' + PK.plural(unit, qty) + ' ' + whenTxt + '</button>';
    return '<article class="card"><div class="card-top"><h3>' + esc(m.name) + '</h3><span class="pill ' + pillCls + '">' + pill + '</span></div>' +
      '<p class="status ' + statusCls + '">' + status + '</p>' +
      (list ? '<ul class="issues">' + list + '</ul>' : '') +
      '<div class="act"><div class="stepper" role="group" aria-label="Number of ' + esc(PK.plural(unit, 2)) + '"><button data-act="qty-" data-med="' + esc(m.id) + '" aria-label="One fewer">&minus;</button><span class="num">' + qty + '</span><button data-act="qty+" data-med="' + esc(m.id) + '" aria-label="One more">+</button></div>' + btn + '</div>' +
      (m.note ? '<p class="note">' + esc(m.note) + '</p>' : '') + '</article>';
  }
  function renderCards() {
    var t = getT(), now = Date.now(), meds = visibleMeds();
    $('cards').innerHTML = meds.length ? meds.map(function (m) { return cardHTML(m, t, now); }).join('') : '<p class="note">No medicines selected. Open "Medicines I use" below.</p>';
  }
  function renderHistory() {
    var now = Date.now(), ds = state.doses.slice().sort(function (a, b) { return b.t - a.t; }).slice(0, 40);
    if (!ds.length) { $('history').innerHTML = '<p class="empty">Nothing logged yet. Doses you log above will appear here.</p>'; return; }
    $('history').innerHTML = ds.map(function (d) {
      var parts = [];
      if (d.mg && d.mg.paracetamol) parts.push(PK.fmtMg(d.mg.paracetamol) + ' paracetamol');
      if (d.mg && d.mg.ibuprofen) parts.push(PK.fmtMg(d.mg.ibuprofen) + ' ibuprofen');
      var counted = d.t + 24 * H > now ? 'Counts until ' + PK.fmtTime(d.t + 24 * H, now) : 'No longer in the 24 hour count';
      var rm = pendingRm === d.id ? '<button class="btn risk small" data-act="rm" data-id="' + esc(d.id) + '">Tap to confirm</button>' : '<button class="btn outline small" data-act="rm" data-id="' + esc(d.id) + '" aria-label="Remove this dose">Remove</button>';
      return '<div class="row"><span class="t">' + esc(PK.fmtTime(d.t, now)) + '</span><div class="what">' + esc(d.qty + ' \u00d7 ' + d.name) + '<small>' + esc(parts.join(', ')) + (parts.length ? ' \u00b7 ' : '') + esc(counted) + '</small></div>' + rm + '</div>';
    }).join('');
  }
  function renderDash() { renderMeters(); renderCards(); renderHistory(); }

  function renderMedLists() {
    $('med-toggles').innerHTML = allMeds().map(function (m) {
      var on = state.hidden.indexOf(m.id) < 0;
      return '<label class="check"><input type="checkbox" data-act="toggle-med" data-med="' + esc(m.id) + '"' + (on ? ' checked' : '') + '> <span>' + esc(m.name) + '</span></label>';
    }).join('');
    $('custom-list').innerHTML = state.custom.length
      ? state.custom.map(function (m) {
          return '<div class="item"><span>' + esc(m.name) + '</span><button class="btn outline small" data-act="rmmed" data-id="' + esc(m.id) + '">Delete</button></div>';
        }).join('')
      : '';
  }
  function renderWhen() {
    var chips = document.querySelectorAll('#when .chip');
    for (var i = 0; i < chips.length; i++) chips[i].setAttribute('aria-pressed', chips[i].dataset.v === whenMode ? 'true' : 'false');
    $('pick-time').hidden = whenMode !== 'pick';
  }
  function toast(msg) {
    var el = $('toast'); el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.hidden = true; }, 7000);
  }

  function logDose(m) {
    var t = getT(), qty = getQty(m), c = ctx(), issues = PK.check(c, m, qty, t), wasBlocked = PK.blocked(issues);
    state.doses.push(PK.doseFor(m, qty, t));
    save(); renderDash();
    var nx = PK.nextAllowed(ctx(), m, Math.min(qty, m.maxPerDose), Math.max(t, Date.now()));
    toast('Logged ' + qty + ' \u00d7 ' + m.name + ' at ' + PK.fmtTime(t) + '.' + (wasBlocked ? ' That was over a limit. If you are worried, call 111.' : '') + (nx ? ' Next dose of this: ' + PK.fmtTime(nx) + ' at the earliest.' : ''));
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var a = b.dataset.act, m;
    if (a === 'when') { whenMode = b.dataset.v; renderWhen(); renderCards(); if (whenMode === 'pick') $('pick-time').focus(); }
    else if (a === 'qty-' || a === 'qty+') { m = medById(b.dataset.med); if (m) { qtyState[m.id] = getQty(m) + (a === 'qty+' ? 1 : -1); renderCards(); } }
    else if (a === 'log') { m = medById(b.dataset.med); if (m) logDose(m); }
    else if (a === 'rm') {
      if (pendingRm === b.dataset.id) { state.doses = state.doses.filter(function (d) { return d.id !== pendingRm; }); pendingRm = null; save(); renderDash(); }
      else { pendingRm = b.dataset.id; renderHistory(); setTimeout(function () { pendingRm = null; renderHistory(); }, 4000); }
    }
    else if (a === 'rmmed') {
      if (b.dataset.armed === '1') { state.custom = state.custom.filter(function (x) { return x.id !== b.dataset.id; }); save(); renderMedLists(); renderDash(); }
      else { b.dataset.armed = '1'; b.textContent = 'Tap to confirm'; }
    }
    else if (a === 'copy') copyLog();
  });
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.dataset && el.dataset.act === 'toggle-med') {
      var id = el.dataset.med, i = state.hidden.indexOf(id);
      if (el.checked && i >= 0) state.hidden.splice(i, 1);
      if (!el.checked && i < 0) state.hidden.push(id);
      save(); renderCards();
    }
    if (el.id === 'pick-time') renderCards();
    if (el.id === 'cap-para') { state.settings.paraCap = Math.min(4000, Math.max(100, Number(el.value) || 4000)); el.value = state.settings.paraCap; save(); renderDash(); }
    if (el.id === 'cap-ibu') { state.settings.ibuCap = Math.min(1200, Math.max(100, Number(el.value) || 1200)); el.value = state.settings.ibuCap; save(); renderDash(); }
  });
  $('custom-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('c-name').value.trim(), msg = $('c-msg');
    var para = Number($('c-para').value) || 0, ibu = Number($('c-ibu').value) || 0;
    var perDose = Math.round(Number($('c-perdose').value)), gap = Number($('c-gap').value), max24 = Math.round(Number($('c-max24').value)), doses24 = Math.round(Number($('c-doses24').value));
    if (!name || !(perDose >= 1) || !(gap >= 0.5) || !(max24 >= 1) || !(doses24 >= 1)) { msg.textContent = 'Fill in the name and all four limits.'; return; }
    var ing = {}; if (para > 0) ing.paracetamol = para; if (ibu > 0) ing.ibuprofen = ibu;
    state.custom.push({ id: 'c' + Date.now().toString(36), name: name, unit: $('c-unit').value.trim() || 'tablet', ing: ing, otherNsaid: $('c-nsaid').checked, maxPerDose: perDose, minGapH: gap, maxUnits24: max24, maxDoses24: doses24, note: 'Your own limits, copied from the box or your prescriber.' });
    save(); renderMedLists(); renderDash();
    $('custom-form').reset(); $('c-unit').value = 'tablet';
    msg.textContent = 'Added. It now appears under "Log a dose".';
  });

  function copyLog() {
    var now = Date.now(), cp = PK.caps(state.settings), w = PK.inWindow(state.doses, now);
    var lines = ['Painkiller log, ' + new Date(now).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }),
      'Last 24 hours: paracetamol ' + PK.fmtMg(PK.sumMg(w, 'paracetamol')) + ' of ' + PK.fmtMg(cp.paracetamol) + ', ibuprofen ' + PK.fmtMg(PK.sumMg(w, 'ibuprofen')) + ' of ' + PK.fmtMg(cp.ibuprofen), ''];
    state.doses.slice().sort(function (a, b) { return a.t - b.t; }).forEach(function (d) {
      lines.push(new Date(d.t).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) + '  ' + d.qty + ' x ' + d.name);
    });
    var text = lines.join('\n'), fallback = function () {
      var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:0;top:0;opacity:0';
      document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('Log copied.'); } catch (x) { toast('Could not copy. Select the log and copy it by hand.'); } document.body.removeChild(ta);
    };
    try { navigator.clipboard.writeText(text).then(function () { toast('Log copied.'); }, fallback); } catch (x) { fallback(); }
  }

  function fillSettings() {
    var cp = PK.caps(state.settings); $('cap-para').value = cp.paracetamol; $('cap-ibu').value = cp.ibuprofen;
  }

  fillSettings(); renderWhen(); renderMedLists(); renderDash();
  setInterval(renderDash, 30000);
})();

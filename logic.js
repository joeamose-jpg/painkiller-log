(function (root) {
  var H = 3600000;
  var BASE = {
    paracetamol: { label: 'Paracetamol', cap: 4000, doses: 4, gap: 4, perDose: 1000 },
    ibuprofen:   { label: 'Ibuprofen',   cap: 1200, doses: 3, gap: 4, perDose: 400 }
  };
  var PRESETS = [
    { id: 'para500', name: 'Paracetamol 500 mg tablets', unit: 'tablet', ing: { paracetamol: 500 }, maxPerDose: 2, minGapH: 4, maxUnits24: 8, maxDoses24: 4,
      note: 'NHS: 1 or 2 tablets, at least 4 hours apart, no more than 8 tablets (4 g) in 24 hours.' },
    { id: 'para1g', name: 'Paracetamol 1 g tablets (prescribed)', unit: 'tablet', ing: { paracetamol: 1000 }, maxPerDose: 1, minGapH: 4, maxUnits24: 4, maxDoses24: 4,
      note: 'NHS: one at a time, no more than 4 tablets in 24 hours.' },
    { id: 'ibu200', name: 'Ibuprofen 200 mg tablets', unit: 'tablet', ing: { ibuprofen: 200 }, maxPerDose: 2, minGapH: 4, maxUnits24: 6, maxDoses24: 3,
      note: 'NHS: 1 or 2 tablets, up to 3 times a day, at least 4 hours apart, no more than 6 tablets (1,200 mg) in 24 hours. Take with or after food.' },
    { id: 'ibu400', name: 'Ibuprofen 400 mg tablets', unit: 'tablet', ing: { ibuprofen: 400 }, maxPerDose: 1, minGapH: 4, maxUnits24: 3, maxDoses24: 3,
      note: 'NHS: 1 tablet, up to 3 times a day, at least 4 hours apart, no more than 3 tablets (1,200 mg) in 24 hours. Take with or after food.' },
    { id: 'coco8500', name: 'Co-codamol 8/500 tablets', unit: 'tablet', ing: { paracetamol: 500, codeine: 8 }, maxPerDose: 2, minGapH: 4, maxUnits24: 8, maxDoses24: 4,
      note: 'NHS: 1 or 2 tablets, at least 4 to 6 hours apart, no more than 8 tablets in 24 hours. Contains paracetamol. Short-term use only, and it can cause drowsiness.' }
  ];
  var DEFAULT_HIDDEN = ['para1g'];

  function clampCap(v, def) { v = Number(v); if (!isFinite(v) || v <= 0) return def; return Math.min(def, Math.round(v)); }
  function caps(settings) { var s = settings || {}; return { paracetamol: clampCap(s.paraCap, 4000), ibuprofen: clampCap(s.ibuCap, 1200) }; }
  function inWindow(doses, t) { return doses.filter(function (d) { return d.t <= t && d.t > t - 24 * H; }); }
  function plural(unit, n) { return (n === 1 || unit === 'ml') ? unit : unit + 's'; }
  function sumMg(ws, k) { return ws.reduce(function (a, d) { return a + ((d.mg && d.mg[k]) || 0); }, 0); }
  function fmtMg(n) { return Math.round(n).toLocaleString('en-GB') + ' mg'; }
  function fmtTime(t, ref) {
    var d = new Date(t), r = new Date(ref || Date.now());
    var hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    var dl = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(r.getFullYear(), r.getMonth(), r.getDate())) / 864e5);
    if (dl === 0) return hm;
    if (dl === 1) return 'tomorrow ' + hm;
    if (dl === -1) return 'yesterday ' + hm;
    return d.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ' + hm;
  }
  function fmtDur(ms) {
    var m = Math.max(1, Math.round(ms / 60000)), h = Math.floor(m / 60), r = m % 60;
    if (h === 0) return r + ' min';
    return r ? h + ' h ' + r + ' min' : h + ' h';
  }
  function doseFor(med, qty, t) {
    var mg = {}, k;
    for (k in (med.ing || {})) { mg[k] = med.ing[k] * qty; }
    if (med.otherNsaid) mg.nsaid_other = qty;
    return { id: 'd' + t.toString(36) + Math.random().toString(36).slice(2, 6), t: t, medId: med.id, name: med.name, unit: med.unit || 'tablet', qty: qty, mg: mg };
  }

  // Returns a list of issues {level:'block'|'warn', key, text} for taking qty of med at time t.
  function check(ctx, med, qty, t) {
    var out = [], seen = {}, w = inWindow(ctx.doses, t), cp = caps(ctx.settings), unit = med.unit || 'tablet';
    function add(level, key, text) { if (level === 'block') { if (seen[key]) return; seen[key] = 1; } out.push({ level: level, key: key, text: text }); }
    var ingKeys = Object.keys(BASE);
    ingKeys.forEach(function (k) {
      var per = (med.ing || {})[k]; if (!per) return;
      var r = BASE[k], cap = cp[k], doseMg = per * qty;
      var ws = w.filter(function (d) { return d.mg && d.mg[k] > 0; });
      var used = sumMg(ws, k);
      if (doseMg > r.perDose) add('block', 'perdose', 'A single dose of ' + fmtMg(doseMg) + ' ' + r.label.toLowerCase() + ' is more than the usual maximum of ' + fmtMg(r.perDose) + '.');
      if (used + doseMg > cap) add('block', 'cap', 'That would bring your ' + r.label.toLowerCase() + ' to ' + fmtMg(used + doseMg) + ' in 24 hours. The limit is ' + fmtMg(cap) + '.');
      if (ws.length + 1 > r.doses) add('block', 'doses', 'You have already had ' + ws.length + ' ' + r.label.toLowerCase() + ' doses in the last 24 hours. The usual maximum is ' + r.doses + '.');
      if (ws.length) {
        var last = Math.max.apply(null, ws.map(function (d) { return d.t; }));
        if (t - last < r.gap * H) add('block', 'gap', 'Your last ' + r.label.toLowerCase() + ' was at ' + fmtTime(last, t) + '. Leave at least ' + r.gap + ' hours, so not before ' + fmtTime(last + r.gap * H, t) + '.');
      }
    });
    if (qty > med.maxPerDose) add('block', 'perdose', 'The usual single dose is up to ' + med.maxPerDose + ' ' + plural(unit, med.maxPerDose) + '.');
    var same = w.filter(function (d) { return d.medId === med.id; });
    if (same.length) {
      var lastSame = Math.max.apply(null, same.map(function (d) { return d.t; }));
      if (t - lastSame < med.minGapH * H) add('block', 'gap', 'Your last ' + med.name + ' was at ' + fmtTime(lastSame, t) + '. Leave at least ' + med.minGapH + ' hours, so not before ' + fmtTime(lastSame + med.minGapH * H, t) + '.');
    }
    var usedUnits = same.reduce(function (a, d) { return a + d.qty; }, 0);
    if (usedUnits + qty > med.maxUnits24) add('block', 'cap', 'That would make ' + (usedUnits + qty) + ' ' + plural(unit, usedUnits + qty) + ' of ' + med.name + ' in 24 hours. The limit is ' + med.maxUnits24 + '.');
    if (same.length + 1 > med.maxDoses24) add('block', 'doses', 'You have already had ' + same.length + ' doses of ' + med.name + ' in the last 24 hours. The limit is ' + med.maxDoses24 + '.');

    var hasIbu = !!(med.ing && med.ing.ibuprofen), hasPara = !!(med.ing && med.ing.paracetamol);
    var otherNsaidDoses = w.filter(function (d) { return d.mg && d.mg.nsaid_other > 0 && d.medId !== med.id; });
    var ibuDoses = w.filter(function (d) { return d.mg && d.mg.ibuprofen > 0 && d.medId !== med.id; });
    if (hasIbu && otherNsaidDoses.length) add('warn', 'nsaid', 'You also took ' + otherNsaidDoses[0].name + ', another anti-inflammatory. The NHS says not to take these together.');
    if (med.otherNsaid && (ibuDoses.length || otherNsaidDoses.length)) add('warn', 'nsaid', 'You also took another anti-inflammatory (' + (ibuDoses[0] || otherNsaidDoses[0]).name + '). The NHS says not to take these together.');
    var paraOther = w.filter(function (d) { return d.mg && d.mg.paracetamol > 0 && d.medId !== med.id; });
    if (hasPara && paraOther.length) add('warn', 'dup', 'You also took ' + paraOther[0].name + ', which contains paracetamol. Both count towards one paracetamol total, and the NHS advises against combining products that contain it.');
    return out;
  }
  function blocked(issues) { return issues.some(function (i) { return i.level === 'block'; }); }

  function nextAllowed(ctx, med, qty, from) {
    var c = [from], gaps = [4, med.minGapH];
    ctx.doses.forEach(function (d) { c.push(d.t + 24 * H); gaps.forEach(function (g) { c.push(d.t + g * H); }); });
    c.sort(function (a, b) { return a - b; });
    for (var i = 0; i < c.length; i++) {
      var t = c[i]; if (t < from) continue; if (t > from + 48 * H) break;
      if (!blocked(check(ctx, med, qty, t))) return t;
    }
    return null;
  }
  function headroom(ctx, med, t) {
    var w = inWindow(ctx.doses, t), cp = caps(ctx.settings);
    var h = med.maxUnits24 - w.filter(function (d) { return d.medId === med.id; }).reduce(function (a, d) { return a + d.qty; }, 0);
    Object.keys(BASE).forEach(function (k) {
      var per = (med.ing || {})[k]; if (!per) return;
      h = Math.min(h, Math.floor((cp[k] - sumMg(w, k)) / per));
    });
    return Math.max(0, h);
  }

  root.PK = { H: H, BASE: BASE, PRESETS: PRESETS, DEFAULT_HIDDEN: DEFAULT_HIDDEN, caps: caps, inWindow: inWindow, plural: plural, sumMg: sumMg, fmtMg: fmtMg,
    fmtTime: fmtTime, fmtDur: fmtDur, doseFor: doseFor, check: check, blocked: blocked, nextAllowed: nextAllowed, headroom: headroom };
})(typeof window !== 'undefined' ? window : globalThis);

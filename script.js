function $(id) {
  return document.getElementById(id);
}

function fmtWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

function statusLabel(s) {
  if (!s) return 'unknown';
  return String(s).toLowerCase();
}

function statusClass(s) {
  const v = statusLabel(s);
  if (v === 'ok') return 'pill ok';
  if (v === 'error' || v === 'failed' || v === 'fail') return 'pill error';
  return 'pill neutral';
}

function fmtDuration(ms) {
  if (!ms && ms !== 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec - m * 60);
  return `${m}m ${s}s`;
}

function fmtAgo(ms) {
  if (!ms && ms !== 0) return '—';
  const delta = Date.now() - ms;
  if (delta < 0) return '—';
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return `${sec}秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}時間前`;
  const d = Math.floor(h / 24);
  return `${d}日前`;
}

function fmtUptime(sec) {
  if (!sec && sec !== 0) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function summarizeHealth(jobs) {
  const enabled = jobs.filter((j) => j.enabled);
  const errors = enabled.filter((j) => statusLabel(j?.lastRun?.status) === 'error');
  const ok = enabled.filter((j) => statusLabel(j?.lastRun?.status) === 'ok');
  const unknown = enabled.filter((j) => !j?.lastRun?.status);

  return {
    enabledCount: enabled.length,
    okCount: ok.length,
    errorCount: errors.length,
    unknownCount: unknown.length,
    errorJobs: errors,
  };
}

function setGauge(id, pct) {
  const el = $(id);
  if (pct === null || pct === undefined) {
    el.textContent = '—';
    return;
  }
  el.textContent = String(pct);
}

function setBadge(el, text, cls) {
  el.textContent = text;
  el.classList.remove('success', 'warning', 'danger');
  if (cls) el.classList.add(cls);
}

function fmtMemGiB(kb) {
  if (!kb && kb !== 0) return '—';
  const gib = kb / 1024 / 1024;
  return `${gib.toFixed(1)}GiB`;
}

function throttlingSummary(t) {
  if (!t || !t.current) return null;
  const flags = [];
  if (t.current.underVoltage) flags.push('under-voltage');
  if (t.current.freqCapped) flags.push('freq-capped');
  if (t.current.throttled) flags.push('throttled');
  if (t.current.softTempLimit) flags.push('temp-limit');
  return flags.length ? flags.join(', ') : 'ok';
}

function renderSystem(data) {
  const sys = data?.system || {};

  setGauge('cpu-gauge', sys.cpuUsagePct);
  setGauge('mem-gauge', sys.memUsagePct);
  setGauge('disk-gauge', sys.diskUsagePct);

  $('cpu-meta').textContent = sys.cpuUsagePct === null || sys.cpuUsagePct === undefined ? '計測中…' : 'スナップショット';
  $('mem-meta').textContent = 'スナップショット';
  $('disk-meta').textContent = '/';

  const mi = sys.mem || null;
  const load = sys.loadavg || null;

  const lines = [
    `Host: ${sys.hostname || '—'}`,
    `OS: ${[sys.os, sys.release].filter(Boolean).join(' ') || '—'} (${sys.arch || '—'})`,
    `Uptime: ${fmtUptime(sys.uptimeSec)}`,
    `LoadAvg: ${load ? `${load['1m']} / ${load['5m']} / ${load['15m']}` : '—'}`,
    `CPU: ${sys.cpuUsagePct ?? '—'}%`,
    `CPU Temp: ${sys.cpuTempC ?? '—'}°C`,
    `Memory: ${sys.memUsagePct ?? '—'}% (${mi ? `${fmtMemGiB(mi.availableKb)} free / ${fmtMemGiB(mi.totalKb)} total` : '—'})`,
    `Disk(/): ${sys.diskUsagePct ?? '—'}%`,
  ];

  const th = throttlingSummary(sys.throttling);
  if (th) {
    lines.push(`RPi Throttling: ${th} (${sys.throttling?.hex || sys.throttling?.raw || '—'})`);
  }

  $('sys-info').textContent = lines.join('\n');

  const updatedAt = data?.generatedAtIso ? fmtWhen(data.generatedAtIso) : '—';
  $('updated-at').textContent = `更新: ${updatedAt}`;
}

function renderHealth(data) {
  const healthBadges = $('health-badges');
  const healthSummary = $('health-summary');

  if (!data || data.error || data.cronError) {
    healthBadges.innerHTML = [
      '<span class="badge">Cron: --</span>',
      '<span class="badge">OK: --</span>',
      '<span class="badge danger">Errors: --</span>',
    ].join('');
    const msg = data?.error || data?.cronError;
    healthSummary.innerHTML = `<div class="health-line danger">Cronステータスを取得できません${msg ? `: ${msg}` : ''}</div>`;
    return;
  }

  const s = summarizeHealth(data.jobs || []);

  healthBadges.innerHTML = [
    `<span class="badge">Cron: ${s.enabledCount}</span>`,
    `<span class="badge success">OK: ${s.okCount}</span>`,
    `<span class="badge ${s.errorCount ? 'danger' : ''}">Errors: ${s.errorCount}</span>`,
  ].join('');

  if (s.enabledCount === 0) {
    healthSummary.innerHTML = '<div class="health-line neutral">有効なCronジョブが見つかりません。</div>';
    return;
  }

  if (s.errorCount === 0) {
    const note = s.unknownCount ? `（未実行: ${s.unknownCount}）` : '';
    healthSummary.innerHTML = `<div class="health-line success">有効なCronジョブは正常です。${note}</div>`;
    return;
  }

  const items = s.errorJobs
    .map((j) => {
      const err = j?.lastRun?.error || 'Unknown error';
      return `<li><span class="mono">${j.name}</span><span class="muted"> — ${err}</span></li>`;
    })
    .join('');

  healthSummary.innerHTML = [
    `<div class="health-line danger">${s.errorCount} 件のCronジョブが失敗しています。</div>`,
    `<ul class="health-list">${items}</ul>`,
  ].join('');
}

// --- Alerts ---
let __lastAlertFingerprint = null;

function readThresholdInput(id, fallback) {
  const el = $(id);
  const v = el ? Number(el.value) : NaN;
  return Number.isFinite(v) ? v : fallback;
}

function getAlertSettingsFromUI() {
  return {
    enabled: !!$('alerts-enabled')?.checked,
    notify: !!$('alerts-notify')?.checked,
    thCpu: readThresholdInput('th-cpu', 90),
    thMem: readThresholdInput('th-mem', 90),
    thDisk: readThresholdInput('th-disk', 90),
    thTemp: readThresholdInput('th-temp', 75),
  };
}

function computeAlerts(data, settings) {
  if (!settings.enabled) {
    return { level: 'neutral', items: [], message: 'アラートは無効です。' };
  }

  if (!data || data.error || data.cronError) {
    return { level: 'danger', items: [], message: 'Cronステータスを取得できません（offline / error）' };
  }

  const sys = data.system || {};
  const items = [];

  const cpu = sys.cpuUsagePct;
  const mem = sys.memUsagePct;
  const disk = sys.diskUsagePct;
  const temp = sys.cpuTempC;

  if (typeof cpu === 'number' && cpu >= settings.thCpu) items.push({ level: 'warn', text: `CPU 高負荷: ${cpu}%（閾値 ${settings.thCpu}%）` });
  if (typeof mem === 'number' && mem >= settings.thMem) items.push({ level: 'warn', text: `Memory 使用率: ${mem}%（閾値 ${settings.thMem}%）` });
  if (typeof disk === 'number' && disk >= settings.thDisk) items.push({ level: 'warn', text: `Disk(/) 使用率: ${disk}%（閾値 ${settings.thDisk}%）` });
  if (typeof temp === 'number' && temp >= settings.thTemp) items.push({ level: 'warn', text: `CPU 温度: ${temp}°C（閾値 ${settings.thTemp}°C）` });

  const s = summarizeHealth(data.jobs || []);
  if (s.errorCount > 0) items.push({ level: 'danger', text: `Cron 失敗: ${s.errorCount} 件` });
  if (s.enabledCount > 0 && s.unknownCount > 0) items.push({ level: 'neutral', text: `Cron 未実行: ${s.unknownCount} 件` });

  if (items.length === 0) return { level: 'ok', items: [], message: 'OK（閾値内）' };

  const worst = items.some((x) => x.level === 'danger') ? 'danger' : items.some((x) => x.level === 'warn') ? 'warn' : 'neutral';
  return { level: worst, items, message: null };
}

function renderAlerts(result) {
  const box = $('alerts-summary');
  if (!box) return;

  if (result.message) {
    const cls = result.level === 'danger' ? 'danger' : result.level === 'warn' ? 'warn' : result.level === 'ok' ? 'ok' : 'muted';
    box.innerHTML = `<div class="alerts-line ${cls}">${result.message}</div>`;
    return;
  }

  const headerCls = result.level === 'danger' ? 'danger' : result.level === 'warn' ? 'warn' : 'muted';
  const header = result.level === 'danger' ? '要対応' : '注意';
  const items = result.items.map((x) => `<li>${x.text}</li>`).join('');
  box.innerHTML = [`<div class="alerts-line ${headerCls}">${header}</div>`, `<ul class="alerts-list">${items}</ul>`].join('');
}

function maybeNotify(result, settings) {
  if (!settings.enabled || !settings.notify) return;
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  // Notify only when we have warning/danger and something changed.
  const fingerprint = JSON.stringify({ level: result.level, items: (result.items || []).map((x) => x.text).sort() });
  if (fingerprint === __lastAlertFingerprint) return;
  __lastAlertFingerprint = fingerprint;

  if (result.level === 'warn' || result.level === 'danger') {
    const title = result.level === 'danger' ? 'PRM: 要対応' : 'PRM: 注意';
    const body = (result.items || []).slice(0, 4).map((x) => x.text).join('\n');
    try {
      new Notification(title, { body });
    } catch {
      // ignore
    }
  }
}

function bindAlertControls() {
  const persist = () => {
    const s = getAlertSettingsFromUI();
    savePrefs({
      alertsEnabled: s.enabled,
      alertsNotify: s.notify,
      thCpu: s.thCpu,
      thMem: s.thMem,
      thDisk: s.thDisk,
      thTemp: s.thTemp,
    });
    if (__lastData) {
      const r = computeAlerts(__lastData, s);
      renderAlerts(r);
    }
  };

  ['alerts-enabled', 'alerts-notify', 'th-cpu', 'th-mem', 'th-disk', 'th-temp'].forEach((id) => {
    $(id)?.addEventListener('change', persist);
    $(id)?.addEventListener('input', () => {
      clearTimeout(window.__alertsTimer);
      window.__alertsTimer = setTimeout(persist, 120);
    });
  });

  $('notify-permission')?.addEventListener('click', async () => {
    if (!('Notification' in window)) {
      toast('このブラウザは通知に対応していません');
      return;
    }
    try {
      const p = await Notification.requestPermission();
      toast(`通知権限: ${p}`);
    } catch {
      toast('通知権限の要求に失敗しました');
    }
  });
}

function getFilters() {
  const q = $('cron-filter')?.value?.trim()?.toLowerCase() || '';
  const onlyErrors = !!$('cron-only-errors')?.checked;
  const hideDisabled = !!$('cron-hide-disabled')?.checked;
  return { q, onlyErrors, hideDisabled };
}

function rowClassForJob(j) {
  const enabled = j.enabled;
  const isError = statusLabel(j?.lastRun?.status) === 'error';
  const nextMs = j?.nextRun?.atMs;
  const overdue = enabled && nextMs && nextMs < Date.now();

  const durMs = j?.lastRun?.durationMs;
  const longRun = typeof durMs === 'number' && durMs >= 30000; // 30s+

  return [
    !enabled ? 'row-disabled' : '',
    overdue ? 'row-overdue' : '',
    isError ? 'row-error' : '',
    longRun ? 'row-long' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function renderCronTable(data) {
  const tbody = $('cron-table-body');
  const updated = $('cron-updated');

  if (!data || data.error) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted">Cronジョブの読み込みに失敗しました${data?.error ? `: ${data.error}` : ''}</td></tr>`;
    updated.textContent = '更新: --';
    updated.classList.remove('success');
    updated.classList.add('danger');
    return;
  }

  const base = `更新: ${fmtWhen(data.generatedAtIso)}`;
  if (data.cronStale || data.cronError) {
    updated.textContent = `${base}（古い可能性）`;
    updated.classList.remove('danger');
    updated.classList.add('warning');
  } else {
    updated.textContent = base;
    updated.classList.remove('danger');
    updated.classList.remove('warning');
  }

  const filters = getFilters();

  let jobs = (data.jobs || []).slice();
  jobs = jobs.sort((a, b) => (a?.name || '').localeCompare(b?.name || ''));

  jobs = jobs.filter((j) => {
    if (filters.hideDisabled && !j.enabled) return false;
    if (filters.onlyErrors && statusLabel(j?.lastRun?.status) !== 'error') return false;
    if (filters.q) {
      const hay = `${j?.name || ''} ${j?.schedule?.expr || ''} ${j?.lastRun?.error || ''}`.toLowerCase();
      if (!hay.includes(filters.q)) return false;
    }
    return true;
  });

  if (jobs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="muted">フィルタに一致するCronジョブがありません。</td></tr>';
    return;
  }

  tbody.innerHTML = jobs
    .map((j) => {
      const st = statusLabel(j?.lastRun?.status);
      const last = fmtWhen(j?.lastRun?.atIso);
      const next = fmtWhen(j?.nextRun?.atIso);
      const dur = fmtDuration(j?.lastRun?.durationMs);
      const err = j?.lastRun?.error || '';
      const enabled = j.enabled;
      const expr = j?.schedule?.expr || '—';
      const lastAgo = fmtAgo(j?.lastRun?.atMs);

      // basic escaping for title attribute
      const escTitle = String(err).replaceAll('"', '&quot;');

      return [
        `<tr class="${rowClassForJob(j)}">`,
        '  <td>',
        '    <div class="job">',
        `      <div class="job-name">${j.name || '—'}</div>`,
        `      <div class="job-meta muted">${enabled ? 'enabled' : 'disabled'} • ${expr}</div>`,
        '    </div>',
        '  </td>',
        `  <td><span class="${statusClass(st)}">${st}</span></td>`,
        `  <td class="mono">${last}<div class="muted small">${lastAgo}</div></td>`,
        `  <td class="mono">${next}</td>`,
        `  <td class="mono">${dur}</td>`,
        `  <td class="mono ${err ? 'danger-text' : 'muted'}" title="${escTitle}">${err || '—'}</td>`,
        '</tr>',
      ].join('\n');
    })
    .join('\n');
}

let __lastData = null;

async function fetchCronStatus() {
  const res = await fetch(`cron_status.json?cb=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}


async function fetchResourceHistory() {
  const res = await fetch(`resource_history.json?cb=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

function drawLineChart(canvasId, points, valueKey, opts = {}) {
  const canvas = $(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || canvas.width;
  const cssH = canvas.clientHeight || canvas.height;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const w = cssW;
  const h = cssH;
  const pad = 10;

  const values = points
    .map((p) => (p && typeof p[valueKey] === 'number' ? p[valueKey] : null))
    .filter((v) => v !== null);

  ctx.clearRect(0, 0, w, h);

  // background grid
  const isLight = document.body.dataset.theme === 'light';
  ctx.strokeStyle = isLight ? 'rgba(15, 23, 42, 0.08)' : 'rgba(148, 163, 184, 0.10)';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 3; i++) {
    const y = pad + ((h - pad * 2) * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(w - pad, y);
    ctx.stroke();
  }

  if (!values.length) {
    ctx.fillStyle = isLight ? 'rgba(15, 23, 42, 0.45)' : 'rgba(226, 232, 240, 0.55)';
    ctx.font = '12px Inter, system-ui, sans-serif';
    ctx.fillText('No data', pad, pad + 14);
    return;
  }

  const min = opts.min !== undefined ? opts.min : Math.min(...values);
  const max = opts.max !== undefined ? opts.max : Math.max(...values);
  const span = max - min || 1;

  const n = points.length;
  const xs = (i) => pad + ((w - pad * 2) * i) / Math.max(1, n - 1);
  const ys = (v) => pad + (h - pad * 2) * (1 - (v - min) / span);

  ctx.strokeStyle =
    opts.stroke || (isLight ? 'rgba(2, 132, 199, 0.95)' : 'rgba(34, 211, 238, 0.95)');
  ctx.lineWidth = 2;
  ctx.beginPath();

  let started = false;
  for (let i = 0; i < points.length; i++) {
    const v = points[i] && typeof points[i][valueKey] === 'number' ? points[i][valueKey] : null;
    if (v === null) continue;
    const x = xs(i);
    const y = ys(v);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();

  // last value label
  const last = values[values.length - 1];
  ctx.fillStyle = isLight ? 'rgba(15, 23, 42, 0.55)' : 'rgba(226, 232, 240, 0.65)';
  ctx.font = '12px Inter, system-ui, sans-serif';
  const suffix = opts.suffix || '';
  ctx.fillText(`${last}${suffix}`, pad, h - 8);
}

async function refreshTrends() {
  const meta = $('trend-meta');

  try {
    const h = await fetchResourceHistory();
    const pts = (h && h.points) || [];

    // if we have too many points (e.g. second-level sampling), only plot the last N.
    const maxPlot = 720; // good enough for 24h @ 2min or 12h @ 1min
    const points = pts.length > maxPlot ? pts.slice(-maxPlot) : pts;

    drawLineChart('trend-cpu', points, 'cpu', { min: 0, max: 100, suffix: '%' });
    drawLineChart('trend-mem', points, 'mem', { min: 0, max: 100, suffix: '%' });
    drawLineChart('trend-temp', points, 'tempC', { suffix: '°C' });

    if (meta) {
      const count = pts.length;
      meta.textContent = `points: ${count} / retention: ${Math.round((h.retentionMs || 0) / 3600000)}h`;
    }
  } catch (e) {
    // history is optional; keep silent
    if (meta) meta.textContent = 'resource_history.json が未生成（または取得失敗）';
  }
}

async function refreshAll() {
  const badge = $('status-badge');
  setBadge(badge, '読込中…');

  try {
    const data = await fetchCronStatus();
    __lastData = data;

    renderSystem(data);
    refreshTrends();
    renderCronTable(data);
    renderHealth(data);

    const alertSettings = getAlertSettingsFromUI();
    const alertResult = computeAlerts(data, alertSettings);
    renderAlerts(alertResult);
    maybeNotify(alertResult, alertSettings);

    const degraded = !!(data.error || data.cronError || data.cronStale);
    setBadge(badge, degraded ? '注意' : '稼働中', degraded ? 'warning' : 'success');
  } catch (e) {
    console.error('Failed to refresh', e);
    renderCronTable({ error: String(e) });
    renderHealth({ error: String(e) });
    renderAlerts({ level: 'danger', items: [], message: `取得失敗: ${String(e)}` });
    setBadge(badge, 'オフライン', 'danger');
  }
}

$('refresh').addEventListener('click', () => {
  refreshAll();
});

function rerenderCronTable() {
  if (!__lastData) return;
  renderCronTable(__lastData);
}

function bindFilters() {
  const rerender = () => {
    // フィルタはクライアント側の表示だけを変えたいので、ネットワークを叩かない
    if (__lastData) {
      rerenderCronTable();
      return;
    }
    refreshAll();
  };

  $('cron-filter')?.addEventListener('input', () => {
    clearTimeout(window.__cronFilterTimer);
    window.__cronFilterTimer = setTimeout(rerender, 150);
  });
  $('cron-only-errors')?.addEventListener('change', rerender);
  $('cron-hide-disabled')?.addEventListener('change', rerender);
}

function toast(msg) {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
}

const STORAGE_KEY = 'prm:v1';

function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function savePrefs(patch) {
  const cur = loadPrefs();
  const next = { ...cur, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function applyTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  document.body.dataset.theme = t;

  const btn = $('theme-toggle');
  if (btn) btn.textContent = t === 'light' ? 'Dark' : 'Light';
}

function initTheme() {
  const p = loadPrefs();
  const saved = typeof p.theme === 'string' ? p.theme : null;
  const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  const initial = saved || (prefersLight ? 'light' : 'dark');
  applyTheme(initial);
}

function bindThemeToggle() {
  $('theme-toggle')?.addEventListener('click', () => {
    const cur = document.body.dataset.theme === 'light' ? 'light' : 'dark';
    const next = cur === 'light' ? 'dark' : 'light';
    applyTheme(next);
    refreshTrends();
    savePrefs({ theme: next });
    toast(`Theme: ${next}`);
  });
}

let __refreshTimer = null;

function applyAutoRefresh() {
  const enabled = !!$('auto-refresh')?.checked;
  const intervalMs = Number($('refresh-interval')?.value || 30000);

  savePrefs({ autoRefresh: enabled, refreshIntervalMs: intervalMs });

  if (__refreshTimer) {
    clearInterval(__refreshTimer);
    __refreshTimer = null;
  }
  if (enabled) {
    __refreshTimer = setInterval(refreshAll, intervalMs);
  }
}

function initPrefs() {
  const p = loadPrefs();

  if ($('cron-filter') && typeof p.cronFilter === 'string') $('cron-filter').value = p.cronFilter;
  if ($('cron-only-errors') && typeof p.onlyErrors === 'boolean') $('cron-only-errors').checked = p.onlyErrors;
  if ($('cron-hide-disabled') && typeof p.hideDisabled === 'boolean') $('cron-hide-disabled').checked = p.hideDisabled;

  if ($('auto-refresh') && typeof p.autoRefresh === 'boolean') $('auto-refresh').checked = p.autoRefresh;
  if ($('refresh-interval') && typeof p.refreshIntervalMs === 'number') {
    $('refresh-interval').value = String(p.refreshIntervalMs);
  }

  // alerts
  if ($('alerts-enabled') && typeof p.alertsEnabled === 'boolean') $('alerts-enabled').checked = p.alertsEnabled;
  if ($('alerts-notify') && typeof p.alertsNotify === 'boolean') $('alerts-notify').checked = p.alertsNotify;

  if ($('th-cpu') && typeof p.thCpu === 'number') $('th-cpu').value = String(p.thCpu);
  if ($('th-mem') && typeof p.thMem === 'number') $('th-mem').value = String(p.thMem);
  if ($('th-disk') && typeof p.thDisk === 'number') $('th-disk').value = String(p.thDisk);
  if ($('th-temp') && typeof p.thTemp === 'number') $('th-temp').value = String(p.thTemp);
}

function bindHeaderControls() {
  $('auto-refresh')?.addEventListener('change', applyAutoRefresh);
  $('refresh-interval')?.addEventListener('change', applyAutoRefresh);

  $('copy-sys')?.addEventListener('click', async () => {
    const text = $('sys-info')?.textContent || '';
    try {
      await navigator.clipboard.writeText(text);
      toast('System情報をクリップボードにコピーしました');
    } catch {
      toast('コピーに失敗しました（ブラウザ権限を確認してください）');
    }
  });

  $('download-json')?.addEventListener('click', () => {
    if (!__lastData) {
      toast('まだデータがありません');
      return;
    }
    try {
      const blob = new Blob([JSON.stringify(__lastData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().replaceAll(':', '').replaceAll('.', '');
      a.href = url;
      a.download = `cron_status_${ts}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('JSONを保存しました');
    } catch {
      toast('JSON保存に失敗しました');
    }
  });

  // persist filter inputs
  $('cron-filter')?.addEventListener('input', () => savePrefs({ cronFilter: $('cron-filter').value }));
  $('cron-only-errors')?.addEventListener('change', () => savePrefs({ onlyErrors: $('cron-only-errors').checked }));
  $('cron-hide-disabled')?.addEventListener('change', () => savePrefs({ hideDisabled: $('cron-hide-disabled').checked }));
}

initTheme();
bindThemeToggle();

initPrefs();
bindFilters();
bindHeaderControls();
bindAlertControls();
applyAutoRefresh();
refreshAll();

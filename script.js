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

function renderSystem(data) {
  const sys = data?.system || {};

  setGauge('cpu-gauge', sys.cpuUsagePct);
  setGauge('mem-gauge', sys.memUsagePct);
  setGauge('disk-gauge', sys.diskUsagePct);

  $('cpu-meta').textContent = sys.cpuUsagePct === null || sys.cpuUsagePct === undefined ? 'warming up…' : 'snapshot';
  $('mem-meta').textContent = 'snapshot';
  $('disk-meta').textContent = '/';

  const lines = [
    `Host: ${sys.hostname || '—'}`,
    `OS: ${[sys.os, sys.release].filter(Boolean).join(' ') || '—'} (${sys.arch || '—'})`,
    `Uptime: ${fmtUptime(sys.uptimeSec)}`,
    `CPU: ${sys.cpuUsagePct ?? '—'}%`,
    `Memory: ${sys.memUsagePct ?? '—'}%`,
    `Disk(/): ${sys.diskUsagePct ?? '—'}%`,
  ];

  $('sys-info').textContent = lines.join('\n');

  const updatedAt = data?.generatedAtIso ? fmtWhen(data.generatedAtIso) : '—';
  $('updated-at').textContent = `Updated: ${updatedAt}`;
}

function renderHealth(data) {
  const healthBadges = $('health-badges');
  const healthSummary = $('health-summary');

  if (!data || data.error) {
    healthBadges.innerHTML = [
      '<span class="badge">Cron: --</span>',
      '<span class="badge">OK: --</span>',
      '<span class="badge danger">Errors: --</span>',
    ].join('');
    healthSummary.innerHTML = `<div class="health-line danger">Cron status unavailable${data?.error ? `: ${data.error}` : ''}</div>`;
    return;
  }

  const s = summarizeHealth(data.jobs || []);

  healthBadges.innerHTML = [
    `<span class="badge">Cron: ${s.enabledCount}</span>`,
    `<span class="badge success">OK: ${s.okCount}</span>`,
    `<span class="badge ${s.errorCount ? 'danger' : ''}">Errors: ${s.errorCount}</span>`,
  ].join('');

  if (s.enabledCount === 0) {
    healthSummary.innerHTML = '<div class="health-line neutral">No enabled cron jobs detected.</div>';
    return;
  }

  if (s.errorCount === 0) {
    const note = s.unknownCount ? `（未実行: ${s.unknownCount}）` : '';
    healthSummary.innerHTML = `<div class="health-line success">All enabled cron jobs look healthy. ${note}</div>`;
    return;
  }

  const items = s.errorJobs
    .map((j) => {
      const err = j?.lastRun?.error || 'Unknown error';
      return `<li><span class="mono">${j.name}</span><span class="muted"> — ${err}</span></li>`;
    })
    .join('');

  healthSummary.innerHTML = [
    `<div class="health-line danger">${s.errorCount} cron job(s) failing.</div>`,
    `<ul class="health-list">${items}</ul>`,
  ].join('');
}

function renderCronTable(data) {
  const tbody = $('cron-table-body');
  const updated = $('cron-updated');

  if (!data || data.error) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted">Failed to load cron jobs${data?.error ? `: ${data.error}` : ''}</td></tr>`;
    updated.textContent = 'Updated: --';
    updated.classList.remove('success');
    updated.classList.add('danger');
    return;
  }

  updated.textContent = `Updated: ${fmtWhen(data.generatedAtIso)}`;
  updated.classList.remove('danger');

  const jobs = (data.jobs || []).slice().sort((a, b) => (a?.name || '').localeCompare(b?.name || ''));

  if (jobs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="muted">No cron jobs found.</td></tr>';
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

      // basic escaping for title attribute
      const escTitle = String(err).replaceAll('"', '&quot;');

      return [
        `<tr class="${enabled ? '' : 'row-disabled'}">`,
        '  <td>',
        '    <div class="job">',
        `      <div class="job-name">${j.name || '—'}</div>`,
        `      <div class="job-meta muted">${enabled ? 'enabled' : 'disabled'} • ${expr}</div>`,
        '    </div>',
        '  </td>',
        `  <td><span class="${statusClass(st)}">${st}</span></td>`,
        `  <td class="mono">${last}</td>`,
        `  <td class="mono">${next}</td>`,
        `  <td class="mono">${dur}</td>`,
        `  <td class="mono ${err ? 'danger-text' : 'muted'}" title="${escTitle}">${err || '—'}</td>`,
        '</tr>',
      ].join('\n');
    })
    .join('\n');
}

async function fetchCronStatus() {
  const res = await fetch(`cron_status.json?cb=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function refreshAll() {
  const badge = $('status-badge');
  setBadge(badge, 'Loading…');

  try {
    const data = await fetchCronStatus();

    renderSystem(data);
    renderCronTable(data);
    renderHealth(data);

    const hasError = !!data.error;
    setBadge(badge, hasError ? 'Degraded' : 'Online', hasError ? 'warning' : 'success');
  } catch (e) {
    console.error('Failed to refresh', e);
    renderCronTable({ error: String(e) });
    renderHealth({ error: String(e) });
    setBadge(badge, 'Offline', 'danger');
  }
}

$('refresh').addEventListener('click', () => {
  refreshAll();
});

refreshAll();
setInterval(refreshAll, 30000);

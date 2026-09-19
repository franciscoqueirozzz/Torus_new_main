'use strict';

const $ = id => document.getElementById(id);
const state = {
  token: sessionStorage.getItem('torus_token'), user: null,
  meetings: [], customers: [], tasks: [], users: [], sellers: [], page: 'overview',
  saveEntity: null, detail: null,
};
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
const stages = { prospect: 'Negociação', active: 'Ativo', renewal: 'Renovação', inactive: 'Inativo' };
const intents = { churn_risk: 'Risco', price_objection: 'Preço', upsell_opportunity: 'Expansão', satisfaction: 'Satisfação', neutral: 'Neutro' };
const titles = { overview: 'Resumo', customers: 'Clientes', meetings: 'Reuniões', tasks: 'Tarefas', upload: 'Nova análise', team: 'Equipe', account: 'Minha conta' };
const smallScreen = window.matchMedia('(max-width: 760px)');
function updateSidebarAccess() {
  $('sidebar').inert = smallScreen.matches && !$('sidebar').classList.contains('open');
}
smallScreen.addEventListener('change', updateSidebarAccess);
updateSidebarAccess();
const points = value => `${Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} pts`;
const roleName = role => role === 'manager' ? 'Gerente' : 'Vendedor';
const riskClass = value => value >= 70 ? 'high' : value >= 40 ? 'medium' : 'low';
const riskName = value => value >= 70 ? 'Prioridade' : value >= 40 ? 'Atenção' : 'Baixo';
const today = () => new Date().toLocaleDateString('sv-SE');
const dateText = value => value ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value.length === 10 ? `${value}T12:00:00` : `${value.replace(' ', 'T')}Z`)) : 'Sem data';
const overdue = task => task.status === 'open' && task.due_date < today();
const badge = (text, kind = '') => `<span class="badge ${kind}">${esc(text)}</span>`;
const empty = (title, description, action = '') => `<div class="empty"><strong>${esc(title)}</strong>${esc(description)}${action ? `<div>${action}</div>` : ''}</div>`;

const API_BASE = window.TORUS_API_BASE || '';

async function api(path, options = {}) {
  const headers = new Headers(options.headers);
  if (state.token) headers.set('Authorization', `Bearer ${state.token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new Error('Sem conexão com o Torus.');
  }
  if (response.status === 401 && path !== '/auth/login') {
    clearSession();
    throw new Error('Sessão expirada. Entre novamente.');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(typeof data.detail === 'string' ? data.detail : 'Não foi possível concluir.');
  }
  return options.download ? response.blob() : response.json();
}

let toastTimer;
function notify(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000);
}

function report(error) {
  const target = state.user ? $('globalError') : $('loginError');
  target.hidden = false;
  target.textContent = error.message;
}

function clearSession() {
  state.token = null;
  state.user = null;
  state.meetings = []; state.customers = []; state.tasks = []; state.users = []; state.sellers = [];
  sessionStorage.removeItem('torus_token');
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  $('appView').hidden = true;
  $('loginView').hidden = false;
  $('password').value = '';
}

async function refresh() {
  const manager = state.user.role === 'manager';
  const [meetings, customers, tasks, users, sellers] = await Promise.all([
    api('/meetings'), api('/customers'), api('/tasks'),
    manager ? api('/users') : Promise.resolve([]),
    manager ? api('/users/sellers') : Promise.resolve([]),
  ]);
  Object.assign(state, { meetings, customers, tasks, users, sellers });
  $('globalError').hidden = true;
  render();
}

async function enterApp() {
  state.user = await api('/auth/me');
  await refresh();
  $('sideUserName').textContent = state.user.name;
  $('sideUserRole').textContent = roleName(state.user.role);
  $('scopeLabel').textContent = state.user.role === 'manager' ? 'CARTEIRA DA EQUIPE' : 'MINHA CARTEIRA';
  $('accountIdentity').textContent = `${state.user.name} · ${state.user.email} · ${roleName(state.user.role)}`;
  document.querySelectorAll('[data-manager]').forEach(item => { item.hidden = state.user.role !== 'manager'; });
  $('loginView').hidden = true;
  $('appView').hidden = false;
  showPage('overview');
}

function showPage(page) {
  if (!(page in titles) || (page === 'team' && state.user.role !== 'manager')) return;
  state.page = page;
  document.querySelectorAll('.page').forEach(section => { section.hidden = section.id !== `page-${page}`; });
  document.querySelectorAll('nav [data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === page));
  $('pageTitle').textContent = page === 'overview' && state.user.role === 'manager' ? 'Visão da equipe' : titles[page];
  $('sidebar').classList.remove('open');
  $('mobileMenu').setAttribute('aria-expanded', 'false');
  updateSidebarAccess();
  window.scrollTo({ top: 0 });
}

function meetingTable(meetings) {
  if (!meetings.length) return empty('Nenhuma reunião', 'Envie uma transcrição ou ajuste os filtros.');
  return `<div class="table-scroll"><table><thead><tr><th>Cliente / reunião</th><th>Registrada em</th><th>Risco</th><th>Expansão</th><th>Revisão</th><th>Detalhes</th></tr></thead><tbody>${meetings.map(item => `<tr>
    <td><strong>${esc(item.customer_name)}</strong>${esc(item.title)}<small>${esc(item.seller.name)}</small></td>
    <td>${dateText(item.created_at)}</td><td class="score ${riskClass(item.summary.churn_risk_score)}">${points(item.summary.churn_risk_score)}</td><td class="score">${points(item.summary.opportunity_score)}</td>
    <td>${badge(riskName(item.summary.churn_risk_score), riskClass(item.summary.churn_risk_score))}</td><td><button data-meeting="${item.id}">Ver análise</button></td></tr>`).join('')}</tbody></table></div>`;
}

function taskRows(tasks, compact = false) {
  if (!tasks.length) return empty('Nenhuma tarefa', 'Crie uma tarefa para o próximo contato.');
  return tasks.map(task => `<div class="list-row"><div><strong>${esc(task.title)}</strong><small>${esc(task.customer_name)} · ${esc(task.seller_name)}</small><small>${dateText(task.due_date)}${task.priority === 'high' ? ' · Prioridade alta' : ''}</small></div><div class="actions">${badge(task.status === 'done' ? 'Concluída' : overdue(task) ? 'Em atraso' : 'Pendente', task.status === 'done' ? 'done' : overdue(task) ? 'high' : '')}<button data-task="${task.id}">${compact ? 'Abrir' : 'Editar tarefa'}</button></div></div>`).join('');
}

function sellerStats() {
  const avg = list => list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : 0;
  const bySeller = new Map();
  for (const seller of state.sellers) bySeller.set(seller.id, { id: seller.id, name: seller.name, meetings: [] });
  for (const item of state.meetings) {
    if (!bySeller.has(item.seller.id)) bySeller.set(item.seller.id, { id: item.seller.id, name: item.seller.name, meetings: [] });
    bySeller.get(item.seller.id).meetings.push(item);
  }
  return [...bySeller.values()].map(entry => {
    const sellerTasks = state.tasks.filter(task => task.seller_id === entry.id);
    const openTasks = sellerTasks.filter(task => task.status === 'open');
    const lastMeeting = [...entry.meetings].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null;
    return {
      id: entry.id, name: entry.name, meetingCount: entry.meetings.length,
      avgRisk: avg(entry.meetings.map(item => item.summary.churn_risk_score)),
      avgOpportunity: avg(entry.meetings.map(item => item.summary.opportunity_score)),
      openTasks: openTasks.length, overdueTasks: openTasks.filter(overdue).length, lastMeeting,
    };
  });
}

// --- Tooltip flutuante compartilhado (heatmap + ranking) ---
let tooltipRegistry = [];
function registerTip(html) { tooltipRegistry.push(html); return tooltipRegistry.length - 1; }
function tipContent(el) {
  const html = tooltipRegistry[Number(el?.dataset.tip)];
  return html == null ? null : html;
}
function placeTooltipNear(x, y) {
  const tip = $('hmTooltip');
  const pad = 14;
  const rect = tip.getBoundingClientRect();
  let left = x + pad, top = y + pad;
  if (left + rect.width > window.innerWidth - 10) left = x - rect.width - pad;
  if (top + rect.height > window.innerHeight - 10) top = y - rect.height - pad;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${Math.max(8, top)}px`;
}
document.addEventListener('mouseover', event => {
  const el = event.target.closest('[data-tip]');
  const html = el && tipContent(el);
  if (!html) return;
  const tip = $('hmTooltip');
  tip.innerHTML = html;
  tip.hidden = false;
  placeTooltipNear(event.clientX, event.clientY);
});
document.addEventListener('mousemove', event => {
  if (!$('hmTooltip').hidden) placeTooltipNear(event.clientX, event.clientY);
});
document.addEventListener('mouseout', event => {
  const el = event.target.closest('[data-tip]');
  if (el && !el.contains(event.relatedTarget)) $('hmTooltip').hidden = true;
});
document.addEventListener('focusin', event => {
  const el = event.target.closest('[data-tip]');
  const html = el && tipContent(el);
  if (!html) return;
  const tip = $('hmTooltip');
  tip.innerHTML = html;
  tip.hidden = false;
  const rect = el.getBoundingClientRect();
  tip.style.left = `${Math.min(window.innerWidth - tip.offsetWidth - 10, rect.left)}px`;
  tip.style.top = `${rect.bottom + 8}px`;
});
document.addEventListener('focusout', event => {
  if (event.target.closest('[data-tip]')) $('hmTooltip').hidden = true;
});

// hue 0=vermelho (atenção) .. 130=verde (favorável); goodHigh=false inverte a leitura (ex.: risco)
function heatColor(pct, goodHigh = true) {
  const clamped = Math.max(0, Math.min(100, pct));
  const hue = goodHigh ? clamped * 1.3 : 130 - clamped * 1.3;
  return { fg: `hsl(${hue.toFixed(0)} 65% 32%)`, bg: `hsl(${hue.toFixed(0)} 70% 92%)`, bar: `hsl(${hue.toFixed(0)} 60% 46%)` };
}

function performanceIndex(seller) {
  if (!seller.meetingCount) return null;
  const volumeScore = Math.min(100, seller.meetingCount * 12);
  const riskScore = 100 - seller.avgRisk;
  return Math.round(seller.avgOpportunity * 0.45 + riskScore * 0.35 + volumeScore * 0.2);
}

function sellerTipHtml(seller, idx) {
  const lines = [`<strong>${esc(seller.name)}</strong>`];
  if (idx == null) { lines.push('Sem reuniões registradas ainda.'); return lines.join('<br>'); }
  lines.push(`Índice de desempenho: <strong>${idx} pts</strong>`);
  lines.push(`${seller.meetingCount} reunião${seller.meetingCount === 1 ? '' : 'ões'} analisada${seller.meetingCount === 1 ? '' : 's'}`);
  lines.push(`Risco médio: ${points(seller.avgRisk)}`);
  lines.push(`Expansão média: ${points(seller.avgOpportunity)}`);
  lines.push(`Tarefas: ${seller.openTasks} aberta${seller.openTasks === 1 ? '' : 's'}${seller.overdueTasks ? `, ${seller.overdueTasks} em atraso` : ''}`);
  if (seller.lastMeeting) lines.push(`Última reunião: ${esc(seller.lastMeeting.customer_name)} · ${dateText(seller.lastMeeting.created_at)}`);
  return lines.join('<br>');
}

function sellerLeaderboard(list) {
  tooltipRegistry = [];
  if (!list.length) return empty('Nenhum vendedor cadastrado', 'Cadastre pessoas na equipe para ver o ranking.');
  const ranked = list.map(seller => ({ seller, idx: performanceIndex(seller) }))
    .sort((a, b) => (b.idx ?? -1) - (a.idx ?? -1) || b.seller.meetingCount - a.seller.meetingCount);
  const medals = ['🥇', '🥈', '🥉'];
  return `<div class="leaderboard">${ranked.map(({ seller, idx }, position) => {
    const color = idx == null ? null : heatColor(idx, true);
    const initials = seller.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
    const tipId = registerTip(sellerTipHtml(seller, idx));
    return `<div class="leaderboard-row" tabindex="0" data-tip="${tipId}">
      <span class="rank-slot">${medals[position] || `${position + 1}º`}</span>
      <span class="avatar-circle" style="${color ? `background:${color.bg};color:${color.fg}` : ''}">${esc(initials)}</span>
      <div class="leaderboard-main">
        <div class="leaderboard-name"><strong>${esc(seller.name)}</strong>${seller.overdueTasks ? badge(`${seller.overdueTasks} em atraso`, 'high') : ''}</div>
        <div class="heat-bar-track"><div class="heat-bar-fill" style="width:${idx ?? 0}%;background:${color ? color.bar : '#dfe2e4'}"></div></div>
      </div>
      <div class="leaderboard-figures">
        <span>${seller.meetingCount} reun.</span>
        <strong>${idx == null ? '—' : `${idx} pts`}</strong>
      </div>
    </div>`;
  }).join('')}</div>`;
}

function sellerHeatmapGrid(list) {
  if (!list.length) return empty('Sem dados para o mapa de calor', 'O mapa aparece quando houver vendedores cadastrados.');
  const metrics = [
    { key: 'avgRisk', label: 'Risco médio', goodHigh: false, format: points, scale: false },
    { key: 'avgOpportunity', label: 'Expansão média', goodHigh: true, format: points, scale: false },
    { key: 'meetingCount', label: 'Reuniões', goodHigh: true, format: String, scale: true },
    { key: 'openTasks', label: 'Tarefas abertas', goodHigh: false, format: String, scale: true },
    { key: 'overdueTasks', label: 'Em atraso', goodHigh: false, format: String, scale: true },
  ];
  const ranges = {};
  for (const metric of metrics) {
    if (!metric.scale) continue;
    const values = list.map(seller => seller[metric.key]);
    ranges[metric.key] = { min: 0, max: Math.max(1, ...values) };
  }
  const cells = list.map(seller => metrics.map(metric => {
    const hasData = metric.key === 'meetingCount' || metric.key === 'openTasks' || metric.key === 'overdueTasks' || seller.meetingCount > 0;
    let pct = null;
    if (hasData) {
      if (metric.scale) { const { min, max } = ranges[metric.key]; pct = max > min ? ((seller[metric.key] - min) / (max - min)) * 100 : 0; }
      else pct = seller[metric.key];
    }
    const color = pct == null ? null : heatColor(pct, metric.goodHigh);
    const value = hasData ? metric.format(seller[metric.key]) : '—';
    const tipId = registerTip(`<strong>${esc(seller.name)}</strong><br>${esc(metric.label)}: <strong>${esc(value)}</strong>${seller.lastMeeting ? `<br>Última reunião: ${esc(seller.lastMeeting.customer_name)} · ${dateText(seller.lastMeeting.created_at)}` : '<br>Sem reuniões registradas.'}`);
    return `<div class="heatmap-cell" tabindex="0" data-tip="${tipId}" style="${color ? `background:${color.bg};color:${color.fg}` : ''}">${esc(value)}</div>`;
  }).join('')).map((row, index) => `<div class="heatmap-name">${esc(list[index].name)}</div>${row}`);
  return `<div class="heatmap-scroll"><div class="heatmap-grid" style="grid-template-columns:150px repeat(${metrics.length},minmax(80px,1fr))">
    <div class="heatmap-corner"></div>${metrics.map(metric => `<div class="heatmap-head">${esc(metric.label)}</div>`).join('')}
    ${cells.join('')}
  </div></div>`;
}

function parseMeetingDate(value) {
  return new Date(value.length === 10 ? `${value}T12:00:00` : `${value.replace(' ', 'T')}Z`);
}

function bucketMeetings(meetings) {
  if (!meetings.length) return [];
  const sorted = [...meetings].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const first = parseMeetingDate(sorted[0].created_at);
  const last = parseMeetingDate(sorted.at(-1).created_at);
  const spanDays = Math.max(1, (last - first) / 86400000);
  const granularity = spanDays <= 10 ? 'day' : spanDays <= 70 ? 'week' : 'month';
  const keyOf = date => {
    if (granularity === 'month') return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (granularity === 'week') { const monday = new Date(date); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7)); return monday.toISOString().slice(0, 10); }
    return date.toISOString().slice(0, 10);
  };
  const labelOf = key => {
    if (granularity === 'month') { const [year, month] = key.split('-'); return new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit' }).format(new Date(Number(year), Number(month) - 1, 1)); }
    const text = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(new Date(`${key}T12:00:00`));
    return granularity === 'week' ? `sem. ${text}` : text;
  };
  const buckets = new Map();
  for (const meeting of sorted) {
    const key = keyOf(parseMeetingDate(meeting.created_at));
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(meeting);
  }
  const avg = list => list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : 0;
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, items]) => ({
    key, label: labelOf(key), count: items.length,
    avgRisk: avg(items.map(item => item.summary.churn_risk_score)),
    avgOpportunity: avg(items.map(item => item.summary.opportunity_score)),
  }));
}

function meetingsTrendChart(meetings) {
  const buckets = bucketMeetings(meetings);
  if (buckets.length < 2) return empty('Ainda sem histórico suficiente', 'O gráfico aparece quando houver reuniões em pelo menos dois períodos.');
  const width = 720, height = 220, padL = 30, padR = 14, padT = 16, padB = 28;
  const innerW = width - padL - padR, innerH = height - padT - padB;
  const stepX = innerW / Math.max(1, buckets.length - 1);
  const xAt = index => padL + index * stepX;
  const yAt = value => padT + innerH - (Math.max(0, Math.min(100, value)) / 100) * innerH;
  const linePath = key => buckets.map((bucket, index) => `${index === 0 ? 'M' : 'L'}${xAt(index).toFixed(1)},${yAt(bucket[key]).toFixed(1)}`).join(' ');
  const grid = [0, 25, 50, 75, 100].map(value => `<line x1="${padL}" x2="${width - padR}" y1="${yAt(value)}" y2="${yAt(value)}" class="trend-grid-line"></line><text x="${padL - 6}" y="${yAt(value) + 3}" class="trend-axis-label" text-anchor="end">${value}</text>`).join('');
  const dots = key => buckets.map((bucket, index) => {
    const tipId = registerTip(`<strong>${esc(bucket.label)}</strong><br>${bucket.count} reunião${bucket.count === 1 ? '' : 'ões'}<br>Risco médio: ${points(bucket.avgRisk)}<br>Expansão média: ${points(bucket.avgOpportunity)}`);
    return `<circle cx="${xAt(index)}" cy="${yAt(bucket[key])}" r="4.5" class="trend-point ${key === 'avgRisk' ? 'risk' : 'opportunity'}" tabindex="0" data-tip="${tipId}"></circle>`;
  }).join('');
  const labels = buckets.map((bucket, index) => `<text x="${xAt(index)}" y="${height - 6}" class="trend-axis-label" text-anchor="middle">${esc(bucket.label)}</text>`).join('');
  return `<svg viewBox="0 0 ${width} ${height}" class="trend-svg" role="img" aria-label="Evolução do risco e da expansão ao longo do tempo">
    ${grid}
    <path d="${linePath('avgRisk')}" class="trend-line risk"></path>
    <path d="${linePath('avgOpportunity')}" class="trend-line opportunity"></path>
    ${dots('avgRisk')}${dots('avgOpportunity')}
    ${labels}
  </svg>`;
}

function deltaTag(delta, goodHigh) {
  if (delta == null) return '';
  if (Math.abs(delta) < 0.5) return `<span class="delta-tag flat">→ estável</span>`;
  const good = goodHigh ? delta > 0 : delta < 0;
  return `<span class="delta-tag ${good ? 'good' : 'bad'}">${delta > 0 ? '▲' : '▼'} ${points(Math.abs(delta))}</span>`;
}

function periodSplit(meetings) {
  const sorted = [...meetings].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const mid = Math.floor(sorted.length / 2);
  const hasSplit = sorted.length > 1 && mid > 0;
  return { older: hasSplit ? sorted.slice(0, mid) : [], recent: hasSplit ? sorted.slice(mid) : sorted, hasSplit };
}

function periodAverages(list) {
  const avg = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  return {
    count: list.length,
    avgRisk: avg(list.map(item => item.summary.churn_risk_score)),
    avgOpportunity: avg(list.map(item => item.summary.opportunity_score)),
    avgSentiment: avg(list.map(item => item.summary.sentiment_score)),
  };
}

function meetingsSummary(meetings) {
  if (!meetings.length) return empty('Ainda sem reuniões', 'O resumo aparece após a primeira análise.');
  const totals = periodAverages(meetings);
  const frequency = new Map();
  for (const meeting of meetings) {
    for (const term of [...(meeting.summary.products_identified || []), ...(meeting.summary.key_terms || []).map(item => item.term)]) {
      frequency.set(term, (frequency.get(term) || 0) + 1);
    }
  }
  const topTerms = [...frequency.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  return `<div class="summary-stats">
    <div><span>Total de reuniões</span><strong>${totals.count}</strong></div>
    <div><span>Risco médio da carteira</span><strong class="score ${riskClass(totals.avgRisk)}">${points(totals.avgRisk)}</strong></div>
    <div><span>Expansão média</span><strong>${points(totals.avgOpportunity)}</strong></div>
    <div><span>Sentimento médio</span><strong>${points(totals.avgSentiment)}</strong></div>
  </div>
  ${topTerms.length ? `<p class="small muted" style="margin-bottom:8px">Termos e produtos mais citados</p><div class="tags" style="margin-bottom:0">${topTerms.map(([term, count]) => badge(`${term} · ${count}`)).join('')}</div>` : ''}`;
}

// Evolução individual: separa as reuniões de cada vendedor em "antes" e "agora" e mede a variação
function sellerPeriodDeltas(meetings) {
  const bySeller = new Map();
  for (const meeting of meetings) {
    const key = meeting.seller.id;
    if (!bySeller.has(key)) bySeller.set(key, { id: key, name: meeting.seller.name, meetings: [] });
    bySeller.get(key).meetings.push(meeting);
  }
  const results = [];
  for (const entry of bySeller.values()) {
    if (entry.meetings.length < 2) continue;
    const { older, recent } = periodSplit(entry.meetings);
    const oldStats = periodAverages(older);
    const newStats = periodAverages(recent);
    const deltaRisk = newStats.avgRisk - oldStats.avgRisk;
    const deltaOpportunity = newStats.avgOpportunity - oldStats.avgOpportunity;
    results.push({ id: entry.id, name: entry.name, count: entry.meetings.length, deltaRisk, deltaOpportunity, score: -deltaRisk + deltaOpportunity });
  }
  return results.sort((a, b) => b.score - a.score);
}

function meetingsComparison(meetings) {
  const { older, recent, hasSplit } = periodSplit(meetings);
  if (!hasSplit) return empty('Ainda sem dados suficientes', 'Registre reuniões em pelo menos dois momentos distintos para comparar períodos.');
  const oldStats = periodAverages(older);
  const newStats = periodAverages(recent);
  const deltaRisk = newStats.avgRisk - oldStats.avgRisk;
  const deltaOpportunity = newStats.avgOpportunity - oldStats.avgOpportunity;
  const deltaSentiment = newStats.avgSentiment - oldStats.avgSentiment;

  const deltas = sellerPeriodDeltas(meetings);
  const improved = deltas.filter(item => item.score > 0.5);
  const declined = [...deltas].filter(item => item.score < -0.5).sort((a, b) => a.score - b.score);
  const topImprover = improved[0];
  const topDecline = declined[0];

  const insights = [];
  if (topImprover) insights.push(`<div class="insight-pill good">🏆 <strong>${esc(topImprover.name)}</strong> teve a maior evolução: risco ${deltaTag(topImprover.deltaRisk, false)} · expansão ${deltaTag(topImprover.deltaOpportunity, true)}</div>`);
  if (topDecline && (!topImprover || topDecline.id !== topImprover.id)) insights.push(`<div class="insight-pill bad">⚠️ <strong>${esc(topDecline.name)}</strong> merece atenção: risco ${deltaTag(topDecline.deltaRisk, false)} · expansão ${deltaTag(topDecline.deltaOpportunity, true)}</div>`);

  const column = (label, stats) => `<div class="score-col">
    <span class="score-col-label">${esc(label)}</span>
    <strong class="score-col-count">${stats.count} reunião${stats.count === 1 ? '' : 'ões'}</strong>
    <div class="score-col-stats">
      <div><span>Risco médio</span><strong class="score ${riskClass(stats.avgRisk)}">${points(stats.avgRisk)}</strong></div>
      <div><span>Expansão média</span><strong>${points(stats.avgOpportunity)}</strong></div>
      <div><span>Sentimento médio</span><strong>${points(stats.avgSentiment)}</strong></div>
    </div>
  </div>`;

  const deltaList = deltas.length ? `<div class="delta-list">${deltas.map(item => `<div class="delta-row">
      <span class="delta-name">${esc(item.name)}</span>
      <span class="delta-metrics">
        <span class="delta-metric-label">Risco</span>${deltaTag(item.deltaRisk, false)}
        <span class="delta-metric-label">Expansão</span>${deltaTag(item.deltaOpportunity, true)}
      </span>
    </div>`).join('')}</div>` : '<p class="small muted">Cada vendedor precisa de pelo menos 2 reuniões registradas para aparecer aqui.</p>';

  return `
    ${insights.length ? `<div class="insight-row">${insights.join('')}</div>` : ''}
    <div class="score-board">
      ${column('Período anterior', oldStats)}
      <div class="score-vs">
        <span>VS</span>
        <div class="score-vs-item"><span>Risco</span>${deltaTag(deltaRisk, false)}</div>
        <div class="score-vs-item"><span>Expansão</span>${deltaTag(deltaOpportunity, true)}</div>
        <div class="score-vs-item"><span>Sentimento</span>${deltaTag(deltaSentiment, true)}</div>
      </div>
      ${column('Período atual', newStats)}
    </div>
    <p class="small muted" style="margin:18px 24px 6px">Evolução por vendedor (metade mais recente vs. anterior)</p>
    ${deltaList}
  `;
}

function sellerMeetingsCompareCards(list) {
  if (!list.length) return empty('Nenhum vendedor cadastrado', 'Cadastre pessoas na equipe para acompanhar reuniões.');
  return list.map(seller => `<article class="card customer-card">
    <h3>${esc(seller.name)}</h3>
    <p class="meta">${seller.meetingCount} reunião${seller.meetingCount === 1 ? '' : 'ões'} registrada${seller.meetingCount === 1 ? '' : 's'}</p>
    <div class="customer-stats">
      <div><strong class="score ${seller.meetingCount ? riskClass(seller.avgRisk) : ''}">${seller.meetingCount ? points(seller.avgRisk) : '—'}</strong><small>risco médio</small></div>
      <div><strong>${seller.meetingCount ? points(seller.avgOpportunity) : '—'}</strong><small>expansão média</small></div>
      <div><strong>${seller.openTasks}</strong><small>tarefas abertas</small></div>
    </div>
    ${seller.lastMeeting ? `<p class="small muted">Última: <strong>${esc(seller.lastMeeting.customer_name)}</strong> · ${dateText(seller.lastMeeting.created_at)}</p><div class="actions"><button data-meeting="${seller.lastMeeting.id}">Ver última reunião</button></div>` : '<p class="small muted">Ainda sem reuniões registradas.</p>'}
  </article>`).join('');
}

function renderTeamDashboard() {
  if (state.user.role !== 'manager') return;
  const stats = sellerStats();
  const active = stats.filter(seller => seller.meetingCount);
  const avg = list => list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : 0;
  const teamMetrics = [
    ['Vendedores', state.sellers.length, 'na equipe', ''],
    ['Vendedores ativos', `${active.length}/${state.sellers.length}`, 'com reuniões registradas', ''],
    ['Reuniões', state.meetings.length, 'analisadas', ''],
    ['Risco médio', points(avg(active.map(seller => seller.avgRisk))), 'da equipe', ''],
    ['Expansão média', points(avg(active.map(seller => seller.avgOpportunity))), 'da equipe', ''],
    ['Tarefas abertas', state.tasks.filter(task => task.status === 'open').length, 'da equipe', ''],
    ['Em atraso', state.tasks.filter(overdue).length, 'tarefas da equipe', 'alert'],
  ];
  $('teamMetrics').innerHTML = teamMetrics.map(([label, count, note, kind]) => `<article class="metric ${kind}"><span>${label}</span><strong>${count}</strong><small>${note}</small></article>`).join('');
  $('todayLabel2').textContent = dateText(today());
  $('sellerRanking').innerHTML = sellerLeaderboard(stats);
  $('sellerHeatmap').innerHTML = sellerHeatmapGrid(stats);
  $('meetingsTrend').innerHTML = meetingsTrendChart(state.meetings);
  $('meetingsSummary').innerHTML = meetingsSummary(state.meetings);
  $('meetingsComparison').innerHTML = meetingsComparison(state.meetings);
  $('sellerMeetingsCompare').innerHTML = sellerMeetingsCompareCards(stats);
}

function renderOverview() {
  renderTeamDashboard();
  const openTasks = state.tasks.filter(task => task.status === 'open');
  const urgentCustomers = state.customers.filter(item => item.latest_summary?.churn_risk_score >= 70);
  const metrics = [
    ['Clientes', state.customers.length, 'na carteira', ''],
    ['Tarefas', openTasks.length, 'pendentes', ''],
    ['Em atraso', openTasks.filter(overdue).length, 'tarefas', 'alert'],
    ['Revisar', urgentCustomers.length, 'clientes', 'alert'],
  ];
  $('metrics').innerHTML = metrics.map(([label, count, note, kind]) => `<article class="metric ${kind}"><span>${label}</span><strong>${count}</strong><small>${note}</small></article>`).join('');
  $('todayLabel').textContent = dateText(today());
  $('taskCount').textContent = openTasks.length || '';
  $('upcomingTasks').innerHTML = taskRows(openTasks.slice(0, 4), true);
  const priority = [...state.customers].filter(item => item.latest_summary?.churn_risk_score >= 40 || item.latest_summary?.opportunity_score >= 45).sort((a, b) => b.latest_summary.churn_risk_score - a.latest_summary.churn_risk_score).slice(0, 4);
  $('priorityCustomers').innerHTML = priority.length ? priority.map(item => `<div class="list-row"><div><strong>${esc(item.name)}</strong><small>${esc(item.seller_name)} · ${item.latest_summary.churn_risk_score >= 40 ? `${points(item.latest_summary.churn_risk_score)} de risco` : `${points(item.latest_summary.opportunity_score)} de expansão`}</small></div><button data-customer="${item.id}">Abrir</button></div>`).join('') : empty('Nenhum cliente em atenção', 'Os sinais aparecem aqui quando passam do limite.');
  $('recentMeetings').innerHTML = meetingTable(state.meetings.slice(0, 4));
}

function renderCustomers() {
  const query = $('customerSearch').value.trim().toLocaleLowerCase('pt-BR');
  const stage = $('customerStage').value;
  const customers = state.customers.filter(item => (!stage || item.stage === stage) && `${item.name} ${item.segment}`.toLocaleLowerCase('pt-BR').includes(query));
  $('customerList').innerHTML = customers.length ? customers.map(item => `<article class="card customer-card">${badge(stages[item.stage])}<h3>${esc(item.name)}</h3><p class="meta">${esc(item.segment || 'Sem segmento')} · ${esc(item.seller_name)}</p><div class="customer-stats"><div><strong>${item.meeting_count}</strong><small>reuniões</small></div><div><strong>${item.open_tasks}</strong><small>tarefas</small></div><div><strong>${item.latest_summary ? points(item.latest_summary.churn_risk_score) : '—'}</strong><small>risco</small></div></div><p class="small muted">${item.next_due ? `Próximo prazo: ${dateText(item.next_due)}` : 'Sem próximo contato.'}</p><div class="actions"><button data-customer="${item.id}">Abrir</button><button data-edit-customer="${item.id}" class="text-button">Editar</button></div></article>`).join('') : empty('Nenhum cliente', 'Cadastre um cliente ou ajuste a busca.');
}

function renderMeetings() {
  const query = $('meetingSearch').value.trim().toLocaleLowerCase('pt-BR');
  const risk = $('meetingRisk').value;
  $('meetingList').innerHTML = meetingTable(state.meetings.filter(item => (!risk || riskClass(item.summary.churn_risk_score) === risk) && `${item.title} ${item.customer_name} ${item.seller.name}`.toLocaleLowerCase('pt-BR').includes(query)));
}

function renderTasks() {
  const status = $('taskStatus').value;
  const query = $('taskSearch').value.trim().toLocaleLowerCase('pt-BR');
  $('taskList').innerHTML = taskRows(state.tasks.filter(task => (status === 'all' || (status === 'overdue' ? overdue(task) : task.status === status)) && `${task.title} ${task.customer_name} ${task.seller_name}`.toLocaleLowerCase('pt-BR').includes(query)));
}

function renderTeam() {
  if (state.user.role !== 'manager') return;
  $('teamList').innerHTML = state.users.map(user => `<article class="card customer-card">${badge(user.active ? 'Ativo' : 'Desativado', user.active ? 'done' : '')}<h3>${esc(user.name)}</h3><p class="meta">${esc(user.email)} · ${roleName(user.role)}</p><div class="customer-stats"><div><strong>${state.customers.filter(item => item.seller_id === user.id).length}</strong><small>clientes</small></div><div><strong>${state.tasks.filter(item => item.seller_id === user.id && item.status === 'open').length}</strong><small>tarefas</small></div></div>${user.id !== state.user.id ? `<button data-access-user="${user.id}">${user.active ? 'Desativar' : 'Reativar'}</button>` : '<p class="small muted">Sua conta</p>'}</article>`).join('');
}

function customerOptions(selected = '') {
  return '<option value="">Selecione</option>' + state.customers.map(item => `<option value="${item.id}" ${String(item.id) === String(selected) ? 'selected' : ''}>${esc(item.name)}${state.user.role === 'manager' ? ` · ${esc(item.seller_name)}` : ''}</option>`).join('');
}

function render() {
  renderOverview(); renderCustomers(); renderMeetings(); renderTasks(); renderTeam();
  const selected = $('uploadCustomer').value;
  $('uploadCustomer').innerHTML = customerOptions(selected);
}

function field(name, label, value = '', type = 'text', attributes = '') {
  return `<label for="field-${name}">${label}</label><input id="field-${name}" name="${name}" type="${type}" value="${esc(value)}" ${attributes}>`;
}

function select(name, label, options, selected) {
  return `<label for="field-${name}">${label}</label><select id="field-${name}" name="${name}" required>${Object.entries(options).map(([key, value]) => `<option value="${esc(key)}" ${String(selected) === key ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select>`;
}

function notes(value = '') {
  return `<label for="field-notes">Notas (opcional)</label><textarea id="field-notes" name="notes" maxlength="4000">${esc(value)}</textarea>`;
}

function editEntity(title, fields, save, label = 'Salvar') {
  $('entityForm').reset();
  $('entityForm').querySelector('[data-form-error]').textContent = '';
  $('formTitle').textContent = title;
  $('entityFields').innerHTML = fields;
  $('entitySubmit').textContent = label;
  state.saveEntity = save;
  state.savedMessage = {
    'Cadastrar cliente': 'Cliente cadastrado.',
    'Editar cliente': 'Cliente atualizado.',
    'Criar tarefa': 'Tarefa criada.',
    'Editar tarefa': 'Tarefa atualizada.',
    'Cadastrar pessoa': 'Pessoa cadastrada na equipe.',
    'Desativar acesso': 'Acesso desativado.',
    'Reativar acesso': 'Acesso reativado.',
    'Editar título da reunião': 'Título atualizado.',
  }[title];
  $('formDialog').showModal();
}

function editCustomer(id) {
  const item = state.customers.find(customer => customer.id === Number(id));
  let fields = field('name', 'Nome do cliente', item?.name, 'text', 'required maxlength="120"') + field('segment', 'Segmento (opcional)', item?.segment, 'text', 'maxlength="100"') + select('stage', 'Etapa do atendimento', stages, item?.stage || 'active') + notes(item?.notes);
  if (!item && state.user.role === 'manager') fields += select('seller_id', 'Vendedor responsável', { '': 'Selecione', ...Object.fromEntries(state.sellers.map(seller => [seller.id, seller.name])) }, '');
  editEntity(item ? 'Editar cliente' : 'Cadastrar cliente', fields, async values => {
    if (values.seller_id) values.seller_id = Number(values.seller_id);
    await api(item ? `/customers/${item.id}` : '/customers', { method: item ? 'PATCH' : 'POST', body: JSON.stringify(values) });
  }, item ? 'Salvar cadastro' : 'Cadastrar cliente');
}

function editTask(id, customerId = '', meetingId = null, suggestion = '') {
  if (!state.customers.length) { notify('Cadastre um cliente primeiro.'); showPage('customers'); return; }
  const item = state.tasks.find(task => task.id === Number(id));
  let fields = item ? `<p class="muted">${esc(item.customer_name)} · ${esc(item.seller_name)}</p>` : `<label for="field-customer_id">Cliente</label><select id="field-customer_id" name="customer_id" required>${customerOptions(customerId)}</select>`;
  fields += field('title', 'Tarefa', item?.title || suggestion.slice(0, 160), 'text', 'required maxlength="160" placeholder="Ex.: Enviar proposta"') + field('due_date', 'Prazo', item?.due_date || today(), 'date', 'required') + select('priority', 'Prioridade', { normal: 'Normal', high: 'Alta' }, item?.priority || 'normal') + notes(item?.notes);
  if (item) fields += select('status', 'Situação', { open: 'Pendente', done: 'Concluída' }, item.status);
  editEntity(item ? 'Editar tarefa' : 'Criar tarefa', fields, async values => {
    if (!item) { values.customer_id = Number(values.customer_id); values.meeting_id = meetingId; }
    await api(item ? `/tasks/${item.id}` : '/tasks', { method: item ? 'PATCH' : 'POST', body: JSON.stringify(values) });
  }, item ? 'Salvar tarefa' : 'Criar tarefa');
}

function addUser() {
  const fields = field('name', 'Nome', '', 'text', 'required maxlength="120" autocomplete="name"') + field('email', 'E-mail', '', 'email', 'required maxlength="254" autocomplete="off"') + select('role', 'Perfil', { seller: 'Vendedor', manager: 'Gerente' }, 'seller') + field('password', 'Senha inicial', '', 'password', 'required minlength="15" maxlength="128" autocomplete="new-password"') + '<p class="hint">15 a 128 caracteres.</p>' + field('current_password', 'Sua senha', '', 'password', 'required autocomplete="current-password"');
  editEntity('Cadastrar pessoa', fields, values => api('/users', { method: 'POST', body: JSON.stringify(values) }), 'Cadastrar pessoa');
}

function changeAccess(id) {
  const user = state.users.find(item => item.id === Number(id));
  const action = user.active ? 'Desativar' : 'Reativar';
  editEntity(`${action} acesso`, `<p>${esc(user.name)} · ${esc(user.email)}</p><p class="muted">${user.active ? 'As sessões serão encerradas. O histórico será mantido.' : 'A senha atual continuará válida.'}</p>` + field('current_password', 'Sua senha', '', 'password', 'required autocomplete="current-password"'), values => api(`/users/${user.id}/access`, { method: 'PATCH', body: JSON.stringify({ ...values, active: !user.active }) }), `${action} acesso`);
}

function showDetail(title, html, descriptor) {
  state.detail = descriptor;
  $('detailTitle').textContent = title;
  $('detailBody').innerHTML = html;
  if (!$('detailDialog').open) $('detailDialog').showModal();
}

async function openCustomer(id) {
  const customer = await api(`/customers/${id}`);
  const history = [...customer.meetings].reverse();
  const delta = history.length >= 2 ? history.at(-1).summary.churn_risk_score - history.at(-2).summary.churn_risk_score : null;
  const trend = delta === null ? 'É preciso ter duas reuniões para comparar.' : `Variação de ${delta > 0 ? '+' : ''}${points(delta)} no risco. Use como referência.`;
  showDetail(customer.name, `<p class="muted">${esc(stages[customer.stage])} · ${esc(customer.seller_name)} · ${esc(customer.segment || 'Sem segmento')}</p><div class="actions"><button data-edit-customer="${id}">Editar</button><button data-customer-task="${id}" class="primary">Nova tarefa</button></div><div class="detail-block"><h3>Notas</h3><p style="white-space:pre-wrap">${esc(customer.notes || 'Sem notas.')}</p></div><div class="detail-block"><h3>Indicadores</h3><p class="small muted">${esc(trend)}</p>${history.length ? `<div class="table-scroll"><table><thead><tr><th>Data</th><th>Reunião</th><th>Risco</th><th>Expansão</th></tr></thead><tbody>${history.map(item => `<tr><td>${dateText(item.created_at)}</td><td><button data-meeting="${item.id}">${esc(item.title)}</button></td><td>${points(item.summary.churn_risk_score)}</td><td>${points(item.summary.opportunity_score)}</td></tr>`).join('')}</tbody></table></div>` : empty('Sem reuniões', 'Envie uma transcrição para iniciar o histórico.')}</div><div class="detail-block"><h3>Tarefas</h3>${taskRows(customer.tasks)}</div>`, { type: 'customer', id });
}

function explanation(summary) {
  const details = summary.score_explanation;
  if (!details) return '<p class="small muted">Detalhamento indisponível para esta reunião.</p>';
  return `<div class="table-scroll"><table class="breakdown"><thead><tr><th>Componente</th><th>Risco</th><th>Expansão</th></tr></thead><tbody><tr><td>Intenção × 45</td><td>${points(details.churn.intent_points)}</td><td>${points(details.opportunity.intent_points)}</td></tr><tr><td>Preço × 12</td><td>${points(details.churn.price_points)}</td><td>—</td></tr><tr><td>Sentimento × 80</td><td>${points(details.churn.sentiment_points)}</td><td>—</td></tr><tr><td>Produtos × 8</td><td>—</td><td>${points(details.opportunity.product_points)}</td></tr></tbody></table></div><p class="hint">Máximo de 100 pontos. ${details.customer_speeches} falas do cliente. ${esc(details.note)}</p>`;
}

async function openMeeting(id) {
  const item = await api(`/meetings/${id}`);
  const summary = item.analysis.summary;
  const html = `<p class="muted">${esc(item.customer_name)} · ${esc(item.seller.name)} · ${dateText(item.created_at)}</p><div class="actions no-print"><button data-meeting-task="${item.id}" class="primary">Nova tarefa</button><button data-rename-meeting="${item.id}">Editar título</button><button id="printReport">Salvar PDF</button></div><div class="detail-scores"><div><small>Risco</small><strong class="score ${riskClass(summary.churn_risk_score)}">${points(summary.churn_risk_score)}</strong></div><div><small>Expansão</small><strong>${points(summary.opportunity_score)}</strong></div><div><small>Sentimento</small><strong>${points(summary.sentiment_score)}</strong></div></div><p class="method-note">Indicadores por regras. Revise as falas antes de agir.</p><div class="recommendation"><strong>Próximo passo</strong><p>${esc(summary.recommended_action)}</p></div><h3>Cálculo</h3>${explanation(summary)}<div class="detail-block"><h3>Termos citados</h3><div class="tags">${[...summary.products_identified, ...summary.key_terms.map(item => item.term)].map(term => badge(term)).join('') || '<p class="muted">Nenhum termo.</p>'}</div><h3>Transcrição</h3>${item.analysis.message_analysis.map((message, index) => `<article class="message"><div class="message-header"><strong>${index + 1}. ${esc(message.speaker)}</strong>${badge(intents[message.intent] || message.intent)}</div><p>${esc(message.original_text)}</p><small class="muted">Confiança: ${Math.round(message.classification.confidence * 100)}%</small></article>`).join('')}</div><p class="print-only small">Torus · ${dateText(today())}</p>`;
  showDetail(item.title, html, { type: 'meeting', id, item });
}

async function submitForm(form, operation) {
  const errorElement = form.querySelector('[data-form-error]') || $('loginError');
  const submit = form.querySelector('[type="submit"]');
  errorElement.textContent = '';
  submit.disabled = true;
  try { await operation(); } catch (error) { errorElement.textContent = error.message; } finally { submit.disabled = false; }
}

$('loginForm').addEventListener('submit', event => {
  event.preventDefault();
  submitForm(event.currentTarget, async () => {
    const result = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: $('email').value, password: $('password').value }) });
    state.token = result.access_token;
    sessionStorage.setItem('torus_token', state.token);
    await enterApp();
    $('password').value = '';
  });
});
$('entityForm').addEventListener('submit', event => {
  event.preventDefault();
  submitForm(event.currentTarget, async () => {
    await state.saveEntity(Object.fromEntries(new FormData(event.currentTarget)));
    $('formDialog').close();
    $('entityForm').reset();
    notify(state.savedMessage);
    await refresh();
    if ($('detailDialog').open && state.detail) {
      if (state.detail.type === 'customer') await openCustomer(state.detail.id);
      else await openMeeting(state.detail.id);
    }
  });
});
$('passwordForm').addEventListener('submit', event => {
  event.preventDefault();
  submitForm(event.currentTarget, async () => {
    if ($('newPassword').value !== $('confirmPassword').value) throw new Error('As senhas não conferem.');
    await api('/auth/change-password', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    $('passwordForm').reset();
    clearSession();
    notify('Senha alterada.');
  });
});
$('uploadForm').addEventListener('submit', event => {
  event.preventDefault();
  submitForm(event.currentTarget, async () => {
    const file = $('meetingFile').files[0];
    if (!file || file.size > 1000000) throw new Error('Escolha um arquivo JSON com até 1 MB.');
    const result = await api('/analyze_meeting_file', { method: 'POST', body: new FormData(event.currentTarget) });
    $('uploadForm').reset();
    notify('Reunião analisada.');
    await refresh();
    await openMeeting(result.record_id);
  });
});

document.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button) return;
  try {
    const data = button.dataset;
    if (data.page) showPage(data.page);
    else if (data.close) $(data.close).close();
    else if (data.demo) {
      $('email').value = data.demo === 'manager' ? 'manager@torus.ai' : 'ana@torus.ai';
      $('password').value = data.demo === 'manager' ? 'Torus@2026' : 'Vendas@2026';
    } else if (data.customer) await openCustomer(data.customer);
    else if (data.meeting) await openMeeting(data.meeting);
    else if (data.editCustomer) editCustomer(data.editCustomer);
    else if (data.task) editTask(data.task);
    else if (data.customerTask) editTask(null, data.customerTask);
    else if (data.meetingTask) {
      const item = state.detail.item;
      editTask(null, item.customer_id, item.id, item.summary.recommended_action);
    } else if (data.renameMeeting) {
      const item = state.detail.item;
      editEntity('Editar título da reunião', field('title', 'Título', item.title, 'text', 'required maxlength="120"'), values => api(`/meetings/${item.id}`, { method: 'PATCH', body: JSON.stringify(values) }), 'Salvar título');
    } else if (data.accessUser) changeAccess(data.accessUser);
    else if (button.id === 'newCustomer') editCustomer();
    else if (button.id === 'newTask') editTask();
    else if (button.id === 'newUser') addUser();
    else if (button.id === 'printReport') window.print();
    else if (button.id === 'refreshButton') { button.disabled = true; await refresh(); notify('Dados atualizados.'); }
    else if (button.id === 'logoutButton') { try { await api('/auth/logout', { method: 'POST' }); } finally { clearSession(); } }
    else if (button.id === 'showPassword') {
      const show = $('password').type === 'password';
      $('password').type = show ? 'text' : 'password';
      button.textContent = show ? 'Ocultar' : 'Mostrar';
      button.setAttribute('aria-label', `${show ? 'Ocultar' : 'Mostrar'} senha`);
    } else if (button.id === 'mobileMenu') {
      const open = $('sidebar').classList.toggle('open');
      button.setAttribute('aria-expanded', String(open));
      updateSidebarAccess();
    } else if (button.id === 'exportMeetings') {
      const blob = await api('/reports/meetings.csv', { download: true });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'torus-reunioes.csv'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('Exportação pronta.');
    }
  } catch (error) { report(error); } finally { button.disabled = false; }
});

for (const id of ['customerSearch', 'customerStage']) $(id).addEventListener('input', renderCustomers);
for (const id of ['meetingSearch', 'meetingRisk']) $(id).addEventListener('input', renderMeetings);
for (const id of ['taskStatus', 'taskSearch']) $(id).addEventListener('input', renderTasks);
$('formDialog').addEventListener('close', () => { $('entityForm').reset(); });

if (state.token) enterApp().catch(error => { clearSession(); report(error); });

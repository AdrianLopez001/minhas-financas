'use strict';

/* ===================== UTILITÁRIOS ===================== */
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const fmt = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = (n) => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const mesNome = (ym) => { const [y, m] = ym.split('-').map(Number); return `${MESES[m - 1]}/${String(y).slice(2)}`; };
const mesLongo = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }); };

function parseMoney(str) {
  let s = String(str).trim().replace(/[R$\s]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');      // 1.234,56
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');      // 3.200 = três mil e duzentos
  const v = parseFloat(s);
  return isNaN(v) ? NaN : Math.round(v * 100);
}
function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(y, m - 1 + n, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(Math.min(d, last))}`;
}
const addYM = (ym, n) => addMonths(ym + '-01', n).slice(0, 7);
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}
function shortMoney(c) {
  const v = c / 100, a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(1).replace('.', ',') + 'mi';
  if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace('.', ',') + 'k';
  return String(Math.round(v));
}

/* ===================== DADOS (salvos no próprio aparelho) ===================== */
const KEY = 'minhas-financas-v1';
const DEFAULT_CATS = {
  despesa: ['Cartão de crédito', 'Empréstimo', 'Financiamento', 'Moradia', 'Contas da casa', 'Alimentação', 'Transporte', 'Saúde', 'Educação', 'Lazer', 'Outros'],
  receita: ['Salário', 'Freelance', 'Investimentos', 'Presente', 'Outros'],
};
const COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#a855f7', '#14b8a6', '#ec4899', '#eab308', '#64748b', '#f97316', '#06b6d4', '#84cc16'];
const emptyState = () => ({ transactions: [], categories: structuredClone(DEFAULT_CATS), budgets: {} });

function normalize(s) {
  s.categories = s.categories || structuredClone(DEFAULT_CATS);
  s.budgets = s.budgets || {};
  const hoje = todayISO();
  s.transactions.forEach((t) => { if (typeof t.paid !== 'boolean') t.paid = t.date <= hoje; });
  return s;
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.transactions)) return normalize(s);
  } catch (e) { /* dados corrompidos: começa do zero */ }
  return emptyState();
}
function save() { localStorage.setItem(KEY, JSON.stringify(state)); }

let state = load();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

/* ===================== CÁLCULOS ===================== */
let cur = todayISO().slice(0, 7); // mês exibido "AAAA-MM"
const sum = (list, type) => list.filter((t) => !type || t.type === type).reduce((a, t) => a + t.amount, 0);
const inMonth = (ym) => state.transactions.filter((t) => t.date.startsWith(ym));
const monthTx = () => inMonth(cur);
const isLate = (t) => !t.paid && t.date < todayISO();
const sortDate = (a, b) => a.date.localeCompare(b.date) || (a.created || 0) - (b.created || 0);

function totais() {
  const tx = state.transactions;
  const pagos = tx.filter((t) => t.paid), pend = tx.filter((t) => !t.paid);
  const saldoAtual = sum(pagos, 'receita') - sum(pagos, 'despesa');
  const aPagar = sum(pend, 'despesa'), aReceber = sum(pend, 'receita');
  const pendDesp = pend.filter((t) => t.type === 'despesa').sort(sortDate);
  return { saldoAtual, aPagar, aReceber, pendDesp, ultimaConta: pendDesp.length ? pendDesp[pendDesp.length - 1].date : null };
}
// Saldo projetado ao fim de um mês: considera tudo (pago ou não) até aquele mês.
const saldoAte = (ym) => { const lim = ym + '-31'; const l = state.transactions.filter((t) => t.date <= lim); return sum(l, 'receita') - sum(l, 'despesa'); };
// Dívida restante ao fim de um mês: contas pendentes com vencimento depois dele.
const dividaApos = (ym) => { const lim = ym + '-31'; return sum(state.transactions.filter((t) => !t.paid && t.type === 'despesa' && t.date > lim)); };

/* ===================== ITEM DE LISTA ===================== */
function statusOf(t) {
  if (t.paid) return { cls: 'paid', icon: '✓', txt: t.type === 'receita' ? 'Recebido' : 'Pago' };
  if (isLate(t)) return { cls: 'late', icon: '!', txt: 'Atrasado' };
  return { cls: 'pending', icon: '', txt: t.type === 'receita' ? 'A receber' : 'A pagar' };
}
function txItem(t, showDate = true) {
  const st = statusOf(t);
  const d = t.date.split('-').reverse().slice(0, 2).join('/');
  const sign = t.type === 'receita' ? '+' : '−';
  return `<li class="tx ${t.paid ? 'is-paid' : ''}" data-id="${t.id}">
    <button class="dot ${t.type} ${st.cls}" data-toggle="${t.id}" aria-label="Marcar como pago">${st.icon}</button>
    <div class="info"><b>${esc(t.desc || t.category)}</b>
      <span>${esc(t.category)}${showDate ? ' · ' + d : ''} · <em class="st-${st.cls}">${st.txt}</em></span></div>
    <div class="val ${t.type === 'receita' ? 'pos' : 'neg'}">${sign} ${fmt(t.amount)}</div>
  </li>`;
}

/* ===================== RESUMO ===================== */
function renderResumo() {
  const T = totais();
  const sa = $('#saldoAtual'); sa.textContent = fmt(T.saldoAtual); sa.className = T.saldoAtual < 0 ? 'neg' : '';
  $('#totalPagar').textContent = fmt(T.aPagar);
  $('#totalReceber').textContent = fmt(T.aReceber);
  const q = T.saldoAtual + T.aReceber - T.aPagar;
  const sq = $('#saldoQuitado'); sq.textContent = fmt(q); sq.className = q < 0 ? 'neg' : 'pos';
  $('#quitacao').innerHTML = T.ultimaConta
    ? `Última conta pendente vence em <b>${mesLongo(T.ultimaConta.slice(0, 7))}</b>`
    : 'Nenhuma conta pendente 🎉';

  const atrasadas = T.pendDesp.filter(isLate);
  const badge = $('#atrasadasBadge');
  badge.hidden = !atrasadas.length;
  badge.textContent = `${atrasadas.length} atrasada${atrasadas.length > 1 ? 's' : ''}`;
  const prox = T.pendDesp.slice(0, 6);
  $('#proximas').innerHTML = prox.length ? prox.map((t) => txItem(t)).join('') +
    (T.pendDesp.length > 6 ? `<li class="more muted small">+ ${T.pendDesp.length - 6} contas pendentes</li>` : '')
    : '<li class="empty">Nenhuma conta a pagar. Toque no + para cadastrar.</li>';

  const list = monthTx();
  const rec = sum(list, 'receita'), desp = sum(list, 'despesa');
  $('#recMes').textContent = fmt(rec);
  $('#despMes').textContent = fmt(desp);
  const sm = $('#saldoMes'); sm.textContent = fmt(rec - desp); sm.className = rec - desp < 0 ? 'neg' : 'pos';
  $('#pendMes').textContent = fmt(sum(list.filter((t) => !t.paid), 'despesa'));

  const byCat = {};
  list.filter((t) => t.type === 'despesa').forEach((t) => { byCat[t.category] = (byCat[t.category] || 0) + t.amount; });
  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const r = 15.915;
  let html = `<circle cx="21" cy="21" r="${r}" fill="none" stroke="#273449" stroke-width="6"/>`;
  let offset = 25;
  entries.forEach(([, v], i) => {
    const pct = (v / desp) * 100;
    html += `<circle cx="21" cy="21" r="${r}" fill="none" stroke="${COLORS[i % COLORS.length]}" stroke-width="6" stroke-dasharray="${pct} ${100 - pct}" stroke-dashoffset="${offset}"/>`;
    offset -= pct;
  });
  html += `<text x="21" y="22.5" text-anchor="middle" font-size="4" fill="#e2e8f0" font-weight="600">${desp ? shortMoney(desp) : '—'}</text>`;
  $('#donut').innerHTML = html;
  $('#legend').innerHTML = entries.length
    ? entries.map(([c, v], i) => `<li><i style="background:${COLORS[i % COLORS.length]}"></i><span>${esc(c)}</span><b>${Math.round((v / desp) * 100)}%</b></li>`).join('')
    : '<li class="muted">Nenhuma saída neste mês</li>';
}

/* ===================== CALENDÁRIO ===================== */
let selDay = todayISO();
function renderCalendario() {
  const [y, m] = cur.split('-').map(Number);
  if (!selDay.startsWith(cur)) selDay = todayISO().startsWith(cur) ? todayISO() : cur + '-01';
  const first = new Date(y, m - 1, 1).getDay();
  const days = new Date(y, m, 0).getDate();
  const hoje = todayISO();
  const byDay = {};
  monthTx().sort(sortDate).forEach((t) => (byDay[t.date] = byDay[t.date] || []).push(t));

  let html = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d) => `<div class="wd">${d}</div>`).join('');
  for (let i = 0; i < first; i++) html += '<div class="cell out"></div>';
  for (let d = 1; d <= days; d++) {
    const iso = `${cur}-${pad(d)}`;
    const items = byDay[iso] || [];
    const chips = items.slice(0, 2).map((t) => {
      const cls = t.paid ? 'done' : isLate(t) ? 'late' : t.type === 'receita' ? 'in' : 'out';
      return `<span class="ev ${cls}">${esc(t.desc || t.category)}</span>`;
    }).join('');
    const more = items.length > 2 ? `<span class="ev more">+${items.length - 2}</span>` : '';
    html += `<button class="cell ${iso === hoje ? 'today' : ''} ${iso === selDay ? 'sel' : ''}" data-day="${iso}">
      <span class="num">${d}</span>${chips}${more}</button>`;
  }
  $('#calGrid').innerHTML = html;

  const [yy, mm, dd] = selDay.split('-').map(Number);
  $('#diaTitulo').textContent = cap(new Date(yy, mm - 1, dd).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }));
  const doDia = byDay[selDay] || [];
  $('#diaLista').innerHTML = doDia.length ? doDia.map((t) => txItem(t, false)).join('') : '<li class="empty">Nada marcado para este dia</li>';
}
$('#calGrid').addEventListener('click', (e) => {
  const c = e.target.closest('[data-day]'); if (!c) return;
  selDay = c.dataset.day; renderCalendario();
});
$('#addDia').onclick = () => openTx(null, selDay);

/* ===================== LANÇAMENTOS ===================== */
let filtro = 'todos';
function renderLancamentos() {
  const q = $('#busca').value.trim().toLowerCase();
  let list = monthTx();
  if (filtro === 'pendente') list = list.filter((t) => !t.paid);
  else if (filtro !== 'todos') list = list.filter((t) => t.type === filtro);
  if (q) list = list.filter((t) => (t.desc + ' ' + t.category).toLowerCase().includes(q));
  list.sort((a, b) => b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0));

  if (!list.length) { $('#listaLancamentos').innerHTML = '<div class="empty">Nenhum lançamento encontrado</div>'; return; }
  const groups = {};
  list.forEach((t) => (groups[t.date] = groups[t.date] || []).push(t));
  $('#listaLancamentos').innerHTML = Object.entries(groups).map(([date, items]) => {
    const [y, m, d] = date.split('-').map(Number);
    const label = new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'short' });
    const net = sum(items, 'receita') - sum(items, 'despesa');
    return `<div class="day-head"><span>${label}</span><span class="${net < 0 ? 'neg' : 'pos'}">${fmt(net)}</span></div>
      <ul class="tx-list card" style="padding:4px 12px">${items.map((t) => txItem(t, false)).join('')}</ul>`;
  }).join('');
}

/* ===================== GRÁFICO DE LINHA (SVG) ===================== */
function lineChart(svg, labels, series, selected) {
  const W = 340, H = +svg.getAttribute('viewBox').split(' ')[3], pl = 40, pr = 10, pt = 12, pb = 24;
  const all = series.flatMap((s) => s.values);
  let max = Math.max(0, ...all), min = Math.min(0, ...all);
  if (max === min) max = min + 10000;
  const span = max - min; max += span * 0.08; if (min < 0) min -= span * 0.08;
  const n = labels.length;
  const x = (i) => pl + (W - pl - pr) * (n === 1 ? 0.5 : i / (n - 1));
  const y = (v) => pt + (H - pt - pb) * (1 - (v - min) / (max - min));

  let g = '';
  for (let k = 0; k <= 4; k++) {
    const v = min + ((max - min) * k) / 4;
    g += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" class="grid"/>
      <text x="${pl - 6}" y="${y(v) + 3}" class="ax" text-anchor="end">${shortMoney(v)}</text>`;
  }
  if (min < 0) g += `<line x1="${pl}" x2="${W - pr}" y1="${y(0)}" y2="${y(0)}" class="zero"/>`;
  labels.forEach((l, i) => {
    if (n > 8 && i % 2) return;
    g += `<text x="${x(i)}" y="${H - 6}" class="ax" text-anchor="${i === n - 1 ? 'end' : 'middle'}">${l}</text>`;
  });
  if (selected != null) g += `<line x1="${x(selected)}" x2="${x(selected)}" y1="${pt}" y2="${H - pb}" class="sel-line"/>`;
  series.forEach((s) => {
    const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
    if (s.fill) g += `<polygon points="${x(0)},${y(0)} ${pts} ${x(n - 1)},${y(0)}" fill="${s.color}" opacity=".12"/>`;
    g += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" ${s.dashed ? 'stroke-dasharray="5 4"' : ''}/>`;
    s.values.forEach((v, i) => { g += `<circle cx="${x(i)}" cy="${y(v)}" r="${i === selected ? 4 : 2.4}" fill="${s.color}"/>`; });
  });
  const colW = (W - pl - pr) / Math.max(1, n - 1);
  labels.forEach((_, i) => { g += `<rect x="${x(i) - colW / 2}" y="0" width="${colW}" height="${H}" fill="transparent" data-i="${i}"/>`; });
  svg.innerHTML = g;
}

/* ===================== INSIGHTS ===================== */
let periodo = 6, selFluxo = null;
// Período do gráfico: a partir do mês exibido, por 6 ou 12 meses
const mesesPeriodo = () => Array.from({ length: periodo }, (_, i) => addYM(cur, i));
// Junta meses seguidos em intervalos: "dez/26 a out/27, dez/27"
function intervalos(lista, todos) {
  const out = []; let ini = null, ant = null;
  lista.forEach((ym) => {
    if (ant && todos.indexOf(ym) === todos.indexOf(ant) + 1) { ant = ym; return; }
    if (ini) out.push(ini === ant ? mesNome(ini) : `${mesNome(ini)} a ${mesNome(ant)}`);
    ini = ant = ym;
  });
  if (ini) out.push(ini === ant ? mesNome(ini) : `${mesNome(ini)} a ${mesNome(ant)}`);
  return out.join(', ');
}
function renderInsights() {
  const hoje = todayISO();
  // Projeção do mês
  const list = monthTx();
  const rec = sum(list, 'receita'), desp = sum(list, 'despesa');
  const pm = $('#projMes'); const fimMes = saldoAte(cur);
  pm.textContent = fmt(fimMes); pm.className = fimMes < 0 ? 'neg' : 'pos';
  $('#projMesInfo').innerHTML = `Saldo previsto no fim de ${MESES[+cur.slice(5) - 1]}<br>${fmt(rec)} entram · ${fmt(desp)} saem`;
  // Projeção do ano
  const ano = cur.slice(0, 4), lAno = state.transactions.filter((t) => t.date.startsWith(ano));
  const rA = sum(lAno, 'receita'), dA = sum(lAno, 'despesa');
  const pa = $('#projAno'); const fimAno = saldoAte(ano + '-12');
  pa.textContent = fmt(fimAno); pa.className = fimAno < 0 ? 'neg' : 'pos';
  $('#projAnoInfo').innerHTML = `Saldo previsto em 31/12/${ano}<br>${fmt(rA)} entram · ${fmt(dA)} saem`;

  // Gráfico entradas x saídas
  const meses = mesesPeriodo();
  const recs = meses.map((ym) => sum(inMonth(ym), 'receita'));
  const desps = meses.map((ym) => sum(inMonth(ym), 'despesa'));
  const saldos = meses.map(saldoAte);
  if (selFluxo != null && selFluxo >= meses.length) selFluxo = null;
  lineChart($('#chartFluxo'), meses.map(mesNome), [
    { values: recs, color: '#4ade80' },
    { values: desps, color: '#f87171' },
    { values: saldos, color: '#60a5fa', dashed: true },
  ], selFluxo);
  if (selFluxo != null) {
    const i = selFluxo, net = recs[i] - desps[i];
    $('#fluxoDetalhe').innerHTML = `<b>${mesLongo(meses[i])}</b><br>
      <span class="pos">Entradas ${fmt(recs[i])}</span> · <span class="neg">Saídas ${fmt(desps[i])}</span><br>
      Resultado do mês <b class="${net < 0 ? 'neg' : 'pos'}">${fmt(net)}</b> · Saldo acumulado <b>${fmt(saldos[i])}</b>`;
  }

  // Dívida restante (do mês atual em diante)
  const startD = hoje.slice(0, 7) > cur ? hoje.slice(0, 7) : cur;
  const mesesD = Array.from({ length: 12 }, (_, i) => addYM(startD, i));
  const dividas = mesesD.map(dividaApos);
  const dividaHoje = totais().aPagar;
  lineChart($('#chartDivida'), ['hoje', ...mesesD.map(mesNome)].slice(0, 13), [{ values: [dividaHoje, ...dividas], color: '#f87171', fill: true }]);
  const zero = mesesD.find((_, i) => dividas[i] === 0);
  $('#dividaDetalhe').innerHTML = dividaHoje === 0 ? 'Você não tem dívidas pendentes. 🎉'
    : zero ? `Pagando em dia, você fica <b class="pos">livre das contas cadastradas</b> ao fim de <b>${mesLongo(zero)}</b>.`
      : `Ainda restarão <b class="neg">${fmt(dividas[11])}</b> depois de ${mesLongo(mesesD[11])}.`;

  // Frases de insight
  const ins = [];
  const T = totais();
  const atr = T.pendDesp.filter(isLate);
  if (atr.length) ins.push(['⚠️', `Você tem <b>${atr.length}</b> conta${atr.length > 1 ? 's' : ''} atrasada${atr.length > 1 ? 's' : ''}, somando <b class="neg">${fmt(sum(atr))}</b>.`]);
  if (T.aPagar) ins.push(['💳', `Total para quitar todas as contas: <b class="neg">${fmt(T.aPagar)}</b>${T.ultimaConta ? `, a última vence em ${mesLongo(T.ultimaConta.slice(0, 7))}` : ''}.`]);
  const negMeses = meses.filter((_, i) => desps[i] > recs[i]);
  $('#insightsPeriodo').textContent = `· ${mesNome(meses[0])} a ${mesNome(meses[meses.length - 1])}`;
  if (negMeses.length === meses.length) ins.push(['📉', `Em <b>todos os ${meses.length} meses</b> do período as saídas passam das entradas.`]);
  else if (negMeses.length) ins.push(['📉', `Saídas maiores que entradas em <b>${negMeses.length} de ${meses.length} meses</b>: ${intervalos(negMeses, meses)}.`]);
  // ponto de virada: primeiro mês positivo depois de um negativo
  for (let i = 1; i < meses.length; i++) {
    if (desps[i - 1] > recs[i - 1] && recs[i] >= desps[i]) { ins.push(['📈', `A partir de <b>${mesLongo(meses[i])}</b> as entradas voltam a superar as saídas.`]); break; }
  }
  const neg = saldos.findIndex((s) => s < 0);
  if (neg >= 0) ins.push(['🚨', `Pelas projeções, seu saldo fica negativo em <b>${mesLongo(meses[neg])}</b> (${fmt(saldos[neg])}).`]);
  const maxI = desps.indexOf(Math.max(...desps));
  if (desps[maxI] > 0) ins.push(['🏋️', `Mês mais pesado do período: <b>${mesLongo(meses[maxI])}</b>, com ${fmt(desps[maxI])} de saídas.`]);
  const prev = sum(inMonth(addYM(cur, -1)), 'despesa');
  if (prev && desp) {
    const p = Math.round(((desp - prev) / prev) * 100);
    ins.push([p > 0 ? '🔺' : '🔻', `Saídas de ${MESES[+cur.slice(5) - 1]} estão <b class="${p > 0 ? 'neg' : 'pos'}">${Math.abs(p)}% ${p > 0 ? 'maiores' : 'menores'}</b> que no mês anterior.`]);
  }
  if (!ins.length) ins.push(['💡', 'Cadastre suas contas e entradas (com repetição mensal) para ver as projeções aqui.']);
  $('#insightsLista').innerHTML = ins.map(([i, t]) => `<li><span>${i}</span><p>${t}</p></li>`).join('');

  renderMetas();
}
$('#chartFluxo').addEventListener('click', (e) => {
  const r = e.target.closest('[data-i]'); if (!r) return;
  selFluxo = +r.dataset.i; renderInsights();
});
$$('#periodo .chip').forEach((b) => (b.onclick = () => {
  periodo = +b.dataset.p; selFluxo = null;
  $$('#periodo .chip').forEach((x) => x.classList.toggle('active', x === b));
  renderInsights();
}));

function renderMetas() {
  const list = monthTx().filter((t) => t.type === 'despesa');
  $('#listaMetas').innerHTML = state.categories.despesa.map((c) => {
    const gasto = list.filter((t) => t.category === c).reduce((a, t) => a + t.amount, 0);
    const lim = state.budgets[c];
    if (!lim) return `<li data-cat="${esc(c)}"><div class="top"><span>${esc(c)}</span><span class="muted">${fmt(gasto)} · sem limite</span></div></li>`;
    const pct = Math.min(100, (gasto / lim) * 100);
    const cls = gasto > lim ? 'over' : pct >= 80 ? 'warn' : '';
    const resta = lim - gasto;
    return `<li data-cat="${esc(c)}">
      <div class="top"><span>${esc(c)}</span><span>${fmt(gasto)} / ${fmt(lim)}</span></div>
      <div class="bar"><div class="${cls}" style="width:${pct}%"></div></div>
      <div class="small ${resta < 0 ? 'neg' : 'muted'}" style="margin-top:4px">${resta < 0 ? 'Passou ' + fmt(-resta) : 'Restam ' + fmt(resta)}</div>
    </li>`;
  }).join('');
}

/* ===================== CATEGORIAS ===================== */
let tipoCat = 'despesa';
function renderCats() {
  $('#listaCats').innerHTML = state.categories[tipoCat].map((c, i) =>
    `<li><span>${esc(c)}</span><button data-i="${i}" aria-label="Remover">×</button></li>`).join('');
}

/* ===================== RENDER GERAL / NAVEGAÇÃO ===================== */
function render() {
  $('#monthLabel').textContent = cap(mesLongo(cur));
  renderResumo(); renderCalendario(); renderLancamentos(); renderInsights(); renderCats();
}
function shiftMonth(n) { cur = addYM(cur, n); selFluxo = null; render(); }
let view = 'resumo';
$$('.tab').forEach((b) => b.addEventListener('click', () => {
  view = b.dataset.view;
  $$('.tab').forEach((x) => x.classList.toggle('active', x === b));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
  window.scrollTo(0, 0);
}));
$('#prevMonth').onclick = () => shiftMonth(-1);
$('#nextMonth').onclick = () => shiftMonth(1);

let touchX = null, touchY = null;
$('main').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; }, { passive: true });
$('main').addEventListener('touchend', (e) => {
  if (touchX === null || e.target.closest('svg')) return;
  const dx = e.changedTouches[0].clientX - touchX, dy = e.changedTouches[0].clientY - touchY; touchX = null;
  if (Math.abs(dx) > 90 && Math.abs(dx) > Math.abs(dy) * 1.5) shiftMonth(dx < 0 ? 1 : -1);
});

/* ===================== FORMULÁRIO DE LANÇAMENTO ===================== */
const dlg = $('#dlgTx');
let editId = null, tipo = 'despesa', pagoTocado = false;

function setTipo(t) {
  tipo = t;
  $$('#segTipo .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.t === t));
  $('#txCat').innerHTML = state.categories[t].map((c) => `<option>${esc(c)}</option>`).join('');
  $('#txPagoLbl').textContent = t === 'receita' ? 'Já foi recebido' : 'Já foi pago';
}
$$('#segTipo .seg-btn').forEach((b) => (b.onclick = () => setTipo(b.dataset.t)));
$('#txPago').addEventListener('change', () => { pagoTocado = true; });
$('#txData').addEventListener('change', () => {
  if (!editId && !pagoTocado) $('#txPago').checked = $('#txData').value <= todayISO();
});

function openTx(t, dataPadrao) {
  editId = t ? t.id : null; pagoTocado = false;
  $('#dlgTitle').textContent = t ? 'Editar lançamento' : 'Novo lançamento';
  setTipo(t ? t.type : 'despesa');
  $('#txValor').value = t ? (t.amount / 100).toFixed(2).replace('.', ',') : '';
  $('#txDesc').value = t ? t.desc : '';
  if (t) {
    if (!state.categories[t.type].includes(t.category)) $('#txCat').insertAdjacentHTML('beforeend', `<option>${esc(t.category)}</option>`);
    $('#txCat').value = t.category;
  }
  const hoje = todayISO();
  $('#txData').value = t ? t.date : dataPadrao || (hoje.startsWith(cur) ? hoje : cur + '-01');
  $('#txPago').checked = t ? t.paid : $('#txData').value <= hoje;
  $('#txRepetir').value = '1';
  $('#lblRepetir').hidden = !!t;
  $('#btnExcluir').hidden = !t;
  dlg.showModal();
  if (!t) setTimeout(() => $('#txValor').focus(), 50);
}

$('#fab').onclick = () => openTx(null, view === 'calendario' ? selDay : null);
$('#btnCancelar').onclick = () => dlg.close();
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

$('#formTx').addEventListener('submit', (e) => {
  e.preventDefault();
  const amount = parseMoney($('#txValor').value);
  if (!(amount > 0)) { toast('Digite um valor válido'); $('#txValor').focus(); return; }
  const base = { type: tipo, amount, desc: $('#txDesc').value.trim(), category: $('#txCat').value, date: $('#txData').value, paid: $('#txPago').checked };
  if (!base.date) { toast('Escolha uma data'); return; }

  if (editId) {
    Object.assign(state.transactions.find((t) => t.id === editId), base);
    toast('Lançamento atualizado');
  } else {
    const n = Math.max(1, Math.min(120, parseInt($('#txRepetir').value, 10) || 1));
    const group = n > 1 ? uid() : undefined;
    for (let i = 0; i < n; i++) {
      state.transactions.push({ ...base, id: uid(), group, created: Date.now() + i, date: addMonths(base.date, i),
        paid: i === 0 ? base.paid : false,
        desc: n > 1 ? `${base.desc || base.category} (${i + 1}/${n})` : base.desc });
    }
    toast(n > 1 ? `${n} lançamentos criados` : 'Lançamento adicionado');
  }
  save(); dlg.close(); render();
});

$('#btnExcluir').onclick = () => {
  const t = state.transactions.find((x) => x.id === editId);
  const futuros = t.group ? state.transactions.filter((x) => x.group === t.group && x.date > t.date) : [];
  if (futuros.length && confirm(`Excluir este e as próximas ${futuros.length} parcelas/repetições?\n\nOK = este e os próximos · Cancelar = escolher outra opção`)) {
    const ids = new Set([t.id, ...futuros.map((x) => x.id)]);
    state.transactions = state.transactions.filter((x) => !ids.has(x.id));
  } else if (confirm('Excluir só este lançamento?')) {
    state.transactions = state.transactions.filter((x) => x.id !== editId);
  } else return;
  save(); dlg.close(); render(); toast('Excluído');
};

// Tocar no círculo marca como pago; tocar no resto abre para editar
document.addEventListener('click', (e) => {
  const tg = e.target.closest('[data-toggle]');
  if (tg) {
    const t = state.transactions.find((x) => x.id === tg.dataset.toggle);
    t.paid = !t.paid; save(); render();
    toast(t.paid ? (t.type === 'receita' ? 'Marcado como recebido' : 'Marcado como pago') : 'Voltou para pendente');
    return;
  }
  const li = e.target.closest('.tx[data-id]');
  if (li) openTx(state.transactions.find((t) => t.id === li.dataset.id));
});

/* ===================== FILTROS ===================== */
$('#busca').addEventListener('input', renderLancamentos);
$$('#filtroTipo .chip').forEach((b) => (b.onclick = () => {
  filtro = b.dataset.f;
  $$('#filtroTipo .chip').forEach((x) => x.classList.toggle('active', x === b));
  renderLancamentos();
}));

/* ===================== METAS ===================== */
const dlgMeta = $('#dlgMeta');
let metaCat = null;
$('#listaMetas').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-cat]'); if (!li) return;
  metaCat = li.dataset.cat;
  $('#metaTitle').textContent = 'Limite: ' + metaCat;
  const v = state.budgets[metaCat];
  $('#metaValor').value = v ? (v / 100).toFixed(2).replace('.', ',') : '';
  dlgMeta.showModal();
});
$('#metaCancelar').onclick = () => dlgMeta.close();
$('#formMeta').addEventListener('submit', (e) => {
  e.preventDefault();
  const raw = $('#metaValor').value.trim();
  if (!raw) delete state.budgets[metaCat];
  else {
    const v = parseMoney(raw);
    if (!(v > 0)) { toast('Digite um valor válido'); return; }
    state.budgets[metaCat] = v;
  }
  save(); dlgMeta.close(); render(); toast('Limite salvo');
});

/* ===================== CATEGORIAS ===================== */
$$('#tipoCat .chip').forEach((b) => (b.onclick = () => {
  tipoCat = b.dataset.t;
  $$('#tipoCat .chip').forEach((x) => x.classList.toggle('active', x === b));
  renderCats();
}));
$('#formCat').addEventListener('submit', (e) => {
  e.preventDefault();
  const nome = $('#novaCat').value.trim();
  if (!nome) return;
  if (state.categories[tipoCat].some((c) => c.toLowerCase() === nome.toLowerCase())) { toast('Essa categoria já existe'); return; }
  state.categories[tipoCat].push(nome);
  $('#novaCat').value = '';
  save(); render(); toast('Categoria adicionada');
});
$('#listaCats').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-i]'); if (!b) return;
  const list = state.categories[tipoCat];
  if (list.length <= 1) { toast('Mantenha ao menos uma categoria'); return; }
  const nome = list[b.dataset.i];
  if (!confirm(`Remover a categoria "${nome}"? Os lançamentos antigos continuam salvos.`)) return;
  list.splice(b.dataset.i, 1);
  if (tipoCat === 'despesa') delete state.budgets[nome];
  save(); render();
});

/* ===================== BACKUP ===================== */
function download(name, content, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
$('#btnExport').onclick = () => {
  download(`financas-backup-${todayISO()}.json`, JSON.stringify(state, null, 2), 'application/json');
  toast('Backup exportado');
};
$('#btnCsv').onclick = () => {
  const rows = [['Data', 'Tipo', 'Categoria', 'Descrição', 'Valor', 'Status']];
  [...state.transactions].sort(sortDate).forEach((t) =>
    rows.push([t.date, t.type === 'receita' ? 'Entrada' : 'Saída', t.category, t.desc,
      ((t.type === 'despesa' ? -1 : 1) * t.amount / 100).toFixed(2).replace('.', ','), statusOf(t).txt]));
  const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
  download(`financas-${todayISO()}.csv`, csv, 'text/csv');
};
$('#fileImport').addEventListener('change', async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.transactions)) throw new Error();
    if (!confirm(`Importar ${data.transactions.length} lançamentos? Os dados atuais serão substituídos.`)) return;
    state = normalize({ transactions: data.transactions, categories: data.categories, budgets: data.budgets });
    save(); render(); toast('Backup importado');
  } catch { toast('Arquivo de backup inválido'); }
});
$('#btnReset').onclick = () => {
  if (!confirm('Apagar TODOS os dados? Isso não pode ser desfeito.')) return;
  if (!confirm('Tem certeza mesmo? Faça um backup antes, se precisar.')) return;
  state = emptyState();
  save(); render(); toast('Dados apagados');
};

/* ===================== OFFLINE ===================== */
// No localhost (desenvolvimento) o cache fica desligado, para cada alteração aparecer ao recarregar.
const DEV = ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  if (DEV) navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
  else window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
}

// Aviso de instalação: aparece no iPhone/iPad quando aberto pelo Safari (não instalado)
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const instalado = window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
if (isIOS && !instalado && !localStorage.getItem('installTipOff')) $('#installTip').hidden = false;
$('#installClose').onclick = () => { $('#installTip').hidden = true; localStorage.setItem('installTipOff', '1'); };

render();

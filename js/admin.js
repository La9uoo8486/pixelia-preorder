import { CONFIG, SOURCES, esc, isConfigured, makeClient } from './common.js';

const $ = (id) => document.getElementById(id);
let sb;
let rows = [];
let sort = { key: 'id', dir: 'desc' };
let pie, bar;

const fmtTime = (iso) => new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(iso));
const kstDate = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(iso)); // YYYY-MM-DD
const srcLabel = (r) => r.source === 'other' ? `기타: ${r.source_etc ?? ''}` : (SOURCES[r.source] ?? r.source);

// ---------- 인증 ----------
async function showLogin(msg = '') {
  $('dash').hidden = true;
  $('userBox').hidden = true;
  $('loginCard').hidden = false;
  $('loginMsg').textContent = msg;
}

async function enter(session) {
  const { data: ok, error } = await sb.rpc('is_admin');
  if (error || !ok) {
    await sb.auth.signOut();
    return showLogin('관리자 권한이 없는 계정입니다');
  }
  $('who').textContent = session.user.email;
  $('loginCard').hidden = true;
  $('userBox').hidden = false;
  $('dash').hidden = false;
  await load();
}

async function onLogin(e) {
  e.preventDefault();
  $('loginBtn').disabled = true;
  $('loginMsg').textContent = '';
  const { data, error } = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('pw').value });
  $('loginBtn').disabled = false;
  $('pw').value = '';
  if (error) return showLogin('이메일 또는 비밀번호가 올바르지 않습니다');
  await enter(data.session);
}

// ---------- 데이터 ----------
async function fetchAll() {
  const out = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await sb.from('preorders').select('*').order('id').range(from, from + size - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < size) break;
  }
  return out;
}

async function load() {
  try {
    rows = await fetchAll();
  } catch (e) {
    console.error(e);
    alert('불러오기 실패: ' + e.message);
    return;
  }
  renderAll();
}

function renderAll() {
  renderKpis();
  renderCharts();
  renderRanking();
  renderRows();
}

const valid = () => rows.filter((r) => !r.is_invalid);

function renderKpis() {
  const v = valid();
  const today = kstDate(new Date().toISOString());
  const items = [
    ['유효 예약', v.length],
    ['무효 처리', rows.length - v.length],
    ['오늘 (KST)', v.filter((r) => kstDate(r.created_at) === today).length],
    ['ref 링크 경유', v.filter((r) => r.via_ref).length],
    ['추천인 입력', v.filter((r) => r.referrer).length],
    ['보상 지급 완료', v.filter((r) => r.reward_given).length],
  ];
  $('kpis').innerHTML = items.map(([k, n]) => `<div class="kpi"><span>${k}</span><b>${n.toLocaleString('ko-KR')}</b></div>`).join('');
}

function renderCharts() {
  if (!window.Chart) return;
  const v = valid();
  const Chart = window.Chart;
  Chart.defaults.color = '#a7a2d6';
  Chart.defaults.font.family = "'Galmuri11', sans-serif";
  Chart.defaults.borderColor = '#2c2860';

  const keys = Object.keys(SOURCES);
  const counts = keys.map((k) => v.filter((r) => r.source === k).length);
  const colors = ['#ff4d5a', '#25f4ee', '#5865f2', '#ffd23f', '#a7a2d6'];
  pie?.destroy();
  pie = new Chart($('pieChart'), {
    type: 'pie',
    data: { labels: keys.map((k) => SOURCES[k]), datasets: [{ data: counts, backgroundColor: colors, borderColor: '#000', borderWidth: 2 }] },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            label: (c) => {
              const sum = counts.reduce((a, b) => a + b, 0) || 1;
              return ` ${c.label}: ${c.raw}명 (${Math.round((c.raw / sum) * 100)}%)`;
            },
          },
        },
      },
    },
  });

  const byDay = {};
  v.forEach((r) => { const d = kstDate(r.created_at); byDay[d] = (byDay[d] ?? 0) + 1; });
  const days = Object.keys(byDay).sort();
  // 빈 날짜 채우기
  const filled = [];
  if (days.length) {
    for (let d = new Date(days[0] + 'T00:00:00Z'); d <= new Date(days[days.length - 1] + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
      filled.push(d.toISOString().slice(0, 10));
    }
  }
  bar?.destroy();
  bar = new Chart($('barChart'), {
    type: 'bar',
    data: { labels: filled.map((d) => d.slice(5)), datasets: [{ label: '예약 수', data: filled.map((d) => byDay[d] ?? 0), backgroundColor: '#4ade80', borderColor: '#000', borderWidth: 2 }] },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function promoterStats() {
  const v = valid();
  const byLower = new Map(rows.map((r) => [r.nickname_lower, r]));
  const map = new Map();
  for (const r of v) {
    if (!r.referrer_lower) continue;
    const self = byLower.get(r.referrer_lower);
    if (self?.is_invalid) continue; // 무효 처리된 홍보자는 제외 (공개 랭킹과 동일)
    const s = map.get(r.referrer_lower) ?? { name: self?.nickname ?? r.referrer, self, total: 0, ref: 0, manual: 0, last: '' };
    s.total++;
    r.via_ref ? s.ref++ : s.manual++;
    if (r.created_at > s.last) s.last = r.created_at;
    map.set(r.referrer_lower, s);
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.last.localeCompare(b.last));
}

function renderRanking() {
  const list = promoterStats();
  if (!list.length) {
    $('rankBody').innerHTML = '<tr><td colspan="7" class="muted">아직 없음</td></tr>';
    return;
  }
  $('rankBody').innerHTML = list.map((s, i) => `
    <tr>
      <td>${i === 0 ? '👑 1' : i + 1}</td>
      <td>${esc(s.name)}</td>
      <td><b>${s.total}</b></td>
      <td>${s.ref}</td>
      <td>${s.manual}</td>
      <td>${s.self ? '<span class="tag yes">예약함</span>' : '<span class="tag">미예약</span>'}</td>
      <td>${s.self ? `<input type="checkbox" data-top="${s.self.id}" ${s.self.top_reward_given ? 'checked' : ''} aria-label="1위 보상 지급">` : '<span class="muted">-</span>'}</td>
    </tr>`).join('');
}

function filtered() {
  const q = $('search').value.trim().toLowerCase();
  const showInvalid = $('showInvalid').checked;
  let list = rows.filter((r) => showInvalid || !r.is_invalid);
  if (q) {
    list = list.filter((r) => [r.nickname, r.referrer, r.source_etc, SOURCES[r.source]].some((x) => x && x.toLowerCase().includes(q)));
  }
  const { key, dir } = sort;
  const m = dir === 'asc' ? 1 : -1;
  return list.sort((a, b) => {
    let x = a[key], y = b[key];
    if (key === 'nickname' || key === 'referrer') { x = (x ?? '').toLowerCase(); y = (y ?? '').toLowerCase(); }
    if (key === 'source') { x = srcLabel(a); y = srcLabel(b); }
    if (x === y) return (a.id - b.id) * m;
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    return (x > y ? 1 : -1) * m;
  });
}

function renderRows() {
  const list = filtered();
  document.querySelectorAll('th[data-sort]').forEach((th) => {
    th.classList.toggle('asc', th.dataset.sort === sort.key && sort.dir === 'asc');
    th.classList.toggle('desc', th.dataset.sort === sort.key && sort.dir === 'desc');
  });
  $('rowsBody').innerHTML = list.map((r) => `
    <tr class="${r.is_invalid ? 'invalid' : ''}">
      <td>${r.id}</td>
      <td><b>${esc(r.nickname)}</b>${r.is_invalid ? ' <span class="tag bad">무효</span>' : ''}</td>
      <td>${esc(srcLabel(r))}</td>
      <td>${r.referrer ? esc(r.referrer) : '<span class="muted">-</span>'}</td>
      <td>${r.via_ref ? '<span class="tag yes">ref</span>' : '<span class="muted">-</span>'}</td>
      <td>${fmtTime(r.created_at)}</td>
      <td><input type="checkbox" data-reward="${r.id}" ${r.reward_given ? 'checked' : ''} aria-label="보상 지급"></td>
      <td class="act">
        <button class="btn btn-ghost btn-sm" data-invalid="${r.id}" type="button">${r.is_invalid ? '복구' : '무효'}</button>
        <button class="btn btn-danger btn-sm" data-del="${r.id}" type="button">삭제</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="8" class="muted">결과 없음</td></tr>';
  $('rowCount').textContent = `${list.length.toLocaleString('ko-KR')}건 표시 / 전체 ${rows.length.toLocaleString('ko-KR')}건`;
}

// ---------- 수정 ----------
async function patch(id, fields) {
  const { data, error } = await sb.from('preorders').update(fields).eq('id', id).select().single();
  if (error) { alert('저장 실패: ' + error.message); return false; }
  const i = rows.findIndex((r) => r.id === id);
  if (i >= 0) rows[i] = data;
  return true;
}

async function onTableClick(e) {
  const t = e.target;
  if (t.dataset.reward) {
    const ok = await patch(Number(t.dataset.reward), { reward_given: t.checked });
    if (!ok) t.checked = !t.checked; else renderKpis();
  } else if (t.dataset.top) {
    const ok = await patch(Number(t.dataset.top), { top_reward_given: t.checked });
    if (!ok) t.checked = !t.checked;
  } else if (t.dataset.invalid) {
    const id = Number(t.dataset.invalid);
    const r = rows.find((x) => x.id === id);
    if (await patch(id, { is_invalid: !r.is_invalid })) renderAll();
  } else if (t.dataset.del) {
    const id = Number(t.dataset.del);
    const r = rows.find((x) => x.id === id);
    if (!confirm(`'${r.nickname}' 예약을 완전히 삭제할까요? 되돌릴 수 없습니다.\n(랭킹·카운트에서만 빼려면 '무효'를 쓰세요)`)) return;
    const { error } = await sb.from('preorders').delete().eq('id', id);
    if (error) return alert('삭제 실패: ' + error.message);
    rows = rows.filter((x) => x.id !== id);
    renderAll();
  }
}

// ---------- CSV ----------
function downloadCsv() {
  const cell = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // 엑셀 수식 주입 방지
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['번호', '닉네임', '유입 경로', '기타 내용', '홍보자', 'ref 경유', '예약 시각(KST)', '무효', '보상 지급', '홍보 1위 보상 지급'];
  const lines = [...rows].sort((a, b) => a.id - b.id).map((r) => [
    r.id, r.nickname, SOURCES[r.source] ?? r.source, r.source_etc, r.referrer,
    r.via_ref ? 'Y' : 'N', fmtTime(r.created_at), r.is_invalid ? 'Y' : 'N', r.reward_given ? 'Y' : 'N', r.top_reward_given ? 'Y' : 'N',
  ].map(cell).join(','));
  const csv = '﻿' + [head.join(','), ...lines].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `pixelia_preorders_${kstDate(new Date().toISOString())}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- 시작 ----------
async function main() {
  if (!isConfigured()) { showLogin('config.js 에 Supabase 설정이 비어 있습니다'); return; }
  sb = await makeClient();

  $('loginForm').addEventListener('submit', onLogin);
  $('logoutBtn').addEventListener('click', async () => { await sb.auth.signOut(); rows = []; showLogin(); });
  $('refreshBtn').addEventListener('click', load);
  $('search').addEventListener('input', renderRows);
  $('showInvalid').addEventListener('change', renderRows);
  $('csvBtn').addEventListener('click', downloadCsv);
  $('rowsBody').addEventListener('click', onTableClick);
  $('rankBody').addEventListener('click', onTableClick);
  document.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
    const key = th.dataset.sort;
    sort = { key, dir: sort.key === key && sort.dir === 'desc' ? 'asc' : 'desc' };
    renderRows();
  }));

  const { data: { session } } = await sb.auth.getSession();
  if (session && !session.user.is_anonymous) await enter(session);
  else showLogin();
}

main();

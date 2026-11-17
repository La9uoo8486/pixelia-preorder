import { CONFIG, SOURCES, normNick, validNick, esc, isConfigured, makeClient, store } from './common.js';

const $ = (id) => document.getElementById(id);
const K_REF = 'pixelia_ref';        // 처음 들어온 추천인
const K_DONE = 'pixelia_reserved';  // { nickname }
const USE_CAPTCHA = !!CONFIG.TURNSTILE_SITE_KEY;

let sb = null;
let captchaToken = '';
let captchaId = null;

// ---------- 추천 링크 ----------
function initRef() {
  const url = new URL(location.href);
  const raw = url.searchParams.get('ref');
  if (raw !== null) {
    const nick = normNick(raw);
    if (validNick(nick) && !store.get(K_REF)) store.set(K_REF, nick);
    url.searchParams.delete('ref');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  return store.get(K_REF);
}
const myLink = (nick) => location.origin + location.pathname.replace(/[^/]*$/, '') + 'r/' + encodeURIComponent(nick);

// ---------- 카운트다운 ----------
function initCountdown() {
  const openAt = new Date(CONFIG.OPEN_AT).getTime();
  $('openDate').textContent = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(openAt) + ' (KST) 오픈';
  const cells = Object.fromEntries([...document.querySelectorAll('#countdown b')].map((b) => [b.dataset.u, b]));
  const tick = () => {
    let s = Math.max(0, Math.floor((openAt - Date.now()) / 1000));
    if (s === 0) {
      $('countdown').innerHTML = '<p class="open-now">🎉 서버 오픈! 지금 접속하세요</p>';
      clearInterval(t);
      return;
    }
    const d = Math.floor(s / 86400); s %= 86400;
    const h = Math.floor(s / 3600); s %= 3600;
    const m = Math.floor(s / 60);
    cells.d.textContent = d;
    cells.h.textContent = String(h).padStart(2, '0');
    cells.m.textContent = String(m).padStart(2, '0');
    cells.s.textContent = String(s % 60).padStart(2, '0');
  };
  const t = setInterval(tick, 1000);
  tick();
}

// ---------- 게이지 / 랭킹 ----------
function renderGauge(total) {
  const tiers = CONFIG.GOAL_TIERS;
  const max = tiers[tiers.length - 1].count;
  $('total').textContent = total.toLocaleString('ko-KR');
  $('gaugeFill').style.width = Math.min(100, (total / max) * 100) + '%';
  $('gaugeMarks').innerHTML = tiers.map((t) =>
    `<span class="mark ${total >= t.count ? 'on' : ''}" style="left:${(t.count / max) * 100}%"><i></i><em>${t.count}</em></span>`).join('');
  $('tiers').innerHTML = tiers.map((t) => `
    <li class="${total >= t.count ? 'on' : ''}">
      <span class="tier-n">${t.count}명</span>
      <span class="tier-r">${esc(t.reward)}</span>
      <span class="tier-s">${total >= t.count ? '달성!' : `${t.count - total}명 남음`}</span>
    </li>`).join('');
}

function renderRank(list) {
  if (!list.length) {
    $('rank').innerHTML = '<li class="empty">아직 랭킹이 없어요. 첫 1위가 되어보세요!</li>';
    return;
  }
  $('rank').innerHTML = list.map((r, i) => `
    <li class="${i === 0 ? 'first' : ''}">
      <span class="rk">${i === 0 ? '<span class="crown" aria-label="1위">👑</span>' : i + 1}</span>
      <span class="rn">${esc(r.nickname)}</span>
      <span class="rc">${r.count}명</span>
    </li>`).join('');
}

async function loadStats() {
  if (!sb) return;
  const { data, error } = await sb.rpc('preorder_stats');
  if (error) { console.error(error); return; }
  renderGauge(data.total ?? 0);
  renderRank(data.ranking ?? []);
}

// ---------- 완료 화면 ----------
function showDone(nick, pos) {
  $('formCard').hidden = true;
  $('doneCard').hidden = false;
  $('doneNick').textContent = nick;
  $('donePos').textContent = pos ? pos.toLocaleString('ko-KR') : '-';
  $('myLink').value = myLink(nick);
}

async function copyLink() {
  const v = $('myLink').value;
  try {
    await navigator.clipboard.writeText(v);
  } catch {
    $('myLink').select();
    document.execCommand('copy');
  }
  $('copyBtn').textContent = '복사됨!';
  setTimeout(() => { $('copyBtn').textContent = '복사'; }, 1500);
}

// ---------- 폼 ----------
function setHint(el, text, type = '') {
  el.textContent = text;
  el.className = 'hint' + (type ? ' ' + type : '');
}

function buildSources() {
  $('sources').innerHTML = Object.entries(SOURCES).map(([v, label]) =>
    `<label class="chip"><input type="radio" name="source" value="${v}"><span>${label}</span></label>`).join('');
  $('sources').addEventListener('change', () => {
    const isEtc = getSource() === 'other';
    $('etc').hidden = !isEtc;
    if (isEtc) $('etc').focus();
    setHint($('srcHint'), '');
  });
}
const getSource = () => document.querySelector('input[name=source]:checked')?.value ?? '';

let nickTimer;
function onNickInput() {
  clearTimeout(nickTimer);
  const nick = normNick($('nick').value);
  if (!nick) return setHint($('nickHint'), '영문·숫자·밑줄(_)·공백, 3~16자');
  if (!validNick(nick)) return setHint($('nickHint'), '영문·숫자·밑줄(_)·공백만, 3~16자로 입력해주세요', 'err');
  setHint($('nickHint'), '확인 중…');
  nickTimer = setTimeout(async () => {
    if (!sb) return;
    const { data, error } = await sb.rpc('preorder_position', { p_nickname: nick });
    if (normNick($('nick').value) !== nick) return;
    if (error) return setHint($('nickHint'), '');
    if (data) setHint($('nickHint'), '이미 사전예약된 닉네임이에요', 'err');
    else setHint($('nickHint'), '사용 가능한 닉네임이에요', 'ok');
  }, 400);
}

function loadTurnstile() {
  $('captcha').hidden = false;
  window.onTurnstileLoad = () => {
    captchaId = window.turnstile.render('#captcha', {
      sitekey: CONFIG.TURNSTILE_SITE_KEY,
      theme: 'dark',
      callback: (t) => { captchaToken = t; },
      'expired-callback': () => { captchaToken = ''; },
      'error-callback': () => { captchaToken = ''; },
    });
  };
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit';
  s.async = true;
  document.head.appendChild(s);
}
function resetCaptcha() {
  if (captchaId !== null && window.turnstile) window.turnstile.reset(captchaId);
  captchaToken = '';
}

async function insertDirect(row) {
  const { error } = await sb.from('preorders').insert(row);
  if (!error) return 'ok';
  if (error.code === '23505') return 'duplicate';
  if (error.code === '23514') return 'invalid';
  console.error(error);
  return 'error';
}

async function insertWithCaptcha(row) {
  try {
    const res = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/preorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: CONFIG.SUPABASE_ANON_KEY },
      body: JSON.stringify({ ...row, token: captchaToken }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return 'ok';
    return body.error || 'error';
  } catch (e) {
    console.error(e);
    return 'error';
  }
}

async function onSubmit(e) {
  e.preventDefault();
  const msg = $('formMsg');
  msg.textContent = '';
  const nickname = normNick($('nick').value);
  const source = getSource();
  const etc = $('etc').value.trim();
  const referrer = normNick($('ref').value);
  let bad = false;

  if (!validNick(nickname)) { setHint($('nickHint'), '영문·숫자·밑줄(_)·공백만, 3~16자로 입력해주세요', 'err'); bad = true; }
  if (!source) { setHint($('srcHint'), '유입 경로를 선택해주세요', 'err'); bad = true; }
  else if (source === 'other' && !etc) { setHint($('srcHint'), '기타 내용을 적어주세요', 'err'); bad = true; }
  if (referrer && !validNick(referrer)) { setHint($('refHint'), '추천인 닉네임 형식이 올바르지 않아요', 'err'); bad = true; }
  else if (referrer && referrer.toLowerCase() === nickname.toLowerCase()) { setHint($('refHint'), '본인 닉네임은 추천인으로 입력할 수 없어요', 'err'); bad = true; }
  else setHint($('refHint'), '');
  if (USE_CAPTCHA && !captchaToken) { msg.textContent = '캡차 확인을 완료해주세요'; bad = true; }
  if (bad) return;
  if (!sb) { msg.textContent = '서버 설정이 아직 안 되어 있어요'; return; }

  const stored = store.get(K_REF);
  const row = {
    nickname,
    source,
    source_etc: source === 'other' ? etc : null,
    referrer: referrer || null,
    via_ref: !!(referrer && stored && stored.toLowerCase() === referrer.toLowerCase()),
  };

  const btn = $('submitBtn');
  btn.disabled = true;
  btn.textContent = '예약 중…';
  const result = USE_CAPTCHA ? await insertWithCaptcha(row) : await insertDirect(row);
  btn.disabled = false;
  btn.textContent = '사전예약 하기';

  if (result === 'ok') {
    store.set(K_DONE, { nickname });
    const { data: pos } = await sb.rpc('preorder_position', { p_nickname: nickname });
    showDone(nickname, pos);
    loadStats();
    $('doneCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  resetCaptcha();
  msg.textContent = {
    duplicate: '이미 사전예약된 닉네임이에요. 본인이라면 걱정 마세요, 예약은 유지됩니다!',
    invalid: '입력값을 다시 확인해주세요',
    captcha: '캡차 확인에 실패했어요. 다시 시도해주세요',
  }[result] || '잠시 후 다시 시도해주세요';
  if (result === 'duplicate') setHint($('nickHint'), '이미 사전예약된 닉네임이에요', 'err');
}

function initForm(ref) {
  buildSources();
  if (ref) {
    $('ref').value = ref;
    document.querySelector('input[name=source][value=friend]').checked = true;
    $('refBadge').hidden = false;
    $('refBadge').innerHTML = `🔗 <b>${esc(ref)}</b> 님의 추천 링크로 오셨어요`;
  }
  $('nick').addEventListener('input', onNickInput);
  $('ref').addEventListener('input', () => setHint($('refHint'), ''));
  $('form').addEventListener('submit', onSubmit);
  if (USE_CAPTCHA) loadTurnstile();
  $('formCard').hidden = false;
}

// ---------- 시작 ----------
async function main() {
  const ref = initRef();
  initCountdown();
  renderGauge(0);
  $('topBanner').textContent = `홍보 랭킹 1위는 오픈 시 보상 추가 지급! (${CONFIG.TOP_PROMOTER_REWARD})`;
  $('discordBtn').href = CONFIG.DISCORD_URL;
  $('copyBtn').addEventListener('click', copyLink);

  if (isConfigured()) {
    try {
      sb = await makeClient({ auth: { persistSession: false, autoRefreshToken: false } });
    } catch (e) { console.error(e); }
  } else {
    $('setupWarn').hidden = false;
  }

  const done = store.get(K_DONE);
  if (done?.nickname && sb) {
    const { data: pos, error } = await sb.rpc('preorder_position', { p_nickname: done.nickname });
    if (!error && pos === null) store.del(K_DONE);   // 관리자가 삭제한 경우
    else showDone(done.nickname, pos);
  } else if (done?.nickname) {
    showDone(done.nickname, null);
  }
  if ($('doneCard').hidden) initForm(ref);

  loadStats();
  setInterval(() => { if (!document.hidden) loadStats(); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadStats(); });
}

main();

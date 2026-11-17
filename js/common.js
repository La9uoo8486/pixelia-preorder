import { CONFIG } from '../config.js';

export { CONFIG };

export const SOURCES = {
  youtube: '유튜브',
  tiktok: '틱톡',
  discord: '디스코드',
  friend: '친구 추천',
  other: '기타',
};

const NICK_RE = /^[A-Za-z0-9_ ]{3,16}$/;
// 앞뒤 공백 제거 + 연속 공백 하나로
export const normNick = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');
export const validNick = (s) => NICK_RE.test(s) && s === s.trim() && !s.includes('  ');

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

export const isConfigured = () => !!(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);

let mod;
export async function makeClient(options = {}) {
  mod ??= await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm');
  return mod.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, options);
}

// localStorage는 시크릿 모드 등에서 막힐 수 있음
export const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 무시 */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* 무시 */ } },
};

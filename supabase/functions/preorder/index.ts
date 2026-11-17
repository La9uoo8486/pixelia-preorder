// Pixelia pre-registration with Cloudflare Turnstile verification.
// Deploy only when TURNSTILE_SITE_KEY is set in config.js (README step 4).
// Secrets: TURNSTILE_SECRET_KEY (set by you). SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided automatically.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const NICK = /^[A-Za-z0-9_ ]{3,16}$/;
const SOURCES = ['youtube', 'tiktok', 'discord', 'friend', 'other'];
const validNick = (s: unknown) => typeof s === 'string' && NICK.test(s) && s === s.trim() && !s.includes('  ');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: 'invalid' }, 400); }

  // 1) captcha
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY');
  if (!secret) return json({ error: 'server_config' }, 500);
  const form = new URLSearchParams({ secret, response: String(b.token ?? '') });
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (ip) form.set('remoteip', ip);
  const verify = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form })
    .then((r) => r.json()).catch(() => ({ success: false }));
  if (!verify.success) return json({ error: 'captcha' }, 400);

  // 2) basic validation (DB check constraints are the final guard)
  const nickname = b.nickname, referrer = b.referrer ?? null, source = b.source;
  const source_etc = source === 'other' ? b.source_etc : null;
  if (!validNick(nickname) || !SOURCES.includes(String(source))) return json({ error: 'invalid' }, 400);
  if (referrer !== null && !validNick(referrer)) return json({ error: 'invalid' }, 400);

  // 3) insert with service role (bypasses RLS, server side only)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const { error } = await sb.from('preorders').insert({
    nickname, source, source_etc, referrer, via_ref: referrer !== null && b.via_ref === true,
  });
  if (error) {
    if (error.code === '23505') return json({ error: 'duplicate' }, 409);
    if (error.code === '23514') return json({ error: 'invalid' }, 400);
    return json({ error: 'db' }, 500);
  }
  const { data: position } = await sb.rpc('preorder_position', { p_nickname: nickname });
  return json({ ok: true, position });
});

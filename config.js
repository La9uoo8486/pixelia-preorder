// Pixelia 사전예약 설정
// anon/publishable 키는 공개용이라 여기 넣어도 됩니다.
// service_role/secret 키, 관리자 비밀번호, Turnstile 시크릿 키는 절대 넣지 마세요.
export const CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',

  // Cloudflare Turnstile 사이트 키. 비워두면 캡차 비활성 (README 4번 참고)
  TURNSTILE_SITE_KEY: '',

  DISCORD_URL: 'https://discord.gg/your-invite',

  // 오픈 시각 (KST)
  OPEN_AT: '2026-12-01T00:00:00+09:00',

  // 목표 단계 보상 (count 오름차순, 마지막 값이 게이지 최대치)
  GOAL_TIERS: [
    { count: 100, reward: '전원 몬스터볼 ×10' },
    { count: 300, reward: '전원 슈퍼볼 ×10 + 이상한사탕 ×3' },
    { count: 500, reward: '전원 한정 칭호 [개척자] + 마스터볼 ×1' },
  ],

  // 홍보 랭킹 1위 추가 보상
  TOP_PROMOTER_REWARD: '마스터볼 ×1 + 뽑기권 ×1',
};

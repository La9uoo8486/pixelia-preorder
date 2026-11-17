# Pixelia 포켓몬 서버 · 사전예약 사이트

마인크래프트 베드락 **Pixelia 포켓몬 서버** 사전예약 페이지. 빌드 없는 정적 사이트(HTML/CSS/JS) + Supabase.

## 기능
- **공개 페이지 (`index.html`)**: 닉네임 + 유입 경로(Q1) + 추천인(Q2) 사전예약, 오픈 카운트다운(2026-12-01 00:00 KST), 목표 게이지(100/300/500), 홍보 랭킹 TOP 10
- **추천 링크**: `?ref=닉네임` 과 `/r/닉네임` 둘 다 지원. 처음 들어온 추천인은 기기에 저장되어 새로고침해도 유지
- **완료 화면**: N번째 사전예약자, 내 추천 링크 복사, 디스코드 버튼
- **관리자 (`admin.html`)**: 예약자 표(검색·정렬), 유입 통계 그래프, 홍보자 랭킹(ref/직접 입력 분리), 무효·삭제, 보상 지급 체크, CSV 다운로드

## 폴더 구조
```
index.html, admin.html, 404.html     화면 (404.html 이 /r/닉네임 짧은 링크 처리)
config.js                            설정 (Supabase 주소·공개키, 디스코드, 보상 문구, 오픈 시각, 캡차 사이트 키)
css/style.css                        디자인
js/common.js, main.js, admin.js      스크립트
img/ball.svg                         픽셀 몬스터볼 아이콘
supabase/schema.sql                  테이블 · RLS · RPC 함수
supabase/functions/preorder/         캡차 검증용 Edge Function (Turnstile 쓸 때만)
```

---

## 1. Supabase 설정

1. https://supabase.com → **New project** (Region: Northeast Asia (Seoul)).
2. 왼쪽 **SQL Editor** → `supabase/schema.sql` 전체 붙여넣기 → **Run**.
3. 관리자 계정 만들기
   1. **Authentication → Users → Add user → Create new user** → 이메일·비밀번호 입력, **Auto Confirm User** 체크.
   2. SQL Editor에서 실행 (이메일만 바꾸기):
      ```sql
      insert into public.admins (user_id)
        select id from auth.users where email = '내이메일@example.com'
        on conflict do nothing;
      ```
   3. **Authentication → Sign In / Providers → Email** 에서 **Allow new users to sign up 끄기** 권장.
      (켜져 있어도 `admins` 테이블에 없는 계정은 아무것도 못 봅니다. 그래도 끄는 게 깔끔합니다.)
4. **Project Settings → API Keys** 에서 `Project URL` 과 **publishable(anon) 키**만 `config.js` 에 넣기.
   **secret / service_role 키는 절대 넣지 마세요.**
5. `config.js` 에서 `DISCORD_URL`, `GOAL_TIERS`(보상 문구), `TOP_PROMOTER_REWARD` 수정.

### 보안 구조 (schema.sql 이 하는 일)
| 대상 | 익명(방문자) | 관리자 |
|---|---|---|
| `preorders` INSERT | 닉네임·유입경로·기타·추천인·ref여부 컬럼만 | - |
| `preorders` SELECT / UPDATE / DELETE | 불가 | `admins` 에 등록된 계정만 (RLS) |
| `preorder_stats()` | 총 인원 + 랭킹 TOP 10 (닉네임·추천 수만) | |
| `preorder_position(닉네임)` | 몇 번째인지 (없으면 null → 중복 체크에도 사용) | |

- 닉네임 규칙(3~16자, 영문/숫자/밑줄/공백), 유입 경로 값, 기타 50자, 본인 추천 금지 등은 **DB check 제약**으로 서버에서도 검사합니다.
- 닉네임 중복은 소문자 변환 컬럼의 UNIQUE 인덱스로 막습니다 (`Steve` 와 `steve` 는 같은 사람).
- 방문자는 예약 시각·무효·지급 여부를 직접 넣을 수 없습니다 (컬럼 권한으로 차단).

## 2. GitHub Pages 배포
1. GitHub에서 새 저장소 생성 (예: `pixelia-preorder`, Public) → 이 폴더 내용 전체 push.
2. 저장소 **Settings → Pages** → Source: `Deploy from a branch`, Branch: `main` / `(root)` → Save.
3. 1~2분 뒤 `https://<아이디>.github.io/<저장소이름>/` 접속.
4. 관리자: `https://<아이디>.github.io/<저장소이름>/admin.html`
5. 추천 링크 확인: `https://<아이디>.github.io/<저장소이름>/r/테스트닉` → 메인으로 넘어가고 Q2에 `테스트닉`, Q1에 `친구 추천`이 선택돼 있으면 성공.

> `/r/닉네임` 은 GitHub Pages가 없는 경로에 `404.html` 을 보여주는 걸 이용합니다. 404.html 은 **사이트 루트**에 있어야 동작합니다.
> 이 방식이라 카톡·디스코드 링크 미리보기는 `?ref=` 링크보다 덜 예쁘게 나올 수 있습니다.

## 3. 테스트 순서
1. 메인에서 예약 → 완료 화면에 `1번째 사전예약자` 표시.
2. 새로고침해도 완료 화면 유지 (기기당 1회).
3. 다른 브라우저(시크릿 창)에서 같은 닉네임을 대소문자만 바꿔 입력 → "이미 사전예약된 닉네임" 표시.
4. 완료 화면의 내 링크로 다른 브라우저에서 예약 → 랭킹에 내 닉네임 1위.
5. admin.html 로그인 → 표·그래프·랭킹 확인, 무효 처리 시 공개 페이지 카운트·랭킹에서 빠지는지 확인.

## 4. (선택) Cloudflare Turnstile 캡차 켜기
캡차는 **서버에서 검증해야 의미가 있습니다.** 화면에만 붙이면 봇이 Supabase API를 직접 호출해서 우회합니다. 그래서 켤 때는 예약이 Edge Function을 거치도록 바뀝니다.

1. Cloudflare 대시보드 → **Turnstile → Add widget** → 도메인에 `<아이디>.github.io` 추가 → **Site Key / Secret Key** 발급.
2. Supabase **Edge Functions → Deploy a new function → Via Editor** → 이름 `preorder` → `supabase/functions/preorder/index.ts` 내용 붙여넣기 → Deploy.
   - CLI를 쓴다면: `supabase functions deploy preorder --no-verify-jwt`
3. 함수 설정에서 **Verify JWT (Enforce JWT verification) 끄기**. (새 publishable 키는 JWT가 아니라서 켜두면 401 납니다)
4. **Edge Functions → Secrets** 에 `TURNSTILE_SECRET_KEY` = 시크릿 키 추가. (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 는 자동 제공)
5. `config.js` 의 `TURNSTILE_SITE_KEY` 에 **사이트 키** 넣기. (시크릿 키는 절대 config.js 에 넣지 말 것)
6. SQL Editor에서 직접 INSERT 막기:
   ```sql
   revoke insert on public.preorders from anon, authenticated;
   ```
   되돌리기: `schema.sql` 맨 아래 주석의 grant 문 실행.

## 5. 로컬 실행
`index.html` 더블클릭은 안 됩니다 (모듈 로딩 막힘).
```
python -m http.server 8000     또는   npx serve .
```
`http://localhost:8000/r/닉네임` 짧은 링크는 로컬 서버에선 동작하지 않습니다 (`?ref=` 로 테스트).

## 알아둘 점
- **기기당 1회는 완벽하지 않습니다.** 브라우저 데이터 삭제·시크릿 창이면 다시 폼이 나옵니다. 대신 같은 닉네임은 DB에서 막히고, 가짜 닉네임으로 랭킹을 올리는 건 관리자 페이지에서 **무효** 처리하세요.
- 캡차를 안 켜면 봇이 대량으로 가짜 예약을 넣을 수 있습니다. 홍보 랭킹 보상이 걸려 있으니 오픈 전 랭킹 1위는 꼭 관리자 페이지에서 직접 확인하세요.
- 공개 페이지 숫자·랭킹은 20초마다 갱신됩니다.
- 랭킹 동점이면 해당 추천 수에 먼저 도달한 사람이 위입니다.
- 무효 처리된 사람이 홍보자이면 그 사람은 랭킹에서도 빠집니다.
- Supabase 무료 플랜은 1주일 동안 요청이 없으면 프로젝트가 일시정지됩니다 (대시보드에서 Restore).

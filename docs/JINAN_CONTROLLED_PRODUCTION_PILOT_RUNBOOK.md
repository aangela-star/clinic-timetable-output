# 晉安 CMS Controlled Production Pilot Runbook

## 0. Baseline

- implementation baseline：`52134b712527f1516d1b782a95aa5e1326ce3a22`
- deployment candidate：必須等於另行人工核准的 exact HEAD，且包含上述 ancestor。
- branch：`feat/jinan-cms-server-integration`
- canonical target：`https://clinic-timetable-output.vercel.app`
- public target：`https://www.tainanrehab.com/time.html`
- CMS target clinic：`clinic-1` / Jinan
- target selector：`/upload/115晉安門診表.png`
- target PNG：1080x1920 poster 以 `scale: 2` 產生的 2160x3840 PNG

## 1. 已驗證 Production 現況

- Vercel project：`clinic-timetable-output`
- GitHub source：`aangela-star/clinic-timetable-output`
- Production branch：`main`
- currently deployed commit：`f4534557b5efa83282e50161b41d1c99fefcef54`
- 2026-09-03 local/Vercel audit：Production only `CLINIC_SERVER_SECRET` listed；`JINAN_CMS_USERNAME`、`JINAN_CMS_PASSWORD`、`JINAN_CMS_PUBLISH_ENABLED` absent。

## 2. 唯一建議路線

Production deployment with gate OFF。

Preview deployments 不得放入 Production CMS credentials/gate，因為會產生另一個可修改 Production CMS 的 origin，且不是 canonical pilot surface。

人工 gated sequence：
1. push exact six commits from `origin/main` through the future docs/UI commit。
2. review/merge to `main`。
3. record the exact resulting HEAD after the local commit exists；that exact HEAD must be separately approved before Production pilot use。
4. Production deployment，且 `JINAN_CMS_PUBLISH_ENABLED` absent 或不是 exact `true`。
5. 在 canonical URL 做 non-mutating smoke。
6. 之後另行人工核准，才寫入 `JINAN_CMS_USERNAME`、`JINAN_CMS_PASSWORD`，並將 gate 設為 exact `true`；platform may redeploy。

本 runbook 不執行 push/merge/deploy/env/CMS。

## 3. Production Env Names

- existing required app session：`CLINIC_SERVER_SECRET`
- CMS credentials names only：`JINAN_CMS_USERNAME`、`JINAN_CMS_PASSWORD`
- gate：`JINAN_CMS_PUBLISH_ENABLED`
- 永不記錄或貼上 values。

## 4. PRE-PILOT Checklist

- [ ] approval record provides the exact approved deployment HEAD。
- [ ] current branch is exactly `feat/jinan-cms-server-integration`。
- [ ] current HEAD exactly matches the approved deployment HEAD。
- [ ] approved deployment HEAD contains implementation ancestor `52134b712527f1516d1b782a95aa5e1326ce3a22`。
- [ ] worktree is clean before pilot operations。
- [ ] required local tests and CI checks are exact green。
- [ ] Production deployment is READY at `https://clinic-timetable-output.vercel.app`。
- [ ] Production credential env names exist only when the separately approved gate-on step is reached：`JINAN_CMS_USERNAME`、`JINAN_CMS_PASSWORD`；check names only, never values。
- [ ] `JINAN_CMS_PUBLISH_ENABLED` remains absent or not exact `true` before separate gate-on approval。
- [ ] after separate gate-on approval, `JINAN_CMS_PUBLISH_ENABLED` is exact `true`。
- [ ] one authorized operator is assigned。
- [ ] exactly one browser tab/session is used for the publish attempt。
- [ ] target clinic is Jinan / `clinic-1`。
- [ ] target public page is `https://www.tainanrehab.com/time.html`。
- [ ] target image selector/path is `/upload/115晉安門診表.png`。
- [ ] target PNG is the approved 1080x1920 poster captured at `scale: 2` as a 2160x3840 PNG。
- [ ] medical content has explicit human approval。
- [ ] download the target PNG before publish and record SHA-256 outside the repo and outside logs；keep no secret values。

## 5. PILOT Steps

1. separate human approval 後，才設定 credentials + gate exact `true`。
2. 開啟 canonical generator。
3. authenticate app。
4. edit -> Preview。
5. primary clinic 選 Jinan。
6. download/check target PNG，確認 SHA-256。
7. Publish。
8. 只選 Jinan website。
9. confirm once。
10. wait result；never repeat click。

## 6. SUCCESS Checklist

- UI/server result：`PUBLISHED`。
- public `time.html` 只有一個 visible `img` references new validated `/upload` or `/uploads` path。
- image resource：GET 200 exact URL、no redirect、`image/png`。
- image dimensions：2160x3840。
- fetched image SHA-256 equals recorded target hash。
- no other CMS content / SEO hidden fields changed。

系統目前以 exact visible path 驗證 `PUBLISHED`；resource/hash/no-other-content checks 是 pilot human verification。

## 7. FAILURE Table

| Code | Safest action |
|---|---|
| `AUTH_REQUIRED` | STOP; re-authenticate the generator session; rerun the full PRE-PILOT checklist before any new publish attempt; no automatic retry. |
| `AUTH_FAILED` | STOP; check server-side env/login manually; rerun the full PRE-PILOT checklist before any new publish attempt; no automatic retry. |
| `FORM_CHANGED` | STOP; inspect CMS form drift; rerun the full PRE-PILOT checklist before any new publish attempt; no automatic retry. |
| `UPLOAD_FAILED` | STOP; check public page and CMS media manually because mutation outcome must be treated cautiously; no automatic retry. |
| `SUBMIT_FAILED` | STOP; check public page/editor manually; no automatic retry. |
| `VERIFY_FAILED` | STOP; check public page/image manually; no automatic retry. |
| `MANUAL_CHECK_REQUIRED` | STOP; manual public+CMS check; no automatic retry. |
| `PUBLISH_IN_PROGRESS` | STOP; wait for original only and do not click again; no automatic retry. |
| `CMS_RESPONSE_CONTRACT_UNVERIFIED` | STOP; gate/deployment/config check; no automatic retry. |
| `PUBLISH_FAILED` | STOP; capture safe code/attemptId only and investigate locally; no automatic retry. |

No unknown delete endpoint。

## 8. Abort Conditions

任一條件成立即 STOP：
- branch mismatch。
- exact approved deployment commit mismatch。
- approved deployment commit missing implementation ancestor `52134b712527f1516d1b782a95aa5e1326ce3a22`。
- worktree not clean。
- any local test failure。
- any CI test failure。
- any smoke test failure。
- required Production env missing at the separately approved gate-on pilot step。
- gate value not exactly expected OFF before activation。
- gate value not exact `true` after activation。
- CMS login abnormal。
- upload response status drift。
- upload response content-type drift。
- upload response callback drift。
- upload response path drift。
- submit response status is not 302。
- submit redirect does not contain unique `mesCode=1`。
- submit redirected page is not 200。
- public verification mismatch。
- wrong clinic image selector。
- unexpected CMS form structure。
- SEO field drift。
- hidden field drift。
- concurrent publish。
- `PUBLISH_IN_PROGRESS`。
- ambiguous response。
- `MANUAL_CHECK_REQUIRED`。
- secret leakage in frontend。
- secret leakage in response。
- secret leakage in log。
- unexpected Production change。
- noncanonical generator URL。
- noncanonical public URL。
- more than one operator。
- more than one browser tab。
- repeated click。
- unexpected redirect。
- unexpected status。
- unexpected content-type。
- unexpected image path。
- unexpected image hash。
- unexpected image dimensions。
- unexpected content drift。
- any CMS mutation before explicit gate-on approval。

## 9. Rollback Position

- deployment rollback：只在 human approval 後 promote previous known-good Vercel deployment。
- no CMS full rollback/delete。
- partial CMS success：視為 `MANUAL_CHECK_REQUIRED`；manual inspect public `time.html`、image URL GET、CMS editor image reference、media library；未核准前不得 mutation。

## 10. Structured Log

Allowed fields exactly：
`attemptId`, `stage`, `status`, `errorCode`, `finalImagePath`, `orphanUploadRisk`

Forbidden：
secret/raw fields, raw body, exception text, credentials, cookies, paths outside safe final image path, adapter fields。

## 11. Stop Boundary / Audit

本次準備作業不執行：
- push
- merge
- deploy
- env writes
- CMS access or mutation

Audit fields：branch、HEAD、changed files、tests、diff check、no secrets。

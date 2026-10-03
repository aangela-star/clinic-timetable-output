# 本機交付：待獨立審查，未部署

2026-10-03。唯一 writer：Codex。工作目錄：`/Users/iaiangela/Projects/clinic-timetable-image-delivery-20261003`。
Branch：`fix/timetable-image-delivery-20261003`。HEAD / intended base：`31a426a188d0af580e4442b0bb197d966198290a`。未 commit、push、PR、merge、部署或執行任何 live 操作。交付後停止，供 parent 獨立 review。

## 實際修改

- `apps-script/PublishStore.gs`：pointer/blob 讀取不再 insertSheet。缺 pointer 回傳既有 empty baseline（version 0 / etag empty / 固定 target）；缺 journal 的 blob 讀取回傳既有 STORE_UNAVAILABLE。已有資料照常讀取；存取失敗或 malformed JSON fail closed，不自動修復。public image GET 沿既有 handler 成為 404 / 空 body / no-store。鎖與既有錯誤邊界保留。
- `lib/publish-store-adapter.js`：沿用 prepare-validation 的窄化 Google ContentService protocol：POST manual redirect，僅接受 302/303 至 HTTPS `script.googleusercontent.com/macros/echo`，限一次無 body／secret／cookie／authorization 的 GET；拒絕其他主機、帳密、非標準 port、fragment、路徑、307/308、redirect chain。POST、response GET 與真實 fetch body 共用單一 25 秒 AbortSignal；不重試 writes。這是每個 transport operation 的 deadline，**不是整個多次 read/reconcile 流程的總 deadline**。未擴張 adapter 架構。
- `tests/publish_store_adapter.test.cjs`：RED→GREEN 缺兩表／缺任一表／兩表存在、讀取故障、malformed JSON、匿名 image GET→GAS VM 無資源建立測試；所有 mutation mocks 可強制 throw，並斷言沒有 mutation attempt。Drive read 在 harness 正確分類為 read。
- `tests/publish_provider.test.cjs`：使用 fake config、secret accessor、fetch 測精確 gate、建構失敗 503 / 零 upstream calls；下游 rejection、空 pointer、hash 錯誤 404；有效 bytes 200。公開錯誤仍無細節，不增加 diagnostic endpoint／logging／production classification 欄位。既有 flow-off 與無效 flow config 測試保留。
- `tests/publish_transport_redirect.test.cjs`：允許的 response redirect、拒絕矩陣、丟回應／超時／chain 不重送 POST、同一截止時間。
- `tests/timetable_image_fixture.test.cjs` 與本資料夾 `fixture/`：離線雙圖→一張上下合成海報候選。圖片路徑與月份 heading 來自交接報告，其餘結構／公告／booking link／SEO description 明確為 **synthetic reconstruction**，不是正式網站備份。整份 fixture SHA pin + exact group guard；月份、圖序、slot、公告、重複圖片或重複套用有任何漂移皆拒絕。未接受或修改 production target fingerprint。

## Fixture / diff

- `fixture/before.html`：合成的本機來源；兩圖 `/upload/未命名(1).png`、`/upload/未命名1.png`。
- `fixture/candidate.html`、`image-group.diff`：僅替換完整兩圖區塊；其他 bytes 不動。單圖 intrinsic 2160×3840，responsive 等比例顯示。
- `fixture/neutral-text-proposal.html`、`neutral-text-proposal.diff`：另列「醫師門診表」中性 heading/title/description 提案。**正式文字尚未批准**；實際 SEO 原文未提供，此 diff 僅示範，不可直接套用 CMS。
- `fixture/preview.html`：固定外部 src 改成本機 synthetic PNG，方便完全離線預覽；不是待發布版本。
- `fixture/synthetic-poster.png`：2160×3840、上下兩區、明示 SYNTHETIC／NO CLINIC FACTS。不是由產品實際 Preview→Download 生成，無醫師／時間／患者資料。workspace 無真實 PNG，未讀其他專案或下載 live 圖。

## 實際測試結果

Node v22.23.2；Python 3.14.7；無安裝依賴／無網路下載。

| Run | 結果 | 完整 log |
|---|---|---|
| RED 既有 source + 新 read cases | 5 tests：2 pass、3 fail（重現初始化） | `red-read.log` |
| 最終 targeted | 106 tests：105 pass、0 fail、1 skip | `green-targeted.log` |
| 最終完整 Node | 453 tests：452 pass、0 fail、1 skip | `node-full.log` |
| 全 Python | 8 tests，全部 pass | `python-full.log` |
| Desktop/mobile browser fixture | BLOCKED，沒有宣稱通過 | `browser.log` |

新增 deadline VM test 初次忘記注入 URL global，造成 STORE_UNAVAILABLE；已修正測試 harness，完整 suite 重跑通過。中間失敗原始 log 保存在 `interim-vm-harness-failure.log`，不是目前結果。

完整 suite 包含 CAS、多 caller、nonce/session、durable intent、重複 confirm、process death、dropped response、reconcile 不重送、獨立 ledger、Save/Load isolation、prepare validation、PNG/preview/printing 靜態契約。Apps Script transaction engine 與 Node engine byte-identical 測試通過。未修改合法 prepare/confirm/reconcile 初始化或 durable 寫入程式碼。

## 阻擋與未驗證

1. `localhost HTTP auth, save, prepare, confirm, public image, limits` 因 sandbox `listen EPERM 127.0.0.1` skip。實際 loopback HTTP acceptance 未驗證；VM／in-process 整合有通過。
2. 已使用現有 Playwright + cached Chromium 實際嘗試啟動；OS sandbox 拒絕 `bootstrap_check_in ... MachPortRendezvousServer ... Permission denied (1100)`，程序 SIGTRAP。因此 desktop/mobile fixture 的 decode、比例、overflow、截圖尚未執行。`browser.log` 有完整啟動失敗資訊。未變更 sandbox 或要求 escalation。也未執行依賴同一 Chromium 的既有產品 E2E；產品 CDN dependencies 本輪未下載。實際 Download/print browser 驗收仍待 parent 在允許環境補跑，靜態契約與 protected hash 不能替代它。
3. 缺當下正式完整 HTML、公告／booking href／SEO 原文與原圖，故 fixture 不能作正式 CMS exact diff／rollback 備份。正式內容與 CMS external src 持久保存驗收須另批准並取 fresh baseline；不得把 fixture pin 當 production fingerprint。
4. 未驗 live GAS 部署／schema、Vercel function source/env、公開 503 原因、首圖、延遲／quota、正式網站 layout。交接報告指出 current project flags 缺失，但 immutable deployment 的 source/env 未核證；本輪沒有新增 live 證據。gate 預設 off，未加入假 secret 或 default-enable。
5. public read 仍經 GAS pointer + blob/Drive；本候選不改 delivery 架構或快取，也不聲稱解決線上可用性／容量。

## 保護與 review

`protected-before.sha256` / `protected-after.sha256` 完全相同：index.html（含 PosterContent、handleDownload、1080×1920、scale 2）、auth、Save/Load、schedule API、Code.gs、Node transaction engine 均未改。沒有新增 route、服務、env 存取、secret、debug endpoint。未觸及 dirty manual worktree、Safari、其他專案、credentials、env/auth files、.pilot-private、CMS/GAS/Vercel/Google live endpoint。未 autoaccept target fingerprint。`git diff --check` 通過，diff 無整檔格式／line-ending noise。

**可交獨立 code review；尚非 production-ready 或完整 browser acceptance PASS。** merge、deployment、gate、initial PNG、CMS 修改仍需分別批准。本輪交付即停止。

## 可重跑命令（repository root；僅本機）

```sh
git branch --show-current
git rev-parse HEAD
git diff --check
git diff 31a426a188d0af580e4442b0bb197d966198290a -- apps-script/PublishStore.gs lib/publish-store-adapter.js tests/publish_provider.test.cjs tests/publish_store_adapter.test.cjs
shasum -a 256 -c docs/timetable-image-delivery-20261003/protected-before.sha256
node --require ./docs/timetable-image-delivery-20261003/local-network-only.cjs --test tests/*.test.cjs
python3 -B -m unittest discover -s tests -p 'test_*.py' -v
node docs/timetable-image-delivery-20261003/browser-fixture.cjs /Users/iaiangela/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules
```

最後一條由 parent 在可啟動 Chromium 的本機環境補跑；只 file:// preview，HTTP(S) 全攔截，不觸及 live URL。第一個 loopback skip 可在允許 localhost listener 的環境以同一 Node suite 補驗。既有 `tests/e2e/publish_local.mjs` 需要 local mock server + 可用 frontend dependencies；本報告沒有聲稱該流程通過。

`source.patch` 含 tracked 修改及新增測試／fixture helper；`changed-files.txt`、`artifact-manifest.sha256` 列出交付檔案與 hashes（manifest 本身除外）。

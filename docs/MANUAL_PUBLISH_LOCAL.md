# 目前狀態：五個手動入口（本機移植，待獨立審查）

此節取代下方歷史段落的「兩個 FB 未知／四個入口」描述；下方保留原始驗證與操作來源，不當作本輪測試結果。

- 基底：已由 secretary 記錄為 live source 的 `1f465c900dbd94c77ab8930cc25cff9d8d221057`，不是較新的 main。獨立 worktree：`feat/timetable-manual-links`；未部署。
- 晉安官網、毅安官網、晉安 FB、毅安 FB、FarBar 共五張卡；只有毅安 FB URL 未確認，維持 null／停用。晉安 FB 為使用者確認的 `https://www.facebook.com/tainanrehab`。
- FarBar 精確入口：`https://w3.farbar.ai/channels/channel30/cms31/editChannel.php?chcode=rG2vq&cntcode=NVJkF&`。標籤「頻道管理入口」，先確認「台南毅安／門診時間」；上傳／儲存流程尚未驗證，未確認前不上傳、不儲存。無已確認公開網址，需人工核對實際／頻道顯示。
- FB 新增貼文或更換既有相片尚未確認。既有新增貼文文字保留為條件式草稿，不代表使用者已選定此操作。
- 晉安官網手冊是歷史成功操作來源，當次仍須核對頁面／目標與授權；毅安內部換圖流程仍未驗證。下方四圖敘述是當時觀察，不是本輪線上讀取。
- 顯示既有優先診所、monthKey 與海報標題，唯讀 props，不新增業務狀態、不自動切換診所；只使用原有預覽／PNG 下載按鈕。無發布完成核取框／成功狀態、API、儲存或上傳行為。
- 五張卡預設收合手冊；沿用已遮除登入資料的五張圖，不新增原始登入圖片。
- 新回歸：`node --test tests/manual_publish_links.test.cjs`；`node tests/manual_publish_links.browser.cjs`（既有 Playwright／離線資產路徑見腳本環境參數）。包含真實下載前後比較、desktop/iPad/phone、延遲／載入／渲染錯誤隔離，以及攔截的 Save/Load fixture。實際本輪結果在 `.local/manual-links/README.md`、`results.json`，不是下方歷史數字。

---

## 以下為唯讀來源複製的歷史工程紀錄

# 手動發布（本機功能）

本次只在 `index.html` 的既有 PNG 下載與發布控制下方掛載獨立的 `manual-publish.mjs`。四個入口各有原生 `details` / `summary` 操作手冊；連結以新分頁開啟，使用 `noopener noreferrer`。未確認網址使用停用按鈕，不以 `#`、推測路徑或通用平台網址代替。

本區不呼叫 API、不使用瀏覽器儲存、不傳送圖片、不記錄發布成功，也不啟動既有發布整合。既有「發布」按鈕及其流程保持原樣。本機變更不代表已核准合併或部署。

## 網址與手冊依據

| 入口 | 網址狀態 | 依據／缺口 |
| --- | --- | --- |
| 晉安官網後台 | `https://www.tainanrehab.com/admin/index.php?op=time&sub=set` | `JINAN_CONTROLLED_PRODUCTION_PILOT_RUNBOOK.md` 第 53–77 行的既有成功流程 |
| 晉安公開門診表（手冊內） | `https://www.tainanrehab.com/time.html` | 同上，用於人工公開確認 |
| 毅安官網後台 | `https://www.ian-tainan.com/admin/login.php` | 後台登入URL：使用者提供；內部換圖流程/截圖：待確認 |
| 毅安公開門診表（手冊內） | `https://www.ian-tainan.com/time.html` | 父方已匿名驗證官方首頁 `time.html` 連結，HTTP 200，用於人工公開驗收 |
| 晉安 FB 粉專 | 待確認，停用 | 等待使用者提供專屬頁；管理介面未驗證 |
| 毅安 FB 粉專 | 待確認，停用 | 等待使用者提供專屬頁；管理介面未驗證 |

父方已驗證毅安官方首頁 `https://www.ian-tainan.com/` 的 `href="time.html"` 解析為上述公開驗收頁，HTTP 200；標題為「毅安診所 & 晉安復健科診所 115年9月醫師門診表」，頁面標題「門診時間表」。本輪採用此驗證結果，未重發外部請求。公開頁不是後台。毅安後台登入URL：使用者提供，現已另設安全新分頁連結；內部換圖流程/截圖：待確認。未連線驗證後台，不授權自動登入、上傳或送出；兩個 FB URL 仍為 `null`。

已確認四張內容圖：`/upload/115毅安門診表.png`、`/upload/115晉安門診表.png`、`/upload/115門診異動表(5).png`、`/upload/115週六門診表.png`。先確認主管指定更新哪張，保留其他圖，不用單一 PNG 覆蓋整頁多圖。

晉安手冊依據已驗證的操作：單擊既有圖片、工具列影像屬性、單次上傳核准 PNG、保留既有顯示設定、影像「確定」只套用編輯器、在「訊息確認」標題下方按真正「送出」一次、公開核對；不明結果停止且不重送。675 × 1200 是晉安既有顯示尺寸，不是重新縮圖指令或通用要求。圖片 URL、hash 與完整還原備份僅放在同事手冊的管理員進階備註。毅安明確標為準備與驗收草稿，後台流程未知；公開驗收網址已確認。FB 手冊與連結原樣保留。

同事用文件：[官網門診表操作手冊](官網門診表操作手冊.md)。本檔僅記錄工程背景與驗證方式。

## 本機驗證

新 Node 測試：`node --test tests/manual_publish.test.cjs`。

瀏覽器驗證：`MANUAL_PUBLISH_PLAYWRIGHT=/absolute/path/to/playwright MANUAL_PUBLISH_DEPS=/absolute/path/to/dependencies node tests/manual_publish.browser.cjs`。依賴目錄須有 `react.js`、`react-dom.js`、`babel.js`、`tailwind.js`、`html2canvas.js`、`lucide.js`，版本對應 `index.html` 中已釘選的版本。

測試自行啟停僅綁定 loopback 的白名單靜態伺服器，啟動全新 headless Chromium context，不使用使用者 Chrome、密碼、cookie 或既有儲存狀態。登入只在測試模組回應替身中模擬；所有非本機請求被攔截，CDN JS 由本機檔案替代，API 由本機回應替身處理。測試不操作既有發布按鈕或 prepare / confirm。字型網路請求被封鎖，截圖使用本機備援字型。

證據預設寫到 `/private/tmp/clinic-manual-publish-evidence`，不加入版本控制。需執行完整既有 Node 與 Python suites 並檢查相對指定基底的 diff，再交獨立唯讀審查。

## 可選手冊失敗隔離

手動發布區內的 error boundary 隔離模組載入與元件渲染失敗，僅替換手冊區為繁體中文狀態提示；原編輯器及未儲存輸入保留，不執行發布。Suspense 繼續處理載入中狀態。

失敗路徑重現（使用上述相同 Playwright 與快取依賴環境變數）：`node tests/manual_publish_failure.browser.cjs`。全新 headless fixture 先延遲模組回應、輸入未儲存文字，再分別阻擋模組請求及回傳會拋出渲染錯誤的測試元件。斷言原 input 節點仍連接、值保留、可繼續編輯、預覽更新、實際 PNG 下載為 2160 × 3840，並保存 fallback 截圖及 PNG。未修改既有成功路徑測試。RED / GREEN 記錄與初始獨立審查保留在證據目錄；本機測試成功不代表獨立審查通過。

## 官網手冊續作驗證（2026-09-10）

本輪僅修改 `manual-publish.mjs` 的兩組官網 `steps` 文字、同事 Markdown、本工程說明及必要內容測試。`index.html`、FB 步驟／呈現／空連結、所有其他功能與失敗隔離均與進場狀態相同。

新增小幅內容回歸測試先 RED 再 GREEN；原測試只移除要求「衍生圖」術語的斷言，改由新增測試禁止同事畫面出現 URL/hash 等管理員術語，並保留所有其他既有斷言。獨立 Markdown 測試檢查尺寸語意、流程順序、草稿狀態與停止表格。

本輪證據獨立保存在 `/private/tmp/clinic-manual-publish-evidence/website-guide/20260910-152359`，包含 ENTRY 快照、完整差異、歷史 sandbox 失敗日誌、實際補驗日誌、新版截圖／PNG 與交接。兩個瀏覽器腳本均須設定 `MANUAL_PUBLISH_EVIDENCE` 指向該新目錄，`MANUAL_PUBLISH_DEPS` 指向既有 `/private/tmp/clinic-manual-publish-evidence/dependencies`。本輪未執行線上操作；需待下一位獨立審查者審查，不宣稱獨立審查通過。

歷史 sandbox 結果原樣保留：Node 423 通過、1 項 localhost 跳過；瀏覽器遭 loopback EPERM／MachPort 權限拒絕。2026-09-10 於允許本機執行的環境使用原腳本及快取依賴補驗：Node 424/424 通過、0 跳過（含 localhost HTTP 測試），Python 8/8 通過，正常桌面／行動版及模組載入／渲染失敗瀏覽器測試全數通過。已產生並由 writer 檢視兩官網桌面／行動版手冊截圖、兩種失敗提示截圖及三張實際 2160 × 3840 PNG。詳見證據目錄的 `rerun-report.md`、`browser-rerun.log`、`failure-browser-rerun.log`、`node-rerun.log`、`python-rerun.log`。測試前後全部 67 個來源檔 hash 相同；補驗後僅更新本工程文件的證據文字。保護區檢查通過；未執行外部網路存取或平台操作。實體列印、實體手機、真實登入／CMS／發布及毅安未知流程未驗證；下一步為全新獨立唯讀審查，尚未執行。


## 毅安公開驗收連結續作（2026-09-10）

本輪新增毅安公開驗收連結與診所專屬 `publicLabel`、四圖保留提醒，更新兩份文件及相關手冊測試。`index.html` 完全保留進場內容；FB 兩組文字與空連結不變。毅安後台仍停用，草稿待確認。新的基準、增量差異、本機測試與截圖證據見 `/private/tmp/clinic-manual-publish-evidence/website-guide/20260910-153409-yi-an-public`。獨立唯讀審查由 orchestrator 後續安排，本輪未執行。

本輪 Node suite：425 項，424 通過、0 失敗、1 項 localhost 權限跳過；Python 8/8 通過。已沿用瀏覽器 harness 加入 `MANUAL_PUBLISH_YIAN_ONLY=1` 精簡驗證模式，但執行遭 sandbox `listen EPERM 127.0.0.1` 阻擋，尚無本輪瀏覽器通過結果或新版截圖；`browser-report.json` 如實記錄阻擋。需在允許本機 loopback／Chromium 的環境補驗，不能以先前截圖取代。

## 真實截圖圖解續作（2026-09-10）

本輪由唯一 writer 接手 `codex/manual-publish-local`，HEAD `31a426a188d0af580e4442b0bb197d966198290a`，保留進場所有未提交內容。僅在 `manual-publish.mjs` 晉安展開手冊新增實圖區與本機圖片放大連結；`index.html`、毅安原文字與四圖提醒、FB 兩個空連結及步驟均保留進場版本。

交付：[Markdown](官網門診表操作手冊.md)、[可離線另存／列印 HTML](官網門診表操作手冊.html)、[本機產製程式](build_website_guide.py) 及 `assets/website-guide/01-login.png` 至 `05-confirm.png`。四張供應的 CMS 原圖產生五張圖解，影像視窗使用兩次。登入圖在任何輸出前先將原座標 x239–378、y284–335（含邊界）兩欄完整覆白；所有輸出為無 metadata 的 RGB PNG。原登入圖不放入工作樹或證據，不 OCR、不轉錄帳號或密碼。

側欄取中下段並放大，子項加框；編輯器先單擊下方圖片、再點第三行左側影像圖示；不雙擊或修改其他欄位／SEO。圖解保留按鈕文字，明確說明示例月份每次需重新核對、局部預覽不是原圖裁切證據、`upload/source.png` 不可當固定網址手填。上傳內容／選檔／上傳至伺服器與整頁底部送出沒有提供截圖，兩處明列「缺圖待補」，未製作假 CMS 介面。影像確定只套用編輯器，整頁送出才是發布。

離線 HTML 由同一份 Markdown 產生，內嵌五張 PNG，沒有外部字型、腳本或資產，CSP 禁止自動網路載入；外部操作連結僅供人員主動使用。含手機 viewport（未禁止縮放）、自適應圖片及列印樣式。這些是實作與靜態驗證結果；本輪瀏覽器執行受阻，尚未完成實際手機版溢出或列印呈現驗證。

### 重現

使用已存在的 Pillow Python（本環境為 `/Users/iaiangela/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3`），不需安裝：

```sh
python3 docs/build_website_guide.py --originals /path/to/supplied/images
# 沒有原圖也能使用已去識別資產重建離線 HTML：
python3 docs/build_website_guide.py
node --test tests/*.test.cjs
python3 -m unittest discover -s tests -p 'test_*.py'
```

影像標註使用 macOS 既有 `/System/Library/Fonts/STHeiti Medium.ttc`。`--originals` 只接受這四張已授權原圖所在資料夾；不要把原登入圖移入專案。檔案白名單與固定裁切座標在產製程式中，可重現產出；不讀任何登入設定或密碼檔。

瀏覽器沿用前述 `MANUAL_PUBLISH_PLAYWRIGHT`、`MANUAL_PUBLISH_DEPS` 及新 `MANUAL_PUBLISH_EVIDENCE`，執行：

```sh
node tests/manual_publish.browser.cjs
node tests/manual_publish_failure.browser.cjs
node tests/manual_publish_illustrated.browser.cjs
```

前兩者使用既有網路隔離 fixture；新增圖解腳本以全攔截本機來源代替 listener，再以 `file://` 與 offline context 打開真正自包含 HTML，檢查圖片解碼、放大、安全 opener、手機 overflow、圖片失敗時文字保留、離線與列印樣式並拍攝證據。全程使用新 headless profile，沒有使用使用者 Chrome 或登入 CMS。瀏覽器錯誤均寫入報告，未成功時不產生通過宣稱。

本輪證據：`/private/tmp/clinic-manual-publish-evidence/website-guide/20260910-194952-illustrated/`。Node 429 項：428 通過、0 失敗、1 項 localhost 權限跳過；Python 12/12 通過（既有 8 加圖解 4）。登入遮罩每個像素、內嵌與本機 PNG 相同、無 metadata、路徑、缺圖標示、可重現 HTML 均已驗證。happy／failure 瀏覽器測試遭 `listen EPERM 127.0.0.1`；不需 listener 的圖解測試仍遭 Chromium `bootstrap_check_in ... MachPortRendezvousServer: Permission denied (1100)` 阻擋。因此沒有本輪 desktop/mobile/offline 瀏覽器截圖，也沒有新的實際 PNG 下載結果；不得沿用舊截圖冒充本輪證據。writer 已以圖片檢視器檢視四張來源（登入僅看覆白後版本）及五張圖解。

受保護檔案與進場狀態逐檔 hash 比對，細節見證據 `protected-state-report.json`；全部實作差異見 `incremental.diff`。本輪沒有提交、推送、部署、外部平台修改。交付供後續獨立 Codex reviewer 審查；本輪未執行新的獨立審查。須在允許 loopback 與 Chromium 的本機環境補跑上述三個瀏覽器腳本後，才有完整視覺驗收證據。


### 圖解本機補驗完成（2026-09-10，順序 writer 交接）

前一 writer 已退出後，本輪僅接手本機補驗。原 sandbox 失敗日誌與報告完整保留；新證據位於同目錄 `verification-complete/`，不得混同歷史結果。

原封不動執行三個實際 browser scripts，全新 headless Chromium、快取 CDN fixture、所有非本機網路請求攔截：happy、load/render failure、illustrated 全數 PASS。桌面 1440 × 1000 與手機 viewport 390 × 844 的五張圖片皆成功解碼，圖解／離線 HTML 無水平溢出；放大圖新分頁 opener 為 null；圖片請求失敗後步驟與缺圖提醒保留。真正 `file://` HTML 在 offline context 成功載入五張內嵌圖，桌面／手機 print media 截圖完成。writer 已檢視桌面／手機圖解、離線、列印樣式及手機缺圖截圖。正常與兩種失敗路徑共下載三張實際 2160 × 3840 PNG；未儲存輸入與後續編輯／預覽均通過。

完整 Node 429/429 通過、0 失敗、0 跳過（含 localhost HTTP）；Python 12/12 通過。無需修正測試、產品或手冊 HTML，也未重新產製圖片。測試前後 77 個進場檔案 hash 全同；原 writer 的 62 個受保護檔案仍完全相同，包括 `index.html`。本輪工作樹僅附加本工程文件的驗證結果；證據與 HANDOFF 另行更新。`git diff --check` 通過，沒有新增秘密、debug endpoint 或格式／換行雜訊。

詳見 `verification-complete/verification-complete-report.md` 與三份 browser JSON、Node/Python logs、`protected-state-report.json`。列印驗證為 headless print CSS 呈現，未驗證實體列印或分頁印表機輸出；未測真實手機觸控縮放、CMS 登入／發布。沒有安裝、外部平台操作、commit、push 或 deploy。待下一位全新唯讀 reviewer 審查，尚不宣稱獨立審查通過。


### 毅安後台連結本機更新（2026-09-10）

使用者提供 `https://www.ian-tainan.com/admin/login.php`，本輪僅啟用既有後台按鈕，使用 `target="_blank" rel="noopener noreferrer"`。後台登入URL：使用者提供；內部換圖流程/截圖：待確認。先前「後台停用」紀錄為歷史狀態。公開驗收頁與四圖提醒不變，未授權或執行自動登入、上傳、送出。證據：`/private/tmp/clinic-manual-publish-evidence/website-guide/20260910-200332-yian-backend`；後續獨立唯讀審查尚待執行。

最終本機驗證（取代本節先前 sandbox 受阻狀態）：受影響 Node 9/9、Python 4/4；完整 Node 429/429（0 失敗、0 跳過）、Python 12/12 通過。三組瀏覽器 suite 全數通過，涵蓋桌面／手機、模組載入與渲染失敗、實際 2160 × 3840 PNG、五張內嵌圖、離線 HTML 與 print media。

唯讀審查指出離線手冊的毅安後台 anchor 缺少安全新分頁屬性（P2）。最小修正僅讓 builder 對使用者提供的精確後台 URL 加上 `target="_blank" rel="noopener noreferrer"`，重建 HTML；晉安連結與指示不變。Python 斷言與真實瀏覽器已覆蓋生成手冊連結：offline `file://` 原頁保留，桌面／手機各開啟完全攔截的本機 popup 回應，`window.opener` 為 null。連同 app 按鈕，共四次攔截 backend GET，沒有向外轉送請求。保留五張相同 PNG、index/auth/PNG/SaveLoad/API/gates 與 FB 連結／手冊。

最終證據：`/private/tmp/clinic-manual-publish-evidence/website-guide/20260910-200332-yian-backend/final-fix/`，包含 finding 原文摘要、解析結果、commands／logs、31 張新 PNG、前後快照／hash、相對前一最終狀態及原始 before 基準的 diff。未 commit／push／deploy，未登入／上傳／送出或使用使用者 Chrome。內部 CMS 流程及實體列印仍未驗證；待另一位全新唯讀 reviewer 審查，不宣稱審查通過。

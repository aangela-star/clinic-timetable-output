# 首次受控 page-src pilot：耐久安全與 runbook

Status: **BLOCKED — NOT APPROVED FOR PRODUCTION**

本次只有 local/mock、公開 GET 與本機備份。未 deploy、未寫 Google Sheet、未設 Script Property、未寫 CMS。這份文件有明確未填項，不能當成已完成的 exact execution manifest。

## 2026-09-06 唯讀新證據

- target page: https://www.tainanrehab.com/time.html
- 觀察時間：2026-09-06T12:06:38Z。
- 原先 photo_2026-09-02 23_08_57(1).jpeg 已不在公開頁引用中。不能繼續把它當作下次 restore baseline。
- 目前候選 target（待 Angela 確認）：

```html
<img alt="" src="/upload/115-九月_醫師門診表.png" style="width: 675px; height: 1200px;" />
```

- original src: `/upload/115-九月_醫師門診表.png`
- original style: `width: 675px; height: 1200px;`；無 width/height HTML attributes。
- original bytes: 294043；MIME image/png。
- original SHA-256: `d355fe7c32210c9a8e0e20af308b1fecabb9178a3d2c1e61a77dda5dcd1f0f80`
- public baseline SHA-256: `1e1d6d83cd9043f8f95380bef8229311913bb362e841e965d0e6136d34284567`
- 本機人工可取回備份：`.pilot-private/20260906T120638Z/` 下的 `manifest.json`、`public.html`、`original-image.png`。目录 0700、檔案 0600、寫後回讀 byte equality，已 gitignore；不在 `/tmp`、不提交 Git。這是現況證據備份，未包含 authenticated editor note，不能代替正式 mutation 前的完整備份。
- new PNG source / SHA-256：**未指定，不得以目前公開圖、mock fixture 或 AI 生成內容代替。**
- 人工成功 change → verify → restore → verify，以及「影像屬性」才改 img src、「超連結」只改 a href，仍是正式行為依據；不是對本次寫入的授權。

## 已選儲存方案及尚未啟用的部分

優先使用現有綁定 Google Sheet + Apps Script，不新增 SaaS/Database/帳號。新 `PilotState.gs` 由現有 `doPost` 經 server secret 驗證後分流；另需 `JINAN_PILOT_STATE_ENABLED=true` 才可讀寫。原月表 Save/Load 及 schema 不變。

- `JinanPilotBackup` 是同一 Spreadsheet 的新工作表，最多接受 2,000,000 字元 backup JSON，base64 分成每列 30,000 字元。超限停止、不轉到新儲存服務。JSON 包含原 src/style/完整 img、原 note、公網 HTML、原圖 URL/base64 bytes/MIME/SHA-256。不得備份 CMS credentials、cookies 或完整 authenticated editor form。
- 每段含 attempt ID/index，原 JSON SHA-256 存於 Script Properties；寫後 flush/讀回 hash，Node 再經 backup API 回讀完全一致才可繼續。server 也核對原圖 bytes hash。人工可在現有 Sheet 取回 chunks（按 index 串接、base64 decode），或在授權 server-side 工具用 `recover(attemptId)` 匯出；輸出不得放 public route/log。
- `JINAN_PILOT_STATE_V1` 保存單一 target 的 reservation/phase、attempt ID、原 backup SHA、new PNG SHA、new image path 與備份列位置。所有讀寫均在 ScriptLock 中；備份建立前先記 PREPARING，中斷不會失去 reservation。
- 狀態依次：PREPARING → PREPARED → UPLOAD_DISPATCHED → UPLOADED → SUBMIT_DISPATCHED → VERIFIED。所有 dispatch 都要先收到持久化成功 acknowledgement；expected-phase CAS + attempt ownership 不符即拒絕。網路回應遺失即便實際尚未傳 CMS 也保守視為可能已送出。
- 沒有 TTL、lease、自動 reset、delete、reclaim。另一個 instance/restart 見任何既有 state 都不能再寫 CMS（包括 VERIFIED）；只允許人工 reconciliation。這是單次 pilot，不是可重複運作的 queue。
- mutation dispatch 前再次讀回備份 hash；資料損壞阻止 upload/submit。狀態服務失聯在 CMS login/upload 前停止。
- store 是 injected server-only capability。mock integration 驗證跨 runtime backing services；不是已部署 live 測試。正式 wiring 必須強制提供此 store，禁止沿用 optional/process-local-only mock 配置、禁止任何第二個無 store 的 writer。
- **啟用先決 gate**：部署含 `PilotState.gs` 的 Apps Script version、設定 feature property、確認綁定 Sheet/容量/既有 ACL、允許新增備份 rows/properties，均是 Production 設定／寫入；目前指示禁止，故未執行。Vercel 正式 page-src wiring 也未切換。不能宣稱下一步已經只剩 CMS overwrite approval。

## Exact runbook 待填 manifest

執行前必須凍結：受批准的 commit、Apps Script version／endpoint、確認後 target 完整 tag、fresh authenticated note SHA、公網 baseline/原圖 hash、人工確認的新 PNG 絕對路徑及 SHA-256/2160×3840、attempt UUID、Sheet backup receipt、操作員與排他時段。以上欄位缺一即 STOP。新 URL 由一次 upload 回應決定，但必須限定同站 `/upload/*.png`、不同於原 URL；不得跟隨任意 redirect。

## 精確執行順序（全部須先批准，這次不執行）

1. 停用其他 CMS writers；確認 snapshot/新 PNG/target 獲授權。原門診產生器的 Preview、capture dimensions 不改。確認 store read=null；任何舊 state 均停止，不用新 UUID 繞過。
2. 匿名 GET time.html；登入後 GET `/admin/index.php?op=time&sub=set`；原 note 與公開 baseline 一致，目標 tag 唯一且可見。匿名 GET 原圖保存 bytes，和 manifest 核對。
3. `prepare` 在既有 Sheet 保存完整備份，取得 PREPARED，並透過 backup read 回讀驗證；任何不確定都不能進 mutation。
4. `advance(PREPARED, UPLOAD_DISPATCHED)` 成功後，既有 QuickUpload POST 一次，PNG bytes 來自已確認 source；回應 URL 取得後存 UPLOADED。未知回應停止、不重傳。
5. 匿名 GET 新 PNG：HTTP 200、無 redirect、MIME image/png、有效 2160×3840 PNG、SHA-256 相同；CMS resize/re-encode 一律 STOP。再 GET public/editor，任意 note/public drift STOP；fresh SEO/hidden fields 保留。
6. 建立 plan：只改目標 img 的 src 及 `width:auto;max-width:100%;height:auto`，其餘 HTML/a href 保持。保存 rollback plan（server-side），`advance(UPLOADED,SUBMIT_DISPATCHED)` 成功才送 form 一次。
7. Submit：POST multipart/form-data 到 editor URL，mode=edit、完整 new note、fresh wtitle/wkeyword/wdescription、fresh hidden fields、Submit=送出。不是雙擊／超連結、不按區塊文字「訊息確認」。不改 time.html 檔案本身。
8. 不以 302/mesCode/200/提示判成功。匿名 no-cache/no-store GET time.html，確認 new note 一次且圖可見，再 GET 圖驗證 MIME/有效 PNG/SHA-256。通過後持久化 VERIFIED acknowledgement 才回報 PUBLISHED；state 寫入回應丟失仍回 MANUAL_CHECK_REQUIRED。

## Ambiguous handling

任何 UPLOAD_DISPATCHED/SUBMIT_DISPATCHED 或 store 寫入回應遺失：視為可能已寫入。禁止自動重送、重設 state、換 UUID/instance 或刪除新檔。read/recover + anonymous public/image GET 做人工 reconciliation；state 不猜測、未確定則保留。VERIFIED 也不自動釋放 reservation。

## Restore 與 stop conditions

- restore 需要明確批准；不能把早前恢復 JPEG 的成功當成本次 restore 授權或基線。
- 取回 hash-verified durable backup；確認原 public URL 還回原 bytes SHA。fresh editor note 必須等於本次 afterNote；若有人後續修改則 STOP，不覆蓋。
- 用 planPageSrcRestore 恢復保存的原 note（若新基線獲確認，應恢復 675×1200 及目前 PNG，而不是舊 JPEG/1280×720），沿用 fresh SEO/token；提交一次，公開 note/原圖 SHA 回讀成功才稱恢復。
- 本版本沒有 durable restore mutation API/executor，也沒有清除 reservation 的 API；restore 以人工監督單次操作及既有 durable blocked state 保護，不准 serverless 自動 retry。正式批准應明列此方式。
- 任意基線 drift、hash/MIME/URL 不符、備份不可取回、store down、unknown state、session/ACL 變更、超限、並行編輯、target 不唯一或 hidden → STOP。
- CMS 沒有 CAS，read→submit 間仍有競態；本機/Apps Script 鎖不鎖住人工 CMS 操作者。必須排他窗口，無法做到時不執行。

成功標準：指定現有 PNG 出現在指定公開 img、等比例顯示，完整 note 除該 img 外不變，匿名 bytes SHA 相符且 durable VERIFIED。不是登入或儲存提示成功。

## 實作依據與驗證邊界

Google 官方 LockService 文件確認 script lock 排除同一 script 的並行執行： https://developers.google.com/apps-script/reference/lock/lock-service 。本實作將 reserve、backup check 與 phase CAS 放在該鎖內。鎖不涵蓋外部 CMS；已在 runbook 保留排他操作與 read→write race 限制。測試是實際 Apps Script source 在每次新 VM 中執行，服務 backing state 由共享 mock 提供，非已部署的 Google runtime 實測。

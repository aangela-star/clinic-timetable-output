# 晉安官網單站受控瀏覽器 Pilot Runbook

## 狀態與適用範圍

2026-09-06 已完成「晉安官網單站受控瀏覽器 Pilot」：人工核准來源 PNG → CMS 瀏覽器上傳 → 影像屬性更新 → 整頁送出一次 → 匿名公開回讀驗證成功。

這不等於門診產生器「發布」按鈕整合完成，也不證明 server-side login / adapter 已可投入 Production。本文件僅更新操作與驗證基線，不修改正式程式、部署或啟用發布 gate。

先前本文件的部署候選、環境變數盤點及發布按鈕操作方案屬歷史規劃，不作為目前 Production readiness 證據。下一次正式換圖仍須 Angela 明確核准目標、來源及操作範圍；不得因本次成功自動再次發布。

## 最新公開基線

驗證時間：2026-09-06 22:48:40（Asia/Taipei）。每次操作前須重新 GET 確認，不能假定此基線永遠未變。

| 項目 | 本次成功結果／後續還原基線 |
|---|---|
| 公開頁 | `https://www.tainanrehab.com/time.html` |
| 圖片 path | `/upload/115-九月_醫師門診表 (1).png` |
| 圖片 dimensions | 675 × 1200 |
| 公開顯示尺寸 | 675 × 1200 |
| 圖片 bytes | 294076 |
| SHA-256 | `503cbde3c21bd37f0562154df3fa4029d08e65ce0c1f90b59d7af4980d17dc65` |
| 內容 | `115/九月`，晉安＋毅安完整門診及全部 7 筆門診異動 |

目標完整 HTML：

```html
<img alt="" src="/upload/115-九月_醫師門診表 (1).png" style="width: 675px; height: 1200px;" />
```

本次已確認整份公開 HTML 與操作前備份相比，只有目標圖片 `src` 改變；其他圖片、文字、連結、SEO 及頁面內容未變。其他圖片不得因來源包含兩院而自行刪除或調整。

## 來源與 CMS 衍生圖驗證規則

本次人工核准上傳來源：

- 檔案：`/Users/iaiangela/Downloads/115-九月_醫師門診表 (1).png`
- 尺寸：2160 × 3840；bytes：781588。
- SHA-256：`f78a1ed1cb91a89cea9962efd5de76ae0d07702c801ce391664640cec402725d`。

原始核准 PNG 可直接作為上傳來源。此次 CMS 自動縮圖／重新編碼，產生上述 675 × 1200 衍生圖；不得再要求公開圖 SHA-256 等於原始高清 PNG，也不得把原圖尺寸直接用作頁面顯示尺寸。

但不能無條件接受任何 hash 差異。正式送出前，必須：

1. 核對來源檔案身份、bytes、SHA-256 與人工核准內容。
2. 使用 CMS 實際回傳的圖片 URL，匿名 GET 衍生圖，記錄 dimensions、bytes、SHA-256；不得猜測同名檔的實際路徑。
3. 將衍生圖與原始核准 PNG 完整比對：等比例、無新增裁切、無內容缺失、兩院門診與所有異動完整，文字可讀。
4. 縮圖／重新編碼或品質不明時停止，保留檔案證據供確認；不重新上傳、不繼續送出。
5. 送出後以「CMS 衍生圖內容完整 + 公開圖與已驗證 CMS 衍生圖一致」作最終判準。

此次衍生圖已確認：`RESIZE_ONLY=YES`、`CROPPED=NO`、`CONTENT_COMPLETE=YES`、`TEXT_READABILITY=ACCEPTABLE`、`QUALITY_VS_CURRENT=SIMILAR`，並經 Angela 核准繼續。這是本檔案的證據，不可套用至其他未檢查圖片。

## 已成功的 CMS 操作路徑

1. 使用既有 CMS 瀏覽器登入；確認是晉安「門診時間表」編輯頁：`https://www.tainanrehab.com/admin/index.php?op=time&sub=set`。純 HTTP login 不可靠時，不反覆猜測 endpoint。
2. 先匿名 GET 公開頁及原圖，保存可跨 process 取回的還原備份：完整公開 HTML、目標完整 `<img>`、src/style/尺寸、原圖 URL、原始 bytes 與 SHA-256。確認基線未被其他人修改。
3. 單擊選取既有目標圖片，點 CKEditor 工具列第三行第一個「影像」／「影像屬性」圖示。**不要雙擊圖片**：已知雙擊可能開啟「超連結」設定，只改外層 `<a href>`，不改實際 `<img src>`。
4. 如需新上傳，在「上傳」分頁選取唯一人工核准 PNG，點「上傳至伺服器」一次。若已存在本次核准衍生圖，直接使用該 URL，不重複上傳。這是新檔上傳，不是 CKFinder overwrite。
5. 核對「影像資訊」URL 為已驗證的 CMS 衍生圖路徑，寬度 675、高度 1200；保留其他 attributes。點右下角綠色「確定」套用到編輯器，這一步尚未提交整頁。
6. 驗證編輯器目標 `<img src>` 已更新，style 仍為 `width: 675px; height: 1200px;`；其他 HTML、`a href`、圖片、SEO 與 form fields 不變。可使用 CKEditor「原始碼」檢視後返回編輯模式，不需手動改原始碼。
7. **`view-source` 瀏覽器分頁不是必要操作**。CKEditor 原始碼檢視與公開 HTTP GET 已可核對內容，不必新增 view-source 分頁。
8. 再次確認公開基線沒有 drift，捲至整頁最下方「訊息確認」區域，點真正的「送出」**一次**。「訊息確認」標題本身不是 submit 按鈕。
9. 本次送出後回到 `op=time&sub=set&mesCode=1`。此畫面只作提交回應證據，不能單獨宣稱發布成功；立即執行下列公開驗證，不再次送出。

## 公開回讀成功標準

- 匿名重新 GET `https://www.tainanrehab.com/time.html`，實際目標 `<img>` 指向本次 CMS 衍生圖。
- 公開顯示尺寸仍為 675 × 1200。
- 從公開 HTML 取得實際圖片 URL，匿名 GET 圖片，核對有效 PNG、dimensions、bytes、SHA-256 與提交前已驗證的衍生圖完全一致。
- 完整公開 HTML 與備份比較，預期僅目標 `src` 改變。本次完整 bytes 比對符合此條件。
- CMS 成功訊息、URL 變更或 HTTP 200 各自都不足以取代內容及 hash 驗證。
- 遇到 cache 或暫時性讀取不一致，只可唯讀調查；不得藉重複提交刷新結果。

## 停止、模糊結果與還原

- 身份、目標、基線、內容、尺寸或 hash 不符合核准值，或任何一步無法明確驗證，立即停止。
- 提交結果不明時記錄「可能已送出」，只做公開頁／圖片及 CMS 唯讀調查；不得自動重送、重上傳、刪檔或覆蓋。
- 還原前先確認公開頁仍是本次操作結果，且沒有他人後續修改。若 drift，停止請示，不覆蓋他人內容。
- 還原屬 Production write，須有該次明確授權。使用影像屬性恢復操作前備份的 src/style/尺寸，其他內容不變；單次整頁送出後再次公開回讀、hash 與其他內容核對。
- 原圖檔案應保留，不使用未知 delete／overwrite endpoint。本次成功後不需 rollback。
- **後續操作以本文件「最新公開基線」為還原起點**，不得自動還原成舊 JPEG／1280 × 720 或更早的 PNG。

## 本次操作前基線與證據留存

以下只用於追溯本次 Pilot，不是下一次換圖的預設還原目標：

- 舊圖：`/upload/115-九月_醫師門診表.png`，675 × 1200，294043 bytes。
- 舊 SHA-256：`d355fe7c32210c9a8e0e20af308b1fecabb9178a3d2c1e61a77dda5dcd1f0f80`。
- 本機私有證據目錄：`.pilot-private/20260906T120638Z/`。
- 操作前：`public.html`、`original-image.png`、`manifest.json`。
- 操作後：`pilot-after-public.html`、`pilot-after-verification.json`，記錄單次送出及公開驗證結果。

私有證據不隨本文件提交；不得記錄 credentials、cookies 或 secret。此目錄僅代表本機留存，不代表已有遠端備援。下次操作前應重新保存最新公開基線與圖片 bytes，確認授權操作者可人工取回。

## 邊界

本次僅證明晉安單站 CMS 瀏覽器換圖可完成，未執行毅安官網、其他平台、Sheet、Apps Script、Vercel 或其他頁面變更。未修改門診編輯器、Preview、PNG 產生／下載／列印流程。

發布按鈕與 server-side transport 的整合、部署、正式啟用及其耐久狀態保護，仍須各自驗證與核准；不得把本次瀏覽器 Pilot 結果當成已完成整合或已核准部署。

## 發布工作包 MVP（本機實作，尚未部署）

現有發布對話框選「晉安官網」後，「確認建立工作包」會擷取目前 Preview PNG，下載單一 `jinan-publish-YYYY-MM-<jobId>.json`。本步不呼叫 `/api/publish`、不登入 CMS、不上傳、不送出；狀態文字固定為「晉安官網發布工作包已建立，尚未發布。」瀏覽器開始下載不代表使用者已成功保留檔案，交接時須確認 JSON 實際存在且可讀。

schemaVersion 1 包含 UUID jobId、createdAt、`READY_FOR_BROWSER_EXECUTION`、`jinan-website`、primaryClinicId、title、monthKey、humanConfirmed，以及 `png`（dataUrl、sha256、dimensions、bytes）、`baseline`（pageUrl、imagePath、imageDimensions、imageBytes、imageSha256、verifiedAt、requiresRevalidation）。PNG hash 計算對象為解碼後原始 PNG bytes，不是 data URL 字串。

工作包是建立當時的獨立 snapshot，不隨後續畫面變更；不是可變工作佇列或執行紀錄。JSON 可被人工修改，`humanConfirmed` 也不是數位簽章或 CMS 執行授權。執行端仍須核對檔案、來源內容與操作授權；記錄的公開基線必須重新唯讀驗證，不可直接視為當下官網狀態。本次 MVP 不實作執行端、背景執行、Codex bridge 或自動發布。

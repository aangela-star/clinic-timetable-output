# CKFinder existing-asset overwrite：本機契約與復原設計

## 範圍與證據

使用者已確認本站 CKFinder 2.0.1 的 CopyFiles / MoveFiles 支援 `files[n][options]=overwrite`。本次選 CopyFiles：保留來源，避免 MoveFiles 刪除暫存來源；不使用同名 QuickUpload，不操作 page editor 或 time.html。

官方 CKFinder 2 命令索引列有 CopyFiles／MoveFiles：
https://docs-old.ckeditor.com/CKFinder_2.x/Server_Side_Integration/The_Commands

該索引的 CopyFiles 詳頁是缺頁連結。官方 FileUpload 文件描述 2.0 的 callback 方法，並指出 response_type=txt 到 2.1 才引入，不能套用到 2.0.1：
https://docs-old.ckeditor.com/CKFinder_2.x/Server_Side_Integration/The_Commands/FileUpload

本次沒有自行聲稱已讀到本站原始 CopyFiles 成功回應。測試 XML 是刻意嚴格的 **mock fixture**，不是 production connector wire format 的認證；真實 XML 結構、ACL、resource base URL、認證及 CSRF 需求須在接入真實 transport 前以授權唯讀紀錄核對。

## Request contract

目標固定為 Images resource root 中的 `photo_2026-09-02 23_08_57(1).jpeg`，公开 URL：
`https://www.tainanrehab.com/upload/photo_2026-09-02%2023_08_57(1).jpeg`
（encodeURIComponent 保留括號，與百分比編碼括號表示同一 URL 路徑。）

`POST /scripts/ckfinder/core/connector/php/connector.php?command=CopyFiles&type=Images&currentFolder=%2F`

Content-Type：`application/x-www-form-urlencoded`

- `files[0][name]`：精確目標 basename
- `files[0][type]`：Images
- `files[0][folder]`：已存在且非目標 root 的來源 folder，例如 `/stage-1/`
- `files[0][options]`：overwrite

只允許一個檔案，沒有 rename / skip / MoveFiles / delete fallback。folder 只接受一層安全字元，阻擋 root、traversal、URL、percent-encoded 路徑。

## 暫存來源與 mock adapter

`simulateOverwrite` 是本機 orchestration，僅 `mode: mock` 並完整注入 anonymousRead、copy、preserveBackup 時可執行。没有預設 fetch、環境變數、production credentials 或 HTTP route。mode 不是防止惡意 transport 的 sandbox；本次注入的只有 in-memory mocks，禁止改用真實 writer 而未取得批准。

本次選擇「使用已存在的非目標 folder 暫存 asset」路徑，沒有建立 folder 或 upload executor。來源須已使用相同 basename；先以公開 GET 確認內容 hash 與目前編輯器 PNG 相同，且沒有重編碼。resource `Images` 的 base URL 在 fixture 為 `/upload/`，須先由本站 Init／GetFiles 唯讀證據確認，不能直接當正式配置。

流程：驗證來源 PNG → 驗證暫存 asset → GET 原目標 → 備份 sink 保存並回讀核對 SHA-256、回覆 verified receipt → 再讀目標與來源阻擋 drift → 單次 CopyFiles → 嚴格驗證回應 → 匿名 GET 固定 public URL → bytes hash 相同且 MIME image/png 才回報 VERIFIED_MOCK。

任何 mutation dispatch 後的 timeout、錯誤、partial copy、改名、redirect、未知 response、hash 或 MIME 不一致均回報 MANUAL_CHECK_REQUIRED；不自動重送、不自動復原。原圖不會放入回應或 logs。

## JPEG 目標與 PNG 來源

保留 `.jpeg` URL 不代表可以假設 PNG 安全上線。來源與目的端都必須證明保留 PNG bytes 並以正確 image/png MIME 提供。若 CKFinder 檢查副檔名、重編碼或 Apache 按 `.jpeg` 回 image/jpeg，本契約停止，不自動轉 JPEG（會改變 PNG hash），不自行改 server MIME 設定或 URL。

## Restore 設計（本次不執行）

1. 在任何 copy 前，備份完整原 bytes、SHA-256、原 MIME、精確 URL。真實 backup sink 須耐久保存且重新讀取驗證；fixture 用記憶體，不代表已備份 Production。
2. 若試跑結果不確定，先停止及唯讀檢查，保留 staging 與 backup。沒有自動 rollback。
3. 另行批准 restore 時，在非目標 restore folder 準備原 bytes，同 basename，核對其原 hash；重新讀目標，若有非本次已知內容或其他人修改則停止，不盲目覆蓋。
4. 以同一 CopyFiles overwrite 契約，從 restore folder 複製至 root。一次 dispatch，匿名回讀固定 URL，驗證原 SHA-256 與原 MIME。恢復失敗不重試、不刪除原圖或新圖。
5. 這只是準備好的操作設計，尚未驗證真實 restore 的權限、response、MIME 與快取。

## Atomicity、快取及第一次真實操作 gate

CopyFiles overwrite 不等於 atomic rename；沒有證據保證讀者不會讀到部分 bytes，也沒有跨操作者鎖或 compare-and-swap。兩次 drift check 只能縮小競態窗口，不能消除。正式試跑需要單一操作者、備份及明確風險批准，不新增服務。

匿名 GET 帶 no-cache/no-store，禁止 redirect／cookie，要求 HTTP 200；不能因此保證所有 browser/CDN 立即失效。一次 SHA-256 成功只證明該次回讀。同 URL 的 Last-Modified 粒度、CDN 行為及 cache invalidation 必須納入真實試跑驗證。

第一次真實 upload、folder 建立、CopyFiles overwrite、restore 都是 Production write，須先批准。授權前先完成唯讀契約核對；本機 VERIFIED_MOCK 絕不顯示為病人可見內容已發布成功。

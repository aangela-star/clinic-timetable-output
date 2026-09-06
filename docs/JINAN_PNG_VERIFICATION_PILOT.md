# 晉安門診 PNG 一致性驗證與可回復試跑方案

本文件是試跑準備，不是正式環境操作授權。適用於含本次 PNG hash 驗證的 commit。
舊 JINAN_CONTROLLED_PRODUCTION_PILOT_RUNBOOK.md 中的部署 SHA、環境變數現況及僅驗證圖片 path 的敘述是歷史紀錄，不能作為本次部署現況；本文件更新圖片驗證及復原前置條件。

## 本次實作

現有發布按鈕沿用目前 Preview 的 capture，自行產生 PNG 並送往 server-side adapter。正常流程不要求下載再上傳，不改動 UI、PosterContent、handleDownload 或 html2canvas。

送出前，server 對已驗證的 PNG bytes 計算 SHA-256。CMS 提交後，匿名重新 GET 公開頁及圖片，必須同時滿足既有 URL、HTTP、MIME、PNG 結構／尺寸、頁面內容保護及 byte hash 一致，才能回報 PUBLISHED。CMS 若重編碼圖片，即使視覺相同也不回報成功；需先調查，不能放寬驗證以掩蓋差異。

提交結果不確定時，原次 hash 僅保留於既有 process-local coordinator；後續請求只回讀驗證，不再上傳／提交，不能以新請求圖片取代原次期望值。Hash 不出現在 API 回應或既有 structured logs。

## 本機驗證

使用 synthetic credentials、mock transport 與合成 PNG。既有成功、提交結果不確定、回讀、並行阻擋測試，加上合法但 bytes／pixels 不同的失敗案例；沒有外部 CMS 請求。

完整測試：`node --test tests/*.test.cjs` 與 `python3 -B -m unittest discover -s tests -v`。

## 真實試跑前置條件

1. 人工批准 exact commit 的 merge／部署；另行確認實際部署 SHA、正式 gate 與 credentials 配置。不得將正式 CMS credentials 放入 Preview。
2. 先取得既有非正式 CMS 測試頁／副本的可用性證據；若沒有，不新增服務，也不把正式頁稱為測試環境。
3. 在獲授權的 CMS 表單讀取中確認換圖、提交、原門診圖片區塊，以及可透過既有 CMS 編輯器恢復的實際操作。登入成功不等於已驗證換圖。
4. 保存試跑前公開頁、原門診圖片區塊完整 HTML、各原圖 URL／bytes／SHA-256，放於 repo 外受控位置；不保存 credentials、cookies 或 session／CSRF token。人工核對復原材料完整。原圖不能刪除或覆寫。
5. 使用經 Angela 確認的門診事實／PNG。不得為測試任意改寫門診內容。正式換圖前須再取得該次操作的明確批准。

## 換圖與復原演練

在既有非正式副本可用時，先以相同 CMS 流程演練：記錄原區塊與原圖 → 一次發布 → 匿名回讀頁面及圖片並核對 hash → 透過既有 CMS 編輯器恢復原門診區塊 → 再匿名核對每張原圖與非門診內容未變。

恢復時必須重新讀取最新 editor form，使用當下 token，僅還原門診圖片區塊，保留其他欄位及其他人最新修改。若現況已被他人修改或無法明確定位區塊，停止人工處理，不覆蓋整頁歷史 HTML。復原只還原圖片引用，不刪除新上傳檔；孤立檔案清理另行授權。

沒有非正式副本時，本文件不能證明真實復原已通過；需先準備完整備份及人工 CMS 復原步驟，再請 Angela 單獨批准受控正式試跑與對應復原。若無法確認可恢復，禁止正式試跑。

## 失敗處置與限制

任何上傳／提交／回讀不確定結果都停止重試，人工確認公開頁與 CMS。不能因 hash 不一致就重新上傳。正式復原也是正式內容寫入，必須在批准範圍內。

現有 coordinator 非跨 instance／持久化鎖；只用一位操作者、一個 session／tab，禁止並行或跨 instance 重試。程序重啟後不保證保留前次狀態。這是受控試跑限制，不代表已提供全域 exactly-once。

本次沒有實作自動 rollback，沒有操作真實 CMS，沒有證明人工瀏覽器與 server-side 的上傳／提交契約等價。只有出現可重現的 server-side 不相容證據，才另行評估 browser adapter。

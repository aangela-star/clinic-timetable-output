# 晉安 page-src replacement：優先發布契約

## 證據與範圍

2026-09-06 Angela 回報人工 Production change → public verification → manual restore → public verification 全程成功。本工程沒有執行新的 production request。此為人工提供的行為實證，並非自動化 transport 的實測。

正確 UI：選取指定圖片 → CKEditor 工具列「影像屬性」（目前第三行第一個；未來應依可見名稱與 dialog 欄位定位，不能只依座標）→ 修改圖片 URL → 清空 1280 / 720 → 確定 → 整頁最下方「送出」。雙擊會開超連結，只改 a href，不改 img src。訊息確認是區塊標題。

人工實證支持 page-src replace 優先於 CKFinder overwrite。後者留作未啟用的研究路徑，不作失敗 fallback。現有多圖集合 replacement 不能直接用在單圖目標：會刪除其他圖。單圖契約已接入 publishJinanCms 的明確 mock 分支（options.pageSrc + mode=mock + injected transport + preserveBackup）；預設正式 UI/API wiring 未切換，不能直接上線。

## Request 與目標

表單 addAdminFrm：POST multipart/form-data；action 空字串表示目前 editor URL，op=time&sub=set。mode=edit、note 完整 HTML、wtitle、wkeyword、wdescription、Submit=送出；保留 fresh GET 的所有 hidden 欄位，不憑舊畫面重建 token。唯讀曾未見 token，不代表永远沒有。

planPageSrcReplacement 接受新鮮 editor HTML、人工確認的完整 originalImageHtml、新 .png root-relative upload URL、目前產生器 PNG data URL。验证 PNG 結構/2160×3840，保存 SHA-256；以唯一原 src 與完全相同 image tag 同時定位，只改那一個 tag，不依第一張圖或 hyperlink 定位。其他圖片、外層 href、文字、SEO/hidden fields 均保留。來源 drift、重複目標或隱藏目標拒絕。

新 tag 保留 alt，移除固定 width/height attributes，以 style="width: auto; max-width: 100%; height: auto;" 等比例顯示。外層連結仍指向原位置是刻意保留的 scope：點擊目的地不等於圖片顯示來源，若要改連結須另列明確變更。

## Adapter 執行順序（已做 mock integration；本次不執行 Production）

現有 PNG → 選晉安官網 → 人工確認 → 備份 editor note 與公開頁/舊圖片 bytes/hash → 既有 upload 能力產生新 .png URL → 匿名 GET 核對來源 SHA-256，重編碼/縮圖即停止 → fresh editor GET 比對人工確認基線 → 建立 single-img plan → 一次 submit → anonymous public page + image GET → verifyPageSrcReadback。

browser fallback 也遵循同一目標與基線；影像 dialog 確定後、整頁 submit 前須讀 note，確認 src 與 responsive dimensions，且其餘 HTML 無異動。CKEditor 重排其他 markup 時先停止，不放寬精確比對。只許官方/server-side 已驗證 transport；不得偷偷用 browser write 解決不明回應。

verifyPageSrcReadback 要求精確公開 URL、200、無 redirect、完整 afterNote 恰好出現一次、目標圖唯一且非 hidden/comment、PNG MIME/有效 bytes、SHA-256 一致。Transport 必須匿名、無 credentials、no-cache/no-store；本純函式無網路，不能證明呼叫者實際匿名。不能以 href、mesCode=1、儲存提示或 HTTP 200 取代公開內容驗證。嚴格 HTML 比對可能因模板正規化 fail closed；不會因此重送。

## Rollback 與安全 gate

planPageSrcRestore 僅在新鮮 note 完全等於本次 afterNote 時產生還原 request，恢復整份原 note（含原 src、1280×720），沿用 fresh SEO/token，不覆蓋其他人後續編輯。實際 rollback 要另行人工批准；不可因 timeout 自動 retry/restore。再次公開 GET 比對原 note 與備份原 bytes SHA-256 後才能稱還原成功，舊 JPEG 不套用新 PNG validator。耐久備份及 restore readback transport 仍是 live 接入前必要條件。

人工行為成功未提供 raw POST status/redirect/header，仍不得宣稱 server response schema 已認證。上傳是否縮圖、session、匿名讀取、備份及併發窗口須在下一次受控 live gate 前檢查；沒有跨操作員 CAS，試跑須單一操作員。下次正式 upload/submit/restore 仍需 Angela 批准。PR #6 不 merge、不 deploy。


## 本機 transport integration 與限制

- 既有 API createHandler 的 server-side preflightPublish 注入 publishJinanCms，沿用原 payload（包含 primaryClinicId=clinic-1、PNG data URL）。測試經過 authenticated API handler，沒有改 browser UI 或 clinic ID contract。pageSrc.originalImageHtml 是 server-side 確認基線，不能從公開 POST body 注入；既有 route 的 exact key validation 保持原樣。
- pageSrc 分支只接受 mode=mock、顯式 transport 及 preserveBackup。缺任何一項即在網路呼叫前拒絕；沒有 default fetch fallback。Mock mode 是工程隔離條件，不是防止惡意 injected transport 的 sandbox。這次 transport 全是記憶體 fixtures，沒有讀取 production credentials 或呼叫 live CMS。
- 重用既有登入、QuickUpload request/response parser、form parser、PNG validator、in-flight coordinator；不呼叫 CopyFiles/MoveFiles。正式 upload 仍是 production write，未被本次授權。
- upload 前保存原 note、公網 HTML、原圖 bytes/MIME/SHA-256，backup sink 回覆 note/image hash receipt；submit 前再次保存含精確 rollback plan 的備份。receipt 是 mock sink 契約，不代表已建立 Production 耐久備份。真實 sink 必須寫後回讀且僅存在 server-side，plan 可能包含 session-bound hidden fields，不得放在前端、公開 artifact 或 log。
- upload 後先匿名讀圖核對有效 PNG/MIME/hash，再讀公開頁與 fresh editor。公開頁完整 baseline 不同、note 任意不同即停止。fresh SEO/hidden fields 原樣沿用，不拿舊值覆蓋新值。
- submit dispatch 前設 ambiguous latch。raw submit response 不用來宣稱成功：timeout/500/302 都只接續匿名公開回讀，HTML+PNG SHA-256 同時符合才成功。回讀失敗則 MANUAL_CHECK_REQUIRED；後續相同 PNG 請求只回讀，不重新登入/upload/submit。換成不同 PNG 仍拒絕，不將前次成功套到新圖。
- 每個公開 GET 都用新空 cookie jar、no-cache/no-store、禁止跟隨 redirect；讀取順序為頁面再圖片。成功只代表該次 origin 回讀，不代表所有 browser/CDN cache 同時清除。
- in-flight/ambiguous 狀態仍是既有 process-local coordinator，無跨 Vercel instance 鎖且 restart 會遺失。這是正式 button rollout 前必須處理的限制，不能把 mock 測試宣稱為跨 instance exactly-once。不得為此未經批准新增 infrastructure。
- fresh GET 與 submit 之間仍無 CMS CAS；單一操作員及短維護窗口只降低競態，不能保證排除並行修改。備份有完整 rollback plan，但本次没有自動 restore executor，也沒有自動 retry/cleanup/delete。

## 首次 Production gate 的 runbook 準備要求（未批准、未執行）

正式 gate 前必須提供當次精確 manifest：feature commit SHA、人工確認 PNG SHA-256/2160×3840、目標完整 img tag、editor note SHA-256、原公開圖 URL/bytes SHA-256/MIME、耐久 backup 位置與回讀 receipt、預計的 single-img diff、操作員及時段。不能使用本文件的 mock PNG/receipt 替代真實值。主路徑為 page-src replacement；影像屬性成功/超連結失敗/人工復原成功是正式行為契約，並非當次操作批准。

批准範圍應明列一次 QuickUpload（新檔、不覆蓋原檔）及一次 editor POST，兩者均為 Production write；merge/deploy 不是此次 runbook 隱含授權。上傳新 URL 尚未知時，明列允許的同站 /upload/*.png 回應與不得覆蓋舊 URL 的限制；實際 upload 回應若不符合即停止。

1. 操作前 fresh readonly baseline、確認已選的原 tag 唯一且人工 PNG 與 approval hash 相同；備份原頁/圖且回讀核對。
2. 經批准 upload 一次；匿名 GET 返回檔，PNG bytes/hash 不同就停止，不 submit，不重傳。
3. 再讀公開頁、editor；任意 note/public drift 停止。組出僅 img src + responsive style 的 diff，保存 rollback plan，保留其他圖片、a href、SEO、hidden fields。
4. 經批准 submit 一次；公開 time.html 回讀新的 note，再 GET 新 PNG SHA-256。若未知結果，只回讀，不重送，保留新檔及備份。
5. 若需要 restore，提交單一額外批准決策（除非先前明確批准同一故障情境的 restore）。fresh note 必須等於本次 afterNote，再用 planPageSrcRestore 恢復原 note + 原尺寸；fresh SEO/token 保留。若其他人已改動則停止。公開頁/原圖 hash 比對成功才回報 restore 完成。

本階段完成 mock implementation/review/測試/feature push，不啟用正式 button 的 page-src transport。完成 live wiring、安全狀態與耐久備份準備後，第一次正式寫入前才提交填妥 manifest 的 exact runbook 給 Angela 批准。


## 後續耐久安全準備

見 `JINAN_DURABLE_PILOT_RUNBOOK.md`。已新增既有 Apps Script/Sheet 的 bounded durable store 與 mock integration；尚未部署/啟用。2026-09-06 公開基線已變更，舊 JPEG/1280×720 僅為歷史人工實證，不再是可直接執行的 restore 預設。

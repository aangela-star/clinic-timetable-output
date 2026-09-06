# 晉安 page-src replacement：優先發布契約

## 證據與範圍

2026-09-06 Angela 回報人工 Production change → public verification → manual restore → public verification 全程成功。本工程沒有執行新的 production request。此為人工提供的行為實證，並非自動化 transport 的實測。

正確 UI：選取指定圖片 → CKEditor 工具列「影像屬性」（目前第三行第一個；未來應依可見名稱與 dialog 欄位定位，不能只依座標）→ 修改圖片 URL → 清空 1280 / 720 → 確定 → 整頁最下方「送出」。雙擊會開超連結，只改 a href，不改 img src。訊息確認是區塊標題。

人工實證支持 page-src replace 優先於 CKFinder overwrite。後者留作未啟用的研究路徑，不作失敗 fallback。現有多圖集合 replacement 不能直接用在單圖目標：會刪除其他圖。新純函式未接入舊 publishJinanCms，也未改現有 UI/API；目前不是可直接上線的完整發布功能。

## Request 與目標

表單 addAdminFrm：POST multipart/form-data；action 空字串表示目前 editor URL，op=time&sub=set。mode=edit、note 完整 HTML、wtitle、wkeyword、wdescription、Submit=送出；保留 fresh GET 的所有 hidden 欄位，不憑舊畫面重建 token。唯讀曾未見 token，不代表永远沒有。

planPageSrcReplacement 接受新鮮 editor HTML、人工確認的完整 originalImageHtml、新 .png root-relative upload URL、目前產生器 PNG data URL。验证 PNG 結構/2160×3840，保存 SHA-256；以唯一原 src 與完全相同 image tag 同時定位，只改那一個 tag，不依第一張圖或 hyperlink 定位。其他圖片、外層 href、文字、SEO/hidden fields 均保留。來源 drift、重複目標或隱藏目標拒絕。

新 tag 保留 alt，移除固定 width/height attributes，以 style="width: auto; max-width: 100%; height: auto;" 等比例顯示。外層連結仍指向原位置是刻意保留的 scope：點擊目的地不等於圖片顯示來源，若要改連結須另列明確變更。

## 預定 adapter 執行順序（本次不執行）

現有 PNG → 選晉安官網 → 人工確認 → 備份 editor note 與公開頁/舊圖片 bytes/hash → 既有 upload 能力產生新 .png URL → 匿名 GET 核對來源 SHA-256，重編碼/縮圖即停止 → fresh editor GET 比對人工確認基線 → 建立 single-img plan → 一次 submit → anonymous public page + image GET → verifyPageSrcReadback。

browser fallback 也遵循同一目標與基線；影像 dialog 確定後、整頁 submit 前須讀 note，確認 src 與 responsive dimensions，且其餘 HTML 無異動。CKEditor 重排其他 markup 時先停止，不放寬精確比對。只許官方/server-side 已驗證 transport；不得偷偷用 browser write 解決不明回應。

verifyPageSrcReadback 要求精確公開 URL、200、無 redirect、完整 afterNote 恰好出現一次、目標圖唯一且非 hidden/comment、PNG MIME/有效 bytes、SHA-256 一致。Transport 必須匿名、無 credentials、no-cache/no-store；本純函式無網路，不能證明呼叫者實際匿名。不能以 href、mesCode=1、儲存提示或 HTTP 200 取代公開內容驗證。嚴格 HTML 比對可能因模板正規化 fail closed；不會因此重送。

## Rollback 與安全 gate

planPageSrcRestore 僅在新鮮 note 完全等於本次 afterNote 時產生還原 request，恢復整份原 note（含原 src、1280×720），沿用 fresh SEO/token，不覆蓋其他人後續編輯。實際 rollback 要另行人工批准；不可因 timeout 自動 retry/restore。再次公開 GET 比對原 note 與備份原 bytes SHA-256 後才能稱還原成功，舊 JPEG 不套用新 PNG validator。耐久備份及 restore readback transport 仍是 live 接入前必要條件。

人工行為成功未提供 raw POST status/redirect/header，仍不得宣稱 server response schema 已認證。上傳是否縮圖、session、匿名讀取、備份及併發窗口須在下一次受控 live gate 前檢查；沒有跨操作員 CAS，試跑須單一操作員。下次正式 upload/submit/restore 仍需 Angela 批准。PR #6 不 merge、不 deploy。

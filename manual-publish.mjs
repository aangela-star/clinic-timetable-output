/* Manual navigation only. URL provenance: docs/MANUAL_PUBLISH_LOCAL.md. */
export default function ManualPublishSection({ clinicName, monthKey, posterTitle } = {}) {
    const h = React.createElement;
    const yianFacebookSteps = clinic => [
        '一般操作草稿：介面可能變更，管理介面尚未驗證；專屬公開頁連結由使用者提供，不是已驗證的管理編輯入口。新增貼文或更換既有相片的本次操作尚未確認。未確認前請停止，不以搜尋結果或通用 Facebook 網址代替。',
        '本次操作方式經確認後，由具權限的操作人員開啟管理介面，確認目前選擇的是「' + clinic + '」粉專，避免使用個人帳號或另一間診所的粉專。',
        '選用本次經人工核准 PNG，核對圖片及文字中的診所、月份、門診異動與公告；不要自行補上未確認資訊。',
        '在平台預覽圖片與貼文，核對內容完整、清晰且無裁切。若找不到相符操作或無法確認目標，停止並請管理員協助。',
        '核對完成且取得本次發布授權後，由操作人員在平台執行發布一次。本區開啟連結不會發布。',
        '到正確粉專的公開頁確認新貼文、PNG 與文字。結果不明時停止，先查公開頁及管理介面的貼文狀態，不重複發布或上傳。'
    ];
    const jinanFacebookSteps = () => [
        '文字操作指引，介面名稱可能不同；圖解待補。本區僅提供導引，不使用權杖、不會自動發文；尚未實際驗證 Facebook 介面。',
        '先核對診所、月份、本次經人工核准 PNG 與核准文字，確認都是本月晉安資料並已取得本次發布授權。',
        '開啟晉安專屬粉專 https://www.facebook.com/tainanrehab 。由具有粉專權限的人員登入，切換為晉安粉專身分，再核對粉專名稱確實是晉安，確認後才繼續。不要在個人頁面或另一間診所粉專操作。',
        '新增貼文或更換既有相片的本次操作尚未確認；以下僅為新增貼文的條件式草稿，不能視為使用者已選定新增貼文。若本次經確認採用新增貼文，在晉安粉專尋找「建立貼文」（Create post）及「相片／影片」（Photos/video）。名稱與位置可能因裝置或版本不同；若缺少權限、找不到按鈕或無法確認身分，停止並請主管協助，不改到其他頁面發布。',
        '加入本次已核准的高解析度 PNG；若尚未備妥，回到既有門診表產生器預覽並下載，再核對檔案。輸入本月核准文字，不自行新增或猜測醫師、日期或時間。',
        '在 Facebook 預覽完整貼文，確認整張圖片不裁切、清楚可讀，診所、月份及文字正確；有疑問先停止並請主管確認。',
        '僅在本次新增貼文方式及內容均已確認後，由本次授權員工親自在 Facebook 手動發布一次。本區開啟連結不代表已發布。',
        '發布後回到 https://www.facebook.com/tainanrehab 檢查新貼文、圖片及文字是否正確；可能需要登入，不保證未登入也能查看。結果不明時先檢查既有貼文與貼文狀態，請主管協助，不重複發布或上傳。',
    ];
    const entries = [
        {
            id: 'jinan-web', label: '晉安官網後台', url: 'https://www.tainanrehab.com/admin/index.php?op=time&sub=set',
            steps: [
                '先取得本次發布授權，備妥核准 PNG，核對診所、月份與公告。使用有權限的既有帳號登入，不記錄密碼；確認是晉安「門診時間表」編輯頁。',
                '先到下方公開門診表下載舊圖片，或截圖留存公開頁。截圖只是比對參考，不是完整還原備份；需要還原時請主管安排。',
                '單擊既有門診表圖片，再點工具列「影像／影像屬性」。不要雙擊，以免開到超連結設定。',
                '在「上傳」分頁選擇本次核准 PNG，點「上傳至伺服器」一次。若本次圖片已上傳或不確定，停止並請主管確認，不重複上傳。',
                '確認整張圖清楚、不裁切、比例正常；保留既有顯示設定與尺寸，不自行調整。影像視窗的「確定」只套用到編輯器，尚未提交整頁，也尚未發布。',
                '核對編輯器中的圖片正確，其他欄位、圖片與連結未變；公開頁若已被他人修改，先停止。捲到整頁最下方，在「訊息確認」標題下方點真正的「送出」按鈕一次。',
                '用手機或無痕視窗開啟下方晉安公開門診表並重新整理，查看實際圖片：診所、月份、公告正確，文字可讀、整張完整、比例正常。不能只看後台成功訊息。',
                '登入失敗、診所或頁面錯誤、月份或檔案過期、圖片模糊或裁切、結果不明，都立即停止並聯絡主管；不重試、不重送、不再上傳、不刪舊圖、不改其他欄位。送出結果不明時記錄「可能已送出」。'
            ],
            publicUrl: 'https://www.tainanrehab.com/time.html', publicLabel: '晉安公開門診表'
        },
        {
            id: 'yian-web', label: '毅安官網後台', url: 'https://www.ian-tainan.com/admin/login.php',
            steps: [
                '準備與驗收清單草稿，後台換圖步驟待確認。後台登入URL：使用者提供。內部換圖流程/截圖：待確認。上傳操作流程尚未驗證；目前停止後台發布，不套用晉安步驟。開啟連結不授權自動登入、上傳或送出。',
                '公開驗收請開啟下方毅安公開門診表；已由官方首頁確認連結，這不是管理後台入口。頁面目前有毅安、晉安、門診異動及週六門診表四張圖。先確認主管指定更新哪張，保留其他圖，不用單一 PNG 覆蓋整頁多圖。',
                '可先確認本次發布授權、具權限的既有帳號（不記錄密碼），準備核准 PNG，核對毅安、月份與公告。主管確認實際流程前，不進行上傳或送出。',
                '待流程確認後，驗收需用手機或無痕視窗查看已確認的公開門診表實際圖片，核對診所、月份、公告、清晰度、完整圖片及比例；不能只看後台成功訊息。結果不明立即停止並聯絡主管，不重複上傳或送出；送出結果不明記錄「可能已送出」。'
            ],
            publicUrl: 'https://www.ian-tainan.com/time.html', publicLabel: '毅安公開門診表'
        },
        { id: 'jinan-fb', label: '晉安 FB 粉專', url: 'https://www.facebook.com/tainanrehab', steps: jinanFacebookSteps() },
        { id: 'yian-fb', label: '毅安 FB 粉專', url: 'https://www.facebook.com/IANCLINICTAINAN/?locale=zh_TW', steps: yianFacebookSteps('毅安') },
        {
            id: 'farbar', label: 'FarBar 院內顯示',
            url: 'https://w3.farbar.ai/channels/channel30/cms31/editChannel.php?chcode=rG2vq&cntcode=NVJkF&',
            steps: [
                '使用者提供的已知頻道管理入口；開啟後先確認「台南毅安／門診時間」目標，不能只憑網址認定已選中正確內容。',
                '上傳／儲存流程尚未驗證。未確認前不上傳、不儲存；內部選檔、套用、儲存位置待管理員確認，不套用官網步驟。',
                '先選擇診所，再用上方現有預覽／下載；人工核對本次核准 PNG 的診所、月份與公告。開啟入口不會上傳或更新顯示。',
                '流程經確認且取得本次授權後才操作。之後由人員查看實際／頻道顯示，確認目標、圖片完整與內容正確；沒有已確認的公開驗收網址。結果不明先停止，不重複上傳或儲存。'
            ]
        }
    ];
    const illustratedGuide = () => h('div', { className: 'mt-4 space-y-4', 'data-website-illustrations': 'jinan' },
        h('p', { className: 'text-sm font-bold text-teal-900' }, '以下真實 CMS 圖解僅適用晉安。115年9月僅為示例，每次都要核對實際發布月份。點圖可在新分頁放大，手機可雙指縮放。'),
        [
            ['01-login.png', '圖 1：登入欄位已完整遮除；使用自己的帳號及密碼。'],
            ['02-sidebar.png', '圖 2：左側選單中下段放大；在「門診時間表」下點子項「門診時間表內容」。'],
            ['03-editor.png', '圖 3–4：先單擊下方門診表圖片，再點第三行左側影像圖示；不要雙擊，不修改其他欄位或 SEO。'],
            ['04-upload-tab.png', '圖 5：點「上傳」分頁。此實圖仍停在影像資訊，尚未顯示上傳內容。'],
            ['05-confirm.png', '圖 6–7：保留既有尺寸及其他設定；綠色「確定」只套用編輯器，尚未發布。']
        ].map(([file, caption], index) => h('figure', { key: file, style: { margin: '16px 0', minWidth: 0 } },
            h('a', { href: './docs/assets/website-guide/' + file, target: '_blank', rel: 'noopener noreferrer', 'aria-label': caption + '（開啟本機圖片放大）', style: { display: 'block' } },
                h('img', { src: './docs/assets/website-guide/' + file, alt: caption, loading: 'lazy', style: { display: 'block', width: '100%', maxWidth: '100%', height: 'auto' } })),
            h('figcaption', { className: 'text-sm leading-relaxed mt-2' }, caption),
            index === 3 ? h('p', { 'data-missing-screenshot': 'upload', className: 'text-sm p-3 bg-amber-50 text-amber-900 border border-amber-300 rounded' }, '缺圖待補：上傳分頁內容、檔案選擇器與「上傳至伺服器」。點上傳後，選擇本次核准 PNG，再點「上傳至伺服器」一次；已上傳或不確定就停止請主管確認。') : null,
            index === 4 ? h('p', { className: 'text-sm leading-relaxed mt-2' }, '局部預覽不能證明原圖被裁切，仍須檢查完整圖片。upload/source.png 只是截圖示例，不是要手動輸入的固定網址；由上傳結果帶入，不自行改填。尺寸只供辨識既有欄位，不是重新縮放 PNG 的指令。') : null
        )),
        h('p', { 'data-missing-screenshot': 'submit', className: 'text-sm p-3 bg-amber-50 text-amber-900 border border-amber-300 rounded' }, '缺圖待補：整頁最下方「訊息確認」與真正的「送出」按鈕。核對編輯器與其他欄位後，捲到整頁底部，在標題下點真正「送出」一次才是發布；結果不明記錄「可能已送出」並停止。接著到公開頁驗收，不能只看後台成功訊息。'),
        h('a', { href: './docs/官網門診表操作手冊.html', target: '_blank', rel: 'noopener noreferrer', className: 'inline-block text-sm font-bold underline text-teal-800' }, '開啟完整離線／可列印圖解手冊（可另存 HTML）')
    );
    const guidance = {
        'jinan-web': ['已知入口・有歷史操作紀錄', '先核對晉安圖片，再依既有手冊操作並到公開頁驗收。'],
        'yian-web': ['已知入口・換圖流程未驗證', '可開啟毅安登入頁確認目標；換圖步驟待確認，先不上傳或送出。'],
        'jinan-fb': ['已知入口・發文方式未確認', '先確認晉安粉專與本次操作：新增貼文或更換既有相片仍待確認。'],
        'yian-fb': ['已知公開頁・流程未驗證', '毅安粉專公開頁由使用者提供；管理介面與本次新增貼文或更換既有相片仍待確認，未確認前不操作。'],
        'farbar': ['已知入口・上傳／儲存未驗證', '開啟頻道管理入口，先確認台南毅安／門診時間；未確認前不上傳、不儲存。']
    };
    const linkClass = 'inline-block rounded-lg px-3 py-2 text-sm font-bold bg-teal-700 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700';
    return h('section', { 'aria-labelledby': 'manual-publish-title', className: 'rounded-2xl border border-slate-300 bg-slate-50 p-4 space-y-3' },
        h('h2', { id: 'manual-publish-title', className: 'text-lg font-black text-slate-800' }, '手動發布'),
        h('p', { className: 'text-sm font-bold text-amber-900 bg-amber-50 rounded-lg p-3' }, '開啟連結不代表已發布。完成操作後，請到公開頁面或實際顯示確認。'),
        h('div', { 'data-manual-context': true, className: 'rounded-xl border-2 border-teal-700 bg-white p-3 text-sm font-bold text-slate-900', 'aria-live': 'polite' },
            h('p', {}, '目前選擇（優先診所）：' + (clinicName || '尚未選擇')),
            h('p', {}, '選定月份：' + (monthKey || '尚未選擇')),
            h('p', {}, '海報標題：' + (posterTitle || '尚未填寫'))),
        h('p', { className: 'text-sm text-slate-700' }, '先選擇診所，再用上方現有預覽／下載。核對預覽中的診所、月份、標題與本次核准 PNG；各平台不會替你切換診所。'),
        h('p', { className: 'text-sm text-slate-600' }, '本區只提供連結與說明。儲存資料、開啟入口都不代表已發布；平台操作後仍須人工驗收。'),
        entries.map(entry => h('article', { key: entry.id, 'aria-labelledby': entry.id + '-title', className: 'rounded-xl border border-slate-200 bg-white p-3 space-y-3' },
            h('h3', { id: entry.id + '-title', className: 'font-black text-slate-800' }, entry.label),
            h('p', { 'data-entry-status': entry.id, className: 'text-xs font-bold text-slate-600' }, guidance[entry.id][0]),
            h('p', { className: 'text-sm leading-relaxed text-slate-700' }, guidance[entry.id][1]),
            entry.url
                ? h('a', { href: entry.url, target: '_blank', rel: 'noopener noreferrer', className: linkClass }, (entry.id === 'farbar' ? '頻道管理入口' : '開啟' + entry.label) + '（新分頁）')
                : h('button', { type: 'button', disabled: true, className: 'rounded-lg px-3 py-2 text-sm font-bold bg-slate-100 text-slate-600 cursor-not-allowed' }, entry.label + '連結待確認'),
            h('details', {},
                h('summary', { className: 'cursor-pointer rounded text-sm font-bold text-teal-800 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700' }, entry.label + '操作手冊'),
                h('ol', { className: 'list-decimal pl-5 space-y-3 text-sm leading-relaxed text-slate-700 mt-2' }, entry.steps.map((step, index) => h('li', { key: index }, step))),
                entry.id === 'jinan-web' ? illustratedGuide() : null,
                entry.publicUrl ? h('a', { href: entry.publicUrl, target: '_blank', rel: 'noopener noreferrer', className: linkClass + ' mt-3' }, '開啟' + entry.publicLabel + '（新分頁）') : null
            )
        ))
    );
}

"""Local deterministic build. Requires Pillow; never saves/displays the raw login.
Usage: python build_website_guide.py --originals /path/to/supplied/images
Without --originals, rebuild offline HTML from the existing sanitized assets.
"""
from pathlib import Path
import argparse, base64, html, re
from PIL import Image, ImageDraw, ImageFont

DOCS = Path(__file__).resolve().parent
ASSETS = DOCS / 'assets/website-guide'
FONT = '/System/Library/Fonts/STHeiti Medium.ttc'

def sanitize_login(source):
    im = Image.open(source).convert('RGB')
    # First irreversible raster edit: both entire field interiors, inclusive.
    ImageDraw.Draw(im).rectangle((239, 284, 378, 335), fill=(255,255,255))
    clean = Image.new('RGB', im.size, 'white')
    clean.paste(im)
    return clean

def panel(im, filename, lines, frames, width=None):
    width = width or im.width + 40
    top = 110
    out = Image.new('RGB', (width, im.height + top + 24), '#f1f5f9')
    x = (width-im.width)//2
    out.paste(im, (x,top))
    d = ImageDraw.Draw(out); font = ImageFont.truetype(FONT, 23)
    for i, line in enumerate(lines): d.text((20, 14+i*32), line, font=font, fill='#134e4a')
    for number, box in frames:
        l,t,r,b = box; box=(l+x,t+top,r+x,b+top)
        d.rectangle(box, outline='#dc2626', width=3)
        # Numeric markers outside controls; no button text is covered.
        cx=max(14,l+x-15);cy=t+top-16
        d.ellipse((cx-13,cy-13,cx+13,cy+13),fill='#b91c1c')
        d.text((cx-6,cy-12),str(number),font=ImageFont.truetype(FONT,20),fill='white')
    out.save(ASSETS / filename, optimize=True)

def build_images(source):
    ASSETS.mkdir(parents=True,exist_ok=True)
    panel(sanitize_login(source/'img_f1bd046b756f.jpg'), '01-login.png',
          ['1 登入晉安後台（帳號及密碼欄已完整遮除）', '使用自己的帳號／自行輸入密碼；不留存登入資料'], [(1,(235,280,382,339))])
    im=Image.open(source/'img_920026e0c9b0.jpg').convert('RGB').crop((0,385,206,741)).resize((412,712),Image.Resampling.LANCZOS)
    panel(im,'02-sidebar.png',['2 左側選單：門診時間表','點下方子項「門診時間表內容」'],[(2,(69,650,278,691))],660)
    panel(Image.open(source/'img_8e491e32a3ab.jpg').convert('RGB'),'03-editor.png',
          ['3 先單擊下方門診表圖片（藍色為選取示例）', '4 再點第三行左側「影像」圖示；不要雙擊，不改其他欄位／SEO'],[(3,(159,417,837,590)),(4,(131,180,152,202))])
    dialog=Image.open(source/'img_d606aa66ebd7.jpg').convert('RGB')
    panel(dialog,'04-upload-tab.png',['5 點「上傳」分頁（本圖仍為影像資訊）','上傳分頁內容／選檔／上傳至伺服器：缺圖待補'],[(5,(210,107,247,131))])
    panel(dialog,'05-confirm.png',['6 保留既有尺寸及其他設定；核對完整圖片','7 綠色「確定」只套用編輯器，尚未發布'],[(6,(88,235,140,311)),(7,(396,503,501,533))])

def inline(s):
    s=html.escape(s)
    s=re.sub(r'\[([^\]]+)\]\(([^)]+)\)', lambda m: (
        f'<a href="{m[2]}"'
        + (' target="_blank" rel="noopener noreferrer"'
           if m[2] == 'https://www.ian-tainan.com/admin/login.php' else '')
        + f'>{m[1]}</a>'), s)
    s=re.sub(r'\*\*([^*]+)\*\*',r'<strong>\1</strong>',s)
    s=re.sub(r'`([^`]+)`',r'<code>\1</code>',s)
    return s

def build_html():
    md=(DOCS/'官網門診表操作手冊.md').read_text()
    parts=[]; listing=None; table=False
    for line in md.splitlines()+['']:
        kind='ul' if line.startswith('- ') else 'ol' if re.match(r'^\d\. ',line) else None
        if listing and kind!=listing: parts.append('</'+listing+'>');listing=None
        if table and not line.startswith('|'): parts.append('</tbody></table></div>');table=False
        if not line: continue
        if line.startswith('|'):
            if re.match(r'^\|[\s:|\-]+$',line): continue
            cells=line.strip('|').split('|')
            if not table: parts.append('<div class="table-scroll"><table><tbody>');table=True
            parts.append('<tr>'+''.join('<td>'+inline(c.strip())+'</td>' for c in cells)+'</tr>');continue
        image=re.fullmatch(r'!\[([^]]+)\]\(([^)]+)\)',line)
        if image:
            caption,rel=image.groups();data=base64.b64encode((DOCS/rel).read_bytes()).decode()
            parts.append(f'<figure><img src="data:image/png;base64,{data}" alt="{html.escape(caption)}"><figcaption>{inline(caption)}</figcaption></figure>');continue
        if kind:
            if not listing: parts.append('<ol start="'+line[0]+'">' if kind=='ol' else '<ul>');listing=kind
            parts.append('<li>'+inline(re.sub(r'^(?:- |\d\. )','',line)).replace('[ ]','☐')+'</li>');continue
        heading=re.match(r'^(#{1,3}) (.*)',line)
        if heading: n=len(heading[1]);parts.append(f'<h{n}>{inline(heading[2])}</h{n}>')
        else: parts.append('<p'+(' class="missing"' if '缺圖待補' in line else '')+'>'+inline(line)+'</p>')
    css='''body{margin:0;background:#f1f5f9;color:#1e293b;font:17px/1.8 system-ui,sans-serif;overflow-wrap:anywhere}main{max-width:980px;margin:auto;padding:24px;background:white}h1,h2,h3{color:#115e59;line-height:1.4}h2{margin-top:2em;border-bottom:2px solid #99f6e4;padding-bottom:8px}li{margin:12px 0}figure{margin:24px 0;break-inside:avoid}img{display:block;max-width:100%;height:auto;margin:auto}figcaption{font-weight:600;padding:12px;background:#f1f5f9}a{color:#0f766e}table{border-collapse:collapse;width:100%}td{border:1px solid #cbd5e1;padding:10px}.missing{padding:14px;border:2px dashed #b45309;background:#fffbeb}.table-scroll{overflow-x:auto}@media(max-width:600px){main{padding:16px}body{font-size:16px}ul,ol{padding-left:24px}}@media print{@page{size:A4;margin:14mm}body,main{background:white;margin:0;padding:0;font-size:11pt}h2,h3{break-after:avoid}figure img{max-height:210mm;max-width:100%;object-fit:contain}a{color:inherit;text-decoration:none}tr{break-inside:avoid}}'''
    result='<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><title>官網門診表操作手冊（離線圖解）</title><style>'+css+'</style></head><body><main><p>離線圖解版｜圖片已內嵌，可直接儲存此 HTML、離線閱讀及使用瀏覽器列印。手機可雙指放大；外部連結需連線並由人員主動開啟。</p>'+''.join(parts)+'</main></body></html>\n'
    (DOCS/'官網門診表操作手冊.html').write_text(result)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--originals',type=Path);args=parser.parse_args()
    if args.originals: build_images(args.originals)
    build_html()

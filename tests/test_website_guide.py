import base64
import importlib.util
import io
from pathlib import Path
import re
import unittest
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('guide', ROOT/'docs/build_website_guide.py')
guide = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guide)

class WebsiteGuideTests(unittest.TestCase):
    def test_complete_fields_are_flat_opaque_white_in_final_and_embedded_login(self):
        local = (ROOT/'docs/assets/website-guide/01-login.png').read_bytes()
        html = (ROOT/'docs/官網門診表操作手冊.html').read_text()
        embedded = base64.b64decode(re.search(r'data:image/png;base64,([^\"]+)', html)[1])
        for data in [local, embedded]:
            im = Image.open(io.BytesIO(data))
            self.assertEqual(im.mode, 'RGB')
            # Original coordinates + fixed (20,110) canvas offset, inclusive bounds.
            self.assertEqual(im.crop((259,394,399,446)).getextrema(), ((255,255),(255,255),(255,255)))
            self.assertFalse(im.info)

    def test_mask_covers_entire_rectangle_even_with_arbitrary_input_pixels(self):
        source = io.BytesIO()
        Image.new('RGB',(800,515),(23,57,91)).save(source,format='PNG');source.seek(0)
        clean = guide.sanitize_login(source)
        self.assertEqual(clean.crop((239,284,379,336)).getextrema(), ((255,255),(255,255),(255,255)))
        self.assertEqual(clean.getpixel((238,284)), (23,57,91))
        self.assertEqual(clean.getpixel((379,335)), (23,57,91))
        self.assertFalse(clean.info)

    def test_all_deliverable_rasters_are_flat_without_metadata(self):
        for p in (ROOT/'docs/assets/website-guide').glob('*.png'):
            im=Image.open(p);im.load()
            self.assertEqual(im.mode,'RGB');self.assertFalse(im.info)
            self.assertGreaterEqual(im.width,660)

    def test_offline_build_is_reproducible_without_originals(self):
        path=ROOT/'docs/官網門診表操作手冊.html'
        before=path.read_bytes();guide.build_html();self.assertEqual(before,path.read_bytes())
        url='https://www.ian-tainan.com/admin/login.php'
        self.assertIn(f'<a href="{url}" target="_blank" rel="noopener noreferrer">', path.read_text())
        self.assertEqual(guide.inline(f'[backend]({url})'),
                         f'<a href="{url}" target="_blank" rel="noopener noreferrer">backend</a>')
        for other in ['https://www.tainanrehab.com/admin/index.php?op=time&sub=set',
                      'https://www.tainanrehab.com/time.html',
                      'https://www.ian-tainan.com/time.html', url+'?other=1']:
            import html
            self.assertEqual(guide.inline(f'[unchanged]({other})'),
                             f'<a href="{html.escape(other)}">unchanged</a>')

if __name__ == '__main__': unittest.main()

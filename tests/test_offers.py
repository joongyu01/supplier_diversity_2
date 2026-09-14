import importlib.util
from pathlib import Path
import unittest

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]


def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / (name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


collector = module('collect_offers')
builder = module('build_offers_site')


class OfferEvidenceTests(unittest.TestCase):
    def test_goods_footer_number_never_becomes_supplier_number(self):
        html = '''<div class="f_field"><div class="ff_title">사업자등록번호</div>
                  <div class="ff_wrap">123-45-67890</div></div>
                  <footer>사업자등록번호 219-82-00333</footer>'''
        fields = collector.field_pairs(BeautifulSoup(html, 'html.parser'), 'goods')
        self.assertEqual(collector.bizno(fields['사업자등록번호']), '1234567890')
        missing = collector.field_pairs(BeautifulSoup('<footer>사업자등록번호 219-82-00333</footer>', 'html.parser'), 'goods')
        self.assertEqual(collector.bizno(missing.get('사업자등록번호')), '')

    def test_sepp_footer_does_not_supply_seller_identity(self):
        html = '''<dl><dt>기업명</dt><dd>예시기업</dd><dt>사업자번호</dt><dd>123-45-67890</dd></dl>
                  <footer><dl><dt>운영사</dt><dd>운영회사</dd><dd>사업자번호: 802-87-00203</dd></dl></footer>'''
        fields = collector.field_pairs(BeautifulSoup(html, 'html.parser'), 'sepp')
        self.assertEqual(fields['기업명'], '예시기업')
        self.assertEqual(collector.bizno(fields['사업자번호']), '1234567890')

    def test_same_name_different_numbers_never_join(self):
        registry = {'1234567890': ['1234567890', '동명기업', 64, 0, 0, 0, 64]}
        offers = [{'id': 'sepp:1', 'bizno': '1234567890', 'supplier': '동명기업'},
                  {'id': 'goods:2', 'bizno': '9999999999', 'supplier': '동명기업'},
                  {'id': 'goods:3', 'bizno': '', 'supplier': '동명기업'},
                  {'id': 'sepp:4', 'bizno': '', 'supplier': '동명기업'}]
        rows = builder.join_offers(offers, registry)
        self.assertEqual(len(rows), 4)
        self.assertEqual(sum(bool(r['masks'][0]) for r in rows), 1)
        matched = next(r for r in rows if r['bizno'] == '1234567890')
        self.assertEqual(matched['masks'], [64, 0, 0, 0, 64])

    def test_cross_source_products_join_on_number_and_preserve_source(self):
        registry = {'1234567890': ['1234567890', '등록기업', 66, 2, 0, 0, 64]}
        offers = [{'id': 'sepp:1', 'bizno': '1234567890', 'supplier': '별칭'},
                  {'id': 'goods:2', 'bizno': '1234567890', 'supplier': '다른 표기'}]
        rows = builder.join_offers(offers, registry)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['name'], '등록기업')
        self.assertEqual(len(rows[0]['offers']), 2)


if __name__ == '__main__':
    unittest.main()

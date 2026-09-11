import datetime as dt
import json
from pathlib import Path
import unittest
from scripts.build_directory import bizno, date, in_period, website


class DirectoryTests(unittest.TestCase):
    def test_date_boundaries_and_cancellation(self):
        today = '2026-09-11'
        self.assertTrue(in_period(today, today, None, today))
        self.assertTrue(in_period('2020-01-01', '9999-12-31', '9999-12-31', today))
        self.assertFalse(in_period('2026-09-12', None, None, today))
        self.assertFalse(in_period(None, '2026-09-10', None, today))
        self.assertFalse(in_period(None, None, today, today))
        self.assertEqual(date(20260911), today)
        self.assertEqual(date(dt.datetime(2026, 9, 11)), today)
        self.assertIsNone(date('not a date'))

    def test_business_identifiers_are_not_name_matches(self):
        self.assertEqual(bizno('123-45-67890'), '1234567890')
        for invalid in ['주식회사 동일', '홍길동', '123456789', '12345678901', '123456789O']:
            self.assertEqual(bizno(invalid), '')

    def test_unsafe_websites_rejected(self):
        for invalid in ['javascript:alert(1)', 'https://user:password@example.com', '없음', 'file:///tmp/a']:
            self.assertEqual(website(invalid), '')
        self.assertEqual(website('example.com'), 'https://example.com')

    def test_published_directory_has_traceable_business_contacts(self):
        data = json.loads((Path(__file__).resolve().parents[1] / 'site/data/directory.json').read_text(encoding='utf-8'))
        companies = data['suppliers']
        self.assertGreater(len(companies), 5000)
        self.assertEqual(len({c['bizno'] for c in companies}), len(companies))
        for c in companies:
            self.assertEqual(bizno(c['bizno']), c['bizno'])
            self.assertTrue(c['business'] or c['items'] or c['industries'])
            self.assertTrue(c['evidence'])
            for evidence in c['evidence']:
                self.assertIn(evidence['source'], data['sources'])
                self.assertTrue(in_period(evidence['validFrom'], evidence['validUntil'], None, data['checkDate']))
            for contact in c['contacts']:
                self.assertIn(contact['source'], data['sources'])
        for field in ['representative', 'facilityHead', 'phone', 'address']:
            self.assertTrue(any(contact.get(field) for c in companies for contact in c['contacts']), field)
        for kind, counts in data['coverage'].items():
            self.assertEqual(counts['searchableCount'], sum(kind in c['types'] for c in companies))
        self.assertTrue(any('현수막' in c['business'] or any('현수막' in item for item in c['items']) for c in companies))


if __name__ == '__main__':
    unittest.main()

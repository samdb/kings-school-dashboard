import base64
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('prepare', Path(__file__).resolve().parents[1]/'scripts/prepare_update.py')
prepare=importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)
def enc(value):
    return base64.urlsafe_b64encode(value).decode()
class PrepareTests(unittest.TestCase):
    def test_html_images_and_inline_pdf_are_queued_unread(self):
        with tempfile.TemporaryDirectory() as directory:
            data=Path(directory); (data/'documents').mkdir()
            item={'key':'abc','full_text':'See https://kings-rochester.co.uk/event/','account':'a@example.com','message_id':'123'}
            payload={'parts':[{'mimeType':'text/html','body':{'data':enc(b'<img src="https://example.org/poster.png"><a href="https://example.org/letter">letter</a>')}}, {'filename':'../../letter.pdf','mimeType':'application/pdf','body':{'data':enc(b'%PDF-test')}}]}
            result=prepare.source_record(item,payload,data,'gog')
            self.assertIn('https://example.org/poster.png',result['links'])
            self.assertIn('https://example.org/letter',result['links'])
            doc=result['documents'][0]
            self.assertEqual(doc['status'],'unread')
            self.assertEqual(Path(doc['path']).parent,data/'documents')
            self.assertEqual(Path(doc['path']).stat().st_mode & 0o777,0o600)
    def test_failed_download_stays_unread_without_claiming_a_file(self):
        with tempfile.TemporaryDirectory() as directory:
            data=Path(directory); (data/'documents').mkdir()
            item={'key':'abc','full_text':'','account':'a@example.com','message_id':'123'}
            payload={'filename':'letter.pdf','mimeType':'application/pdf','body':{'attachmentId':'opaque','size':100}}
            with patch.object(prepare.subprocess,'run') as run:
                run.return_value.returncode=4
                result=prepare.source_record(item,payload,data,'gog')
                self.assertIn('--readonly',run.call_args.args[0])
            self.assertIn('error',result['documents'][0])
            self.assertNotIn('path',result['documents'][0])

import tempfile
import unittest
from pathlib import Path
from kingsdash.public_media import export_images


class PublicMediaTests(unittest.TestCase):
    def test_only_approved_local_image_bytes_are_exported(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); approved = root/'approved'; approved.mkdir(); out = root/'docs'
            data = b'\x89PNG\r\n\x1a\nexample'
            (approved/'work.png').write_bytes(data)
            result = export_images([{'file':'work.png','alt':'Marked work'}], approved, out)
            self.assertEqual((out/result[0]['src']).read_bytes(), data)
            self.assertNotIn('file', result[0])
            (root/'private.png').write_bytes(data)
            with self.assertRaises(ValueError):
                export_images([{'file':'../private.png','alt':'No'}], approved, out)
            (approved/'linked.png').symlink_to(root/'private.png')
            with self.assertRaises(ValueError):
                export_images([{'file':'linked.png','alt':'No'}], approved, out)
            (approved/'fake.png').write_text('<script>private</script>')
            with self.assertRaises(ValueError):
                export_images([{'file':'fake.png','alt':'No'}], approved, out)

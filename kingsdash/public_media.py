"""Copy only individually approved local work images into generated public assets."""
import hashlib
import re
from pathlib import Path

MEDIA_NAME = re.compile(r'media/[a-f0-9]{64}\.(?:jpg|png|webp)')


def export_images(images, approved_dir, output_dir):
    approved_dir = Path(approved_dir).resolve()
    output_dir = Path(output_dir)
    result = []
    for picture in images:
        source = (approved_dir / picture['file']).resolve()
        if source.parent != approved_dir or not source.is_file():
            raise ValueError('Approved image missing or outside approved image directory')
        data = source.read_bytes()
        extension = source.suffix
        valid = ((extension == '.jpg' and data.startswith(b'\xff\xd8\xff')) or
                 (extension == '.png' and data.startswith(b'\x89PNG\r\n\x1a\n')) or
                 (extension == '.webp' and data[:4] == b'RIFF' and data[8:12] == b'WEBP'))
        if not valid or len(data) > 20 * 1024 * 1024:
            raise ValueError('Approved image format or size refused')
        name = 'media/' + hashlib.sha256(data).hexdigest() + extension
        target = output_dir / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        result.append({'src': name, 'alt': picture['alt'], 'caption': picture.get('caption', '')})
    return result

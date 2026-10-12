from __future__ import annotations

import base64
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

from test_build_viewer import builder


GIF = base64.b64decode('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==')


class GifExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'pdbs').mkdir()
        (self.root / 'pdbs' / '5W78.pdb').write_text('HEADER test\n')
        self.server = builder.create_viewer_server('127.0.0.1', 0, self.root, builder.ViewerSessions())
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)
        self.base = f'http://127.0.0.1:{self.server.server_address[1]}'

    def stop_server(self):
        self.server.shutdown()
        self.thread.join()
        self.server.server_close()

    def export(self, body=GIF, pdb='5W78.pdb', headers=None):
        request_headers = {'Origin': self.base, 'Content-Type': 'image/gif'}
        request_headers.update(headers or {})
        return urlopen(Request(
            f'{self.base}/__viewer/export-gif?pdb={quote(pdb)}',
            data=body, headers=request_headers, method='POST',
        ), timeout=5)

    def assert_rejected(self, status, **kwargs):
        with self.assertRaises(HTTPError) as error:
            self.export(**kwargs)
        self.assertEqual(error.exception.code, status)
        error.exception.close()
        self.assertFalse(list(self.root.glob('gifs/*.gif')))

    def test_creates_directory_saves_and_serves_unique_gifs(self):
        self.assertFalse((self.root / 'gifs').exists())
        paths = []
        for _ in range(2):
            with self.export() as response:
                self.assertEqual(response.status, 201)
                path = json.load(response)['path']
            self.assertRegex(path, r'^gifs/5W78-\d{8}-\d{6}-[0-9a-f]{32}\.gif$')
            self.assertEqual((self.root / path).read_bytes(), GIF)
            with urlopen(f'{self.base}/{path}') as response:
                self.assertEqual(response.read(), GIF)
            paths.append(path)
        self.assertNotEqual(*paths)

    def test_rejects_invalid_pdb_names(self):
        for name in ('../5W78.pdb', '..\\5W78.pdb', 'missing.pdb', '', '5W78.pdb\x00'):
            with self.subTest(name=name):
                self.assert_rejected(400, pdb=name)

    def test_rejects_cross_origin(self):
        self.assert_rejected(403, headers={'Origin': 'https://example.invalid'})

    def test_rejects_invalid_content(self):
        self.assert_rejected(415, headers={'Content-Type': 'image/png'})
        self.assert_rejected(400, body=b'not a GIF' * 3)
        self.assert_rejected(400, body=GIF[:6])
        self.assert_rejected(400, body=b'GIF89a' + b'\0' * 7 + b';')

    def test_rejects_invalid_or_excessive_lengths_before_reading_body(self):
        for length, status in [('no', 400), ('0', 400), ('-1', 400), (str(builder.MAX_GIF_BYTES + 1), 413)]:
            with self.subTest(length=length):
                self.assert_rejected(status, headers={'Content-Length': length})

    def test_accepts_encoder_padding_after_gif_trailer(self):
        # gif.js writes a padded final block; image decoders ignore bytes after ';'.
        with self.export(body=GIF + b'\0' * 64) as response:
            self.assertEqual(response.status, 201)

    def test_reports_directory_failure(self):
        (self.root / 'gifs').write_text('not a directory')
        self.assert_rejected(500)

    def test_cleans_up_partial_write(self):
        original_open = Path.open

        def failing_open(path, *args, **kwargs):
            stream = original_open(path, *args, **kwargs)
            if args == ('xb',):
                def fail(data):
                    stream.write(data[:6])
                    raise OSError('disk full')
                wrapper = mock.MagicMock()
                wrapper.__enter__.return_value.write.side_effect = fail
                wrapper.__exit__.side_effect = lambda *args: stream.close()
                return wrapper
            return stream

        with mock.patch.object(Path, 'open', failing_open):
            self.assert_rejected(500)

    def test_rejects_gifs_directory_symlink(self):
        with tempfile.TemporaryDirectory() as outside:
            (self.root / 'gifs').symlink_to(outside, target_is_directory=True)
            self.assert_rejected(500)
            self.assertEqual(list(Path(outside).iterdir()), [])

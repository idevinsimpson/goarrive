import importlib.util
import pathlib
import tempfile
import unittest


class IsolatedVideoExportTest(unittest.TestCase):
    def test_frames_remain_isolated_while_app_routes_receive_worker(self):
        script = pathlib.Path(__file__).resolve().parents[1] / 'inject_pwa_meta.py'
        spec = importlib.util.spec_from_file_location('inject_pwa', script)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        html = '<html><head></head><body>fixture</body></html>'
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            for name in ('index.html', 'login.html', 'workout-zoom-client.html', 'workout-zoom-left.html'):
                (root / name).write_text(html, encoding='utf8')
            module.DIST_DIR = folder
            module.INDEX = str(root / 'index.html')
            module.main()
            for name in ('workout-zoom-client.html', 'workout-zoom-left.html'):
                self.assertEqual((root / name).read_text(encoding='utf8'), html)
            self.assertIn('controllerchange', (root / 'login.html').read_text(encoding='utf8'))


if __name__ == '__main__':
    unittest.main()

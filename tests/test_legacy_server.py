import ast
import os
from pathlib import Path
import subprocess
import sys
import types
import unittest

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "legacy/server"

class LegacyServerTest(unittest.TestCase):
    def test_server_entrypoint_requires_explicit_configuration(self):
        env = dict(os.environ); env.pop("DISDAT_ENABLE_LEGACY_SERVER", None)
        result = subprocess.run([sys.executable, str(SERVER / "feedback_server.py")],
                                env=env, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("DISDAT_ENABLE_LEGACY_SERVER=1", result.stderr)

    def test_capture_proxy_does_not_follow_redirects(self):
        # Execute the retained route with a fake database and HTTP client.
        tree = ast.parse((SERVER / "ext_api.py").read_text())
        fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "cap_get")
        fn.decorator_list = []
        calls = []
        class FakeDB:
            def execute(self, *args): return self
            def fetchone(self): return ("https://capture.example/file", False, "ready")
            def close(self): pass
        class FakeHTTPError(Exception):
            def __init__(self, status_code, *args): self.status_code = status_code
        def get(url, **kwargs):
            calls.append((url, kwargs))
            return types.SimpleNamespace(status_code=302, content=b"")
        scope = {"Response": object, "HTTPException": FakeHTTPError, "JSONResponse": object,
                 "ab": types.SimpleNamespace(_db=lambda: FakeDB()),
                 "requests": types.SimpleNamespace(get=get),
                 "_cap_host_ok": lambda url: True, "_CAP_MAX_BYTES": 1024}
        exec(compile(ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[])), "<route>", "exec"), scope)
        with self.assertRaises(FakeHTTPError) as raised:
            scope["cap_get"]("synthetic-id", "core")
        self.assertEqual(raised.exception.status_code, 502)
        self.assertFalse(calls[0][1]["allow_redirects"])

if __name__ == "__main__":
    unittest.main()

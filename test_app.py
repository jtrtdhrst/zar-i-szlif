import json
import os
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

os.environ["SOURCE_SHA"] = "test-sha-123"

import app  # noqa: E402


class ServiceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def get(self, path):
        url = f"http://127.0.0.1:{self.port}{path}"
        try:
            with urllib.request.urlopen(url, timeout=5) as resp:
                return resp.status, json.loads(resp.read().decode()), resp.headers
        except urllib.error.HTTPError as exc:
            try:
                return exc.code, json.loads(exc.read().decode()), exc.headers
            finally:
                exc.close()

    def test_health_returns_ok(self):
        status, body, headers = self.get("/health")
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["service"], "multica-hermes-e2e")
        self.assertEqual(headers.get("Content-Type"), "application/json")

    def test_health_reports_source_sha_from_env(self):
        status, body, _ = self.get("/health")
        self.assertEqual(status, 200)
        self.assertEqual(body["source_sha"], "test-sha-123")

    def test_sum_two_and_three(self):
        status, body, _ = self.get("/sum?x=2&y=3")
        self.assertEqual(status, 200)
        self.assertEqual(body, {"sum": 5})

    def test_sum_negative_values(self):
        status, body, _ = self.get("/sum?x=-4&y=10")
        self.assertEqual(status, 200)
        self.assertEqual(body["sum"], 6)

    def test_sum_missing_parameter_is_400(self):
        status, body, _ = self.get("/sum?x=2")
        self.assertEqual(status, 400)
        self.assertIn("error", body)

    def test_sum_non_integer_is_400(self):
        status, body, _ = self.get("/sum?x=2&y=abc")
        self.assertEqual(status, 400)
        self.assertIn("error", body)

    def test_unknown_path_is_404(self):
        status, body, _ = self.get("/nope")
        self.assertEqual(status, 404)
        self.assertIn("error", body)


if __name__ == "__main__":
    unittest.main()

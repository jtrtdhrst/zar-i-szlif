"""Isolated E2E test microservice (stdlib only)."""

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

SERVICE_NAME = "multica-hermes-e2e"
REVISION = "v2"
SOURCE_SHA = os.environ.get("SOURCE_SHA", "unknown")


class Handler(BaseHTTPRequestHandler):
    server_version = "MulticaHermesE2E/1.0"

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self._send_json(
                200,
                {
                    "status": "ok",
                    "service": SERVICE_NAME,
                    "source_sha": SOURCE_SHA,
                },
            )
            return
        if parsed.path == "/version":
            self._send_json(
                200,
                {
                    "revision": REVISION,
                    "source_sha": SOURCE_SHA,
                },
            )
            return
        if parsed.path == "/sum":
            self._handle_sum(parsed.query)
            return
        self._send_json(404, {"error": "not found"})

    def _handle_sum(self, query):
        params = parse_qs(query)
        try:
            x = int(params["x"][0])
            y = int(params["y"][0])
        except (KeyError, IndexError, ValueError):
            self._send_json(
                400, {"error": "query parameters x and y must be integers"}
            )
            return
        self._send_json(200, {"sum": x + y})

    def log_message(self, fmt, *args):
        return


def main():
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8080"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"{SERVICE_NAME} listening on {host}:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()

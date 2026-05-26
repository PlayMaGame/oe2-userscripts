"""
OBS Bridge — HTTP relay → obs-websocket v5 (persistent connection)
==================================================================
Receives HTTP requests from userscripts and forwards them to OBS.

Usage:
    python obs_bridge.py

Endpoints:
    GET /filter?source=X&filter=Y&enabled=true  Toggle source filter

Config:
    OBS_WS_HOST  — default: localhost
    OBS_WS_PORT  — default: 4455
    OBS_WS_PASS  — default: "" (empty)
    BIND_PORT    — default: 3000
"""

import json
import os
import hashlib
import base64
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from websocket import create_connection, WebSocketConnectionClosedException

OBS_WS_HOST = os.environ.get("OBS_WS_HOST", "localhost")
OBS_WS_PORT = int(os.environ.get("OBS_WS_PORT", "4455"))
OBS_WS_PASS = os.environ.get("OBS_WS_PASS", "")
BIND_PORT = int(os.environ.get("BIND_PORT", "3000"))

# Try to read password from OBS config
_OBS_CONFIG = os.path.expanduser(
    "~/AppData/Roaming/obs-studio/plugin_config/obs-websocket/config.json"
)
if not OBS_WS_PASS and os.path.isfile(_OBS_CONFIG):
    try:
        with open(_OBS_CONFIG) as f:
            cfg = json.load(f)
        OBS_WS_PASS = cfg.get("server_password", "")
    except Exception:
        pass

# Persistent WebSocket connection
_ws = None
_ws_lock = threading.Lock()


def _auth_string(password: str, challenge: str, salt: str) -> str:
    secret = base64.b64encode(
        hashlib.sha256((password + salt).encode()).digest()
    ).decode()
    return base64.b64encode(
        hashlib.sha256((secret + challenge).encode()).digest()
    ).decode()


def _connect():
    global _ws
    url = f"ws://{OBS_WS_HOST}:{OBS_WS_PORT}"
    ws = create_connection(url, timeout=5)
    data = json.loads(ws.recv())
    auth_payload = {"rpcVersion": 1}
    auth_req = data.get("d", {}).get("authentication", {})
    if auth_req and OBS_WS_PASS:
        auth_payload["authentication"] = _auth_string(
            OBS_WS_PASS, auth_req["challenge"], auth_req["salt"],
        )
    ws.send(json.dumps({"op": 1, "d": auth_payload}))
    data = json.loads(ws.recv())
    if data.get("op") != 2:
        ws.close()
        raise Exception(f"Auth failed: {data}")
    _ws = ws


def _ensure_connected():
    global _ws
    if _ws is None or not _ws.connected:
        _connect()


def _send(request: dict) -> dict:
    with _ws_lock:
        _ensure_connected()
        try:
            ws.send(json.dumps({
                "op": 6,
                "d": {
                    "requestType": request["requestType"],
                    "requestData": request.get("requestData", {}),
                    "requestId": "1",
                },
            }))
            data = json.loads(ws.recv())
            return data
        except (WebSocketConnectionClosedException, Exception):
            _ws = None
            _ensure_connected()
            ws.send(json.dumps({
                "op": 6,
                "d": {
                    "requestType": request["requestType"],
                    "requestData": request.get("requestData", {}),
                    "requestId": "1",
                },
            }))
            return json.loads(ws.recv())


class Handler(BaseHTTPRequestHandler):
    def _json(self, data: dict, code: int = 200):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _error(self, msg: str, code: int = 400):
        self._json({"error": msg}, code)

    def _ok(self, result: dict = None):
        self._json({"ok": True, "result": result})

    def do_GET(self):
        params = parse_qs(urlparse(self.path).query)
        path = urlparse(self.path).path.rstrip("/")

        try:
            if path == "/filter":
                source = params.get("source", [None])[0]
                filter_name = params.get("filter", [None])[0]
                enabled = params.get("enabled", ["true"])[0]
                if not source or not filter_name:
                    return self._error("Missing ?source= and ?filter= parameters")
                result = _send({
                    "requestType": "SetSourceFilterEnabled",
                    "requestData": {
                        "sourceName": source,
                        "filterName": filter_name,
                        "filterEnabled": enabled.lower() == "true",
                    },
                })
                self._ok(result)
            else:
                self._error("Unknown endpoint", 404)
        except Exception as e:
            self._error(str(e), 500)

    def log_message(self, fmt, *args):
        print(f"[OBS] {args[0]} {args[1]}")


def main():
    print(f"[OBS Bridge] Listening on http://localhost:{BIND_PORT}")
    print(f"[OBS Bridge] Connecting to obs-websocket at {OBS_WS_HOST}:{OBS_WS_PORT}")
    _ensure_connected()
    print("[OBS Bridge] Connected — ready")
    server = HTTPServer(("0.0.0.0", BIND_PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[OBS Bridge] Shutting down")
        server.server_close()


if __name__ == "__main__":
    main()

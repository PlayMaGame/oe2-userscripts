"""
OBS Galaxy Watcher — embedded HTTP server inside OBS
=====================================================
Runs a tiny HTTP server inside OBS's built-in Python.
The OE2 userscript sends HTTP requests to toggle filters.

No external dependencies — uses only OBS API + Python stdlib.

Install: OBS → Tools → Scripts → + → select this file
         (Set Python path if needed)

Settings:
    Scene name (default: Scene)
    Filter names (default: Composite Blur, Color Correction)
    Port (default: 3000)
"""

import obspython as obs
import json
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

SCENE_NAME = "Scene"
FILTER_NAMES = ["Composite Blur", "Color Correction"]
BIND_PORT = 3000

_server = None


def set_filters(enabled):
    scene_source = obs.obs_frontend_get_current_scene()
    if not scene_source:
        return
    for fname in FILTER_NAMES:
        filt = obs.obs_source_get_filter_by_name(scene_source, fname)
        if filt:
            obs.obs_source_set_enabled(filt, enabled)
            obs.obs_source_release(filt)
    obs.obs_source_release(scene_source)


class Handler(BaseHTTPRequestHandler):
    def _reply(self, data, code=200):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_GET(self):
        params = parse_qs(urlparse(self.path).query)
        path = urlparse(self.path).path.rstrip("/")
        try:
            if path == "/galaxy":
                state = (params.get("state") or [None])[0]
                if state == "on":
                    set_filters(True)
                    self._reply({"ok": True, "action": "filters_on"})
                elif state == "off":
                    set_filters(False)
                    self._reply({"ok": True, "action": "filters_off"})
                else:
                    self._reply({"error": "?state=on or ?state=off"}, 400)
            else:
                self._reply({"error": "unknown endpoint"}, 404)
        except Exception as e:
            self._reply({"error": str(e)}, 500)

    def log_message(self, fmt, *args):
        pass


def _run_server():
    global _server
    _server = HTTPServer(("0.0.0.0", BIND_PORT), Handler)
    print(f"[OBS Galaxy Watcher] Listening on http://localhost:{BIND_PORT}")
    try:
        _server.serve_forever()
    except Exception:
        pass


def script_unload():
    global _server
    if _server is not None:
        _server.shutdown()
        _server = None


def script_description():
    return "Galaxy Watcher — toggles filters when OE2 galaxy map opens"


def script_load(settings):
    SCENE_NAME = obs.obs_data_get_string(settings, "scene_name")
    raw_filters = obs.obs_data_get_string(settings, "filter_names")
    if raw_filters:
        FILTER_NAMES[:] = [f.strip() for f in raw_filters.split(",")]
    BIND_PORT = obs.obs_data_get_int(settings, "port")
    t = threading.Thread(target=_run_server, daemon=True)
    t.start()
    print(f"[OBS Galaxy Watcher] Started — filtering on {SCENE_NAME}: {FILTER_NAMES}")


def script_update(settings):
    global SCENE_NAME, FILTER_NAMES, BIND_PORT
    SCENE_NAME = obs.obs_data_get_string(settings, "scene_name")
    raw_filters = obs.obs_data_get_string(settings, "filter_names")
    if raw_filters:
        FILTER_NAMES[:] = [f.strip() for f in raw_filters.split(",")]
    BIND_PORT = obs.obs_data_get_int(settings, "port")


def script_properties():
    props = obs.obs_properties_create()
    obs.obs_properties_add_text(props, "scene_name", "Scene Name", obs.OBS_TEXT_DEFAULT)
    obs.obs_properties_add_text(props, "filter_names", "Filter Names (comma-sep)", obs.OBS_TEXT_DEFAULT)
    obs.obs_properties_add_int(props, "port", "HTTP Port", 1024, 65535, 1)
    return props


def script_defaults(settings):
    obs.obs_data_set_default_string(settings, "scene_name", "Scene")
    obs.obs_data_set_default_string(settings, "filter_names", "Composite Blur, Color Correction")
    obs.obs_data_set_default_int(settings, "port", 3000)

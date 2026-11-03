import io
from pathlib import Path
from unittest.mock import MagicMock, patch
from vacuula_server.handlers import router
from vacuula_server.handlers.router import RouterHandler, _is_within_web_root


class MockSocket:
    def __init__(self):
        self.wfile = io.BytesIO()
        self.rfile = io.BytesIO()

    def makefile(self, mode, *args, **kwargs):
        if "w" in mode:
            return self.wfile
        return self.rfile

    def setsockopt(self, *args, **kwargs):
        pass


def create_router_handler(path="/", command="GET", headers=None, body=b""):
    mock_sock = MockSocket()
    mock_sock.rfile = io.BytesIO(body)

    # Subclass to bypass actual socket init
    class TestHandler(RouterHandler):
        def __init__(self):
            self.command = command
            self.path = path
            self.headers = headers or {}
            self.rfile = mock_sock.rfile
            self.wfile = mock_sock.wfile
            self.connection = mock_sock
            self.client_address = ("127.0.0.1", 12345)
            self._headers_buffer = []

        def send_response(self, code, message=None):
            self.status_code = code

        def send_header(self, keyword, value):
            self._headers_buffer.append((keyword, value))

        def end_headers(self):
            pass

        def log_message(self, *args):
            pass

    return TestHandler()


def test_is_within_web_root():
    assert _is_within_web_root(router.WEB_ROOT_RESOLVED / "index.html") is True
    assert _is_within_web_root(router.WEB_ROOT_RESOLVED / "assets" / "app.js") is True
    assert _is_within_web_root(Path("/etc/passwd")) is False


def test_serve_web_directory_traversal_blocked():
    handler = create_router_handler("/../../etc/passwd")
    handler.send_not_found = MagicMock()
    handler.serve_web()
    assert handler.send_not_found.called


def test_serve_web_deep_link_serves_index_html(tmp_path):
    web_dir = tmp_path / "web"
    web_dir.mkdir()
    index_file = web_dir / "index.html"
    index_file.write_text("<!doctype html><html><body>Test</body></html>")

    with patch.object(router, "WEB_ROOT", web_dir), patch.object(router, "WEB_ROOT_RESOLVED", web_dir):
        handler = create_router_handler("/robot/OPS123/map")
        handler.serve_web()
        assert handler.status_code == 200
        output = handler.wfile.getvalue().decode("utf-8")
        assert "<!doctype html>" in output


def test_serve_web_subroute_asset_rewriting(tmp_path):
    web_dir = tmp_path / "web"
    assets_dir = web_dir / "assets"
    assets_dir.mkdir(parents=True)
    js_file = assets_dir / "index-12345.js"
    js_file.write_text("console.log('loaded');")

    with patch.object(router, "WEB_ROOT", web_dir), patch.object(router, "WEB_ROOT_RESOLVED", web_dir):
        # Request originating from a subroute like /robot/OPS123/assets/index-12345.js
        handler = create_router_handler("/robot/OPS123/assets/index-12345.js")
        handler.serve_web()
        assert handler.status_code == 200
        headers_dict = dict(handler._headers_buffer)
        assert "immutable" in headers_dict.get("Cache-Control", "")
        output = handler.wfile.getvalue().decode("utf-8")
        assert "console.log('loaded');" in output


def test_serve_web_etag_caching(tmp_path):
    web_dir = tmp_path / "web"
    web_dir.mkdir()
    index_file = web_dir / "index.html"
    index_file.write_text("Test")

    with patch.object(router, "WEB_ROOT", web_dir), patch.object(router, "WEB_ROOT_RESOLVED", web_dir):
        handler = create_router_handler("/", headers={"If-None-Match": router.SERVER_BOOT_ID})
        handler.serve_web()
        assert handler.status_code == 304


def test_route_dispatching():
    # /api/ path
    handler_api = create_router_handler("/api/robots")
    with patch("vacuula_server.handlers.router.BrainslugHandler") as mock_bs:
        handler_api.route()
        assert mock_bs.called
        assert mock_bs.call_args[0][0] is router.APP_ROUTES

    # Redirect /web to /
    handler_web = create_router_handler("/web")
    handler_web.route()
    assert handler_web.status_code == 301
    assert any(k == "Location" and v == "/" for k, v in handler_web._headers_buffer)

    # Beehive accept header
    handler_beehive = create_router_handler("/links", headers={"Accept": "application/vnd.neato.beehive.v1+json"})
    with patch("vacuula_server.handlers.router.BrainslugHandler") as mock_bs:
        handler_beehive.route()
        assert mock_bs.called
        assert mock_bs.call_args[0][0] is router.BEEHIVE_ROUTES

    # Nucleo accept header
    handler_nucleo = create_router_handler("/vendors/neato/login", headers={"Accept": "application/vnd.neato.cometa.v1"})
    with patch("vacuula_server.handlers.router.BrainslugHandler") as mock_bs:
        handler_nucleo.route()
        assert mock_bs.called
        assert mock_bs.call_args[0][0] is router.NUCLEO_ROUTES


def test_router_helper_methods():
    # OPTIONS
    handler_opt = create_router_handler("/", command="OPTIONS")
    handler_opt.do_OPTIONS()
    assert handler_opt.status_code == 200

    # read_data with invalid Content-Length
    handler_bad_cl = create_router_handler("/", headers={"Content-Length": "not-a-number"})
    assert handler_bad_cl.read_data() is None
    assert handler_bad_cl.status_code == 400

    # read_data with 0 Content-Length
    handler_zero_cl = create_router_handler("/", headers={"Content-Length": "0"})
    assert handler_zero_cl.read_data() == b""

    # read_json with valid JSON
    handler_json = create_router_handler("/", headers={"Content-Length": "13"}, body=b'{"key":"val"}')
    data = handler_json.read_json()
    assert data == {"key": "val"}

    # read_json with invalid JSON
    handler_bad_json = create_router_handler("/", headers={"Content-Length": "10"}, body=b'bad-json!!')
    assert handler_bad_json.read_json() is None
    assert handler_bad_json.status_code == 400

    # send_text & download_text
    handler_text = create_router_handler()
    handler_text.send_text(b"some text")
    assert handler_text.status_code == 200

    handler_dl = create_router_handler()
    handler_dl.download_text(b"data", "file.txt")
    assert handler_dl.status_code == 200

    # Error response helpers
    handler_err = create_router_handler()
    handler_err.send_created({"id": 1})
    assert handler_err.status_code == 201

    handler_err.send_unauthorized("Denied")
    assert handler_err.status_code == 401

    handler_err.send_not_found("Missing")
    assert handler_err.status_code == 404

    handler_err.send_internal_error("Boom")
    assert handler_err.status_code == 500


import pytest
from unittest.mock import patch, MagicMock
from vacuula_server.handlers import setup as setup_handlers


class DummyRequest:
    def __init__(self, path="/api/log"):
        self.path = path
        self.command = "GET"
        self.status = 200
        self.data = None
        self.error_msg = None

    def send_ok(self, data=None):
        self.status = 200
        self.data = data

    def send_internal_error(self, message="Internal Error"):
        self.status = 500
        self.error_msg = message

    def download_text(self, data, filename, content_type=None):
        self.status = 200
        self.data = data

    def send_text(self, data):
        self.status = 200
        self.data = data


def test_get_cert(tmp_path):
    cert_file = tmp_path / "cert.pem"
    cert_file.write_bytes(b"-----BEGIN CERTIFICATE-----\nFakeCert\n-----END CERTIFICATE-----")

    with patch.object(setup_handlers, "CERT", cert_file):
        req = DummyRequest(path="/api/cert")
        setup_handlers.get_cert(req)
        assert req.status == 200
        assert b"BEGIN CERTIFICATE" in req.data


def test_get_log_and_full(tmp_path):
    log_file = tmp_path / "vacuula.log"
    log_file.write_bytes(b"Line 1\nLine 2\nLine 3\n")

    with patch("vacuula_server.handlers.setup.get_log_files", return_value=[log_file]):
        req = DummyRequest(path="/api/log")
        setup_handlers.get_log(req)
        assert req.status == 200
        assert b"Line 3" in req.data

        # Full log download
        req_full = DummyRequest(path="/api/log/full?download=true")
        setup_handlers.get_log_full(req_full)
        assert req_full.status == 200


def test_ensure_ssl_certificate_skips_when_exists(tmp_path):
    cert_file = tmp_path / "cert.pem"
    key_file = tmp_path / "privkey.pem"
    cert_file.write_text("cert")
    key_file.write_text("key")

    with patch.object(setup_handlers, "CERT", cert_file), patch.object(setup_handlers, "KEY", key_file):
        with patch("subprocess.run") as mock_run:
            setup_handlers.ensure_ssl_certificate()
            assert not mock_run.called

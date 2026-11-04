import io
import json
import os
import tarfile
import pytest
from unittest.mock import MagicMock, patch

from vacuula_server.gen3.handlers import beehive, nucleo, s3_upload
from vacuula_server.gen3 import event_handler
from vacuula_server.models.robot import Robot
from vacuula_server.gen3.data import Gen3Data
from vacuula_server.models.persistent_map import PersistentMap
from vacuula_server.models.run import Gen3__Run
from vacuula_server.db import get_session
from vacuula_server.state import PendingRequest, pending_requests, robot_connections, client_connections
from vacuula_server.constants import MAPS_DIR, UPLOADS_DIR


class MockHandler:
    def __init__(self, body=None, path="/", headers=None, client_address=("127.0.0.1", 1234)):
        self._body = body
        self.path = path
        self.headers = headers or {}
        self.client_address = client_address
        self.command = "POST"
        self.status = 200
        self.data = None
        self.error_msg = None
        self.wfile = io.BytesIO()
        self.connection = MagicMock()
        self.rfile = io.BytesIO(b"")

    def read_json(self):
        return self._body

    def read_data(self):
        if isinstance(self._body, bytes):
            return self._body
        if isinstance(self._body, str):
            return self._body.encode()
        if self._body is not None:
            return json.dumps(self._body).encode()
        return b""

    def send_ok(self, data=None):
        self.status = 200
        self.data = data

    def send_created(self, data=None, raw=True):
        self.status = 201
        self.data = data

    def send_bad_request(self, message="Bad Request"):
        self.status = 400
        self.error_msg = message

    def send_not_found(self, message="Not Found"):
        self.status = 404
        self.error_msg = message

    def send_internal_error(self, message="Internal Error"):
        self.status = 500
        self.error_msg = message

    def send_response(self, code):
        self.status = code

    def send_header(self, k, v):
        pass

    def end_headers(self):
        pass


def auth_header(serial: str) -> dict:
    return {"Authorization": f"NEATOBOT {serial}:dummyhash"}


def test_post_links_validation_and_success():
    serial = "OPS12345-aabbccddeeff"
    req = MockHandler(
        body={"name": "MyBot--IV--1.0.0", "secret_key": "sec123"},
        path="/links",
        headers=auth_header(serial),
    )

    # Missing IV test
    bad_req = MockHandler(
        body={"name": "MyBotNoIV", "secret_key": "sec123"},
        path="/links",
        headers=auth_header(serial),
    )
    beehive.post_links(bad_req)
    assert bad_req.status == 400

    # Missing fields test
    bad_req2 = MockHandler(
        body={"name": ""},
        path="/links",
        headers=auth_header(serial),
    )
    beehive.post_links(bad_req2)
    assert bad_req2.status == 400

    # Successful creation
    beehive.post_links(req)
    assert req.status == 200

    with get_session() as session:
        r = session.get(Robot, serial)
        assert r is not None
        assert r.name == "MyBot"
        g = session.get(Gen3Data, serial)
        assert g is not None
        assert g.password == "sec123"
        assert g.installed_with == "1.0.0"

    # Second call updates password
    req2 = MockHandler(
        body={"name": "MyBotUpdated--IV--1.0.1", "secret_key": "sec999"},
        path="/links",
        headers=auth_header(serial),
    )
    beehive.post_links(req2)
    assert req2.status == 200

    with get_session() as session:
        g = session.get(Gen3Data, serial)
        assert g.password == "sec999"
        assert g.installed_with == "1.0.1"


def test_persistent_maps():
    serial = "OPS12345-aabbccddeeff"
    with get_session() as session:
        session.add(Robot(serial=serial, type="neato.gen3", name="MyBot"))
        session.add(PersistentMap(id="map-1", robot=serial, name="Main", enabled=True, in_maps_list=True, base=[0.5, 0.5]))
        session.add(PersistentMap(id="map-2", robot=serial, name="Disabled", enabled=False, in_maps_list=False, base=[0.5, 0.5]))
        session.commit()

    req = MockHandler(path="/persistent_maps", headers=auth_header(serial))
    beehive.persistent_maps(req)
    assert req.status == 200
    assert len(req.data) == 1
    assert req.data[0]["id"] == "map-1"


def test_upload_init():
    serial = "OPS12345-aabbccddeeff"
    bad_req = MockHandler(body={"group_id": ""}, path="/maps/upload_jobs", headers=auth_header(serial))
    beehive.upload_init(bad_req, "maps")
    assert bad_req.status == 400

    good_req = MockHandler(
        body={"group_id": "job-123"},
        path="/maps/upload_jobs",
        headers=auth_header(serial),
    )
    beehive.upload_init(good_req, "maps")
    assert good_req.status == 201
    assert good_req.data["id"] == "job-123"
    assert good_req.data["params"]["AWSAccessKeyId"] == "maps"


def test_upload_finish_logs_and_maps(tmp_path, monkeypatch):
    serial = "OPS12345-aabbccddeeff"
    with get_session() as session:
        session.add(Robot(serial=serial, type="neato.gen3", name="MyBot"))
        session.commit()

    # Logs finish
    req_logs = MockHandler(
        body={"success": True},
        headers=auth_header(serial),
    )
    beehive.upload_finish(req_logs, "logs", "job-log-1")
    assert req_logs.status == 201

    # Maps finish with missing files
    monkeypatch.setattr(beehive, "MAPS_DIR", tmp_path / "maps")
    req_maps_fail = MockHandler(
        body={"success": True},
        headers=auth_header(serial),
    )
    beehive.upload_finish(req_maps_fail, "maps", "job-map-1")
    assert req_maps_fail.status == 400

    # Create dummy files for map upload
    job_folder = tmp_path / "maps" / serial / "job-map-1"
    job_folder.mkdir(parents=True, exist_ok=True)
    (job_folder / "FloorMap.png").write_bytes(b"dummy")
    (job_folder / "RunMap.png").write_bytes(b"dummy")
    manifest_data = {
        "robot_serial": serial,
        "run": {"id": "job-map-1", "valid_as_persistent_map": True},
    }
    (job_folder / "manifest.json").write_text(json.dumps(manifest_data))

    with patch("vacuula_server.gen3.handlers.beehive.parse_session") as mock_parse:
        mock_parse.return_value = ({"dock": {"normalised_x": 0.5, "normalised_y": 0.5}}, None)
        req_maps_ok = MockHandler(
            body={"success": True},
            headers=auth_header(serial),
        )
        beehive.upload_finish(req_maps_ok, "maps", "job-map-1")
        assert req_maps_ok.status == 200

    with get_session() as session:
        pmap = session.get(PersistentMap, "job-map-1")
        assert pmap is not None
        assert pmap.enabled is True
        run = session.get(Gen3__Run, "job-map-1")
        assert run is not None


def test_nucleo_init():
    serial = "OPS12345-aabbccddeeff"
    # Robot not found
    req_nf = MockHandler(headers=auth_header(serial))
    nucleo.nucleo_init(req_nf)
    assert req_nf.status == 404

    # Robot exists
    with get_session() as session:
        session.add(Robot(serial=serial, type="neato.gen3", name="MyBot"))
        session.add(Gen3Data(robot=serial, password="secret_pwd", installed_with="1.0.0"))
        session.commit()

    req_ok = MockHandler(headers=auth_header(serial))
    # Stream simulated incoming chunked data: size \r\n, json data \r\n, EOF
    payload = b'{"state": 1, "action": 0}\r\n'
    size_hex = f"{len(payload):x}\r\n".encode()
    req_ok.rfile = io.BytesIO(size_hex + payload)

    with patch("vacuula_server.gen3.handlers.nucleo.refresh_gen3_telemetry_async"):
        nucleo.nucleo_init(req_ok)
    assert req_ok.status == 200


def test_nucleo_init_timeout_heartbeat():
    serial = "OPS12345-aabbccddeeff"
    with get_session() as session:
        if not session.get(Robot, serial):
            session.add(Robot(serial=serial, type="neato.gen3", name="MyBot"))
            session.add(Gen3Data(robot=serial, password="secret_pwd", installed_with="1.0.0"))
            session.commit()

    req = MockHandler(headers=auth_header(serial))

    # Mock readline: first raises TimeoutError (triggers heartbeat ping), then returns payload, then EOF
    payload = b'{"state": 1, "action": 0}\r\n'
    size_hex = f"{len(payload):x}\r\n".encode()

    call_count = 0
    def mock_readline():
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise TimeoutError("Simulated idle timeout")
        elif call_count == 2:
            return size_hex
        elif call_count == 3:
            return payload
        return b""

    req.rfile.readline = mock_readline

    with patch("vacuula_server.gen3.handlers.nucleo.refresh_gen3_telemetry_async"), \
         patch("vacuula_server.gen3.handlers.nucleo.send_chunk") as mock_send_chunk:
        nucleo.nucleo_init(req)

    # First send_chunk on connect + second send_chunk on TimeoutError
    assert mock_send_chunk.call_count >= 2
    assert req.status == 200


def test_s3_upload_multipart(tmp_path, monkeypatch):
    monkeypatch.setattr(s3_upload, "UPLOADS_DIR", tmp_path / "uploads")
    serial = "OPS12345-aabbccddeeff"

    boundary = "----WebKitFormBoundaryXYZ"
    # Malformed Content-Type (no boundary)
    req_no_boundary = MockHandler(body=b"", headers={"Content-Type": "multipart/form-data"})
    s3_upload.s3_upload(req_no_boundary)
    assert req_no_boundary.status == 400

    # Build valid multipart body for logs upload
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="key"\r\n\r\n{serial}\r\n'
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="AWSAccessKeyId"\r\n\r\nlogs\r\n'
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="signature"\r\n\r\nlog-job-1\r\n'
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="robot.log"\r\n'
        f"Content-Type: text/plain\r\n\r\nHello Log Content\r\n"
        f"--{boundary}--\r\n"
    ).encode()

    req_logs = MockHandler(
        body=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    s3_upload.s3_upload(req_logs)
    assert req_logs.status == 201

    saved_file = tmp_path / "uploads" / "logs" / serial / "log-job-1" / "robot.log"
    assert saved_file.exists()
    assert saved_file.read_text() == "Hello Log Content"


def test_event_handler_robot_data():
    serial = "OPS12345-aabbccddeeff"
    event_handler.reset_robot_buffer(serial)

    # 1. Send chunk length
    event_handler.robot_data(serial, b"25\r\n")
    assert event_handler.robot_buffers[serial] == 0x25

    # 2. Setup pending request slot
    slot = PendingRequest()
    pending_requests["req-123"] = slot

    # 3. Deliver chunk with matching reqId
    payload = json.dumps({"reqId": "req-123", "result": "ok", "state": 1}).encode() + b"\r\n"
    event_handler.robot_data(serial, payload)

    assert slot.event.is_set()
    assert slot.status == 200

    # 4. SSE dispatch on eventId
    import queue
    q = queue.Queue()
    client_connections.append({"serial": serial, "queue": q})
    try:
        event_handler.robot_data(serial, b"30\r\n")
        evt_payload = json.dumps({"eventId": 100, "data": {"state": 2}}).encode() + b"\r\n"
        event_handler.robot_data(serial, evt_payload)
        assert not q.empty()
        event_data = q.get()
        if isinstance(event_data, bytes):
            event_data = event_data.decode()
        assert "event" in event_data
    finally:
        client_connections.clear()


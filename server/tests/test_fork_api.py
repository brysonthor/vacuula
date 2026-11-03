import pytest
from unittest.mock import patch, MagicMock
from vacuula_server.handlers import fork_api
from vacuula_server.models.robot import Robot
from vacuula_server.db import get_session


class DummyRequest:
    def __init__(self, body=None, path="/api/test"):
        self._body = body
        self.path = path
        self.command = "GET"
        self.status = 200
        self.data = None
        self.error_msg = None

    def read_json(self):
        return self._body

    def send_ok(self, data=None, close=True):
        self.status = 200
        self.data = data

    def send_bad_request(self, message="Bad Request"):
        self.status = 400
        self.error_msg = message

    def send_not_found(self, message="Not Found"):
        self.status = 404
        self.error_msg = message

    def send_error_response(self, status, message):
        self.status = status
        self.error_msg = message

    def send_response_data(self, content, close=True, status=200, **kwargs):
        self.status = status
        self.data = content

    def download_text(self, data, filename, content_type="text/plain"):
        self.status = 200
        self.data = data
        self.download_name = filename


def test_notifications_handlers():
    req = DummyRequest()
    fork_api.get_notifications(req)
    assert req.status == 200
    assert "discord_webhook_url" in req.data

    req_post = DummyRequest(body={"discord_webhook_url": "https://discord.com/hook", "enabled": True})
    fork_api.post_notifications(req_post)
    assert req_post.status == 200
    assert req_post.data["discord_webhook_url"] == "https://discord.com/hook"

    # Test notification
    with patch("vacuula_server.handlers.fork_api.send_test_notification") as mock_test:
        mock_test.return_value = (True, "Delivered")
        req_test = DummyRequest(body={"discord_webhook_url": "https://discord.com/hook"})
        fork_api.post_notifications_test(req_test)
        assert req_test.status == 200
        assert req_test.data["ok"] is True

        mock_test.return_value = (False, "Failed to connect")
        req_test2 = DummyRequest(body={"discord_webhook_url": "bad-url"})
        fork_api.post_notifications_test(req_test2)
        assert req_test2.status == 400


def test_telemetry_handler():
    serial = "OPS123-telem"
    req = DummyRequest(path=f"/api/robot/{serial}/telemetry")
    fork_api.get_telemetry(req, serial)
    assert req.status == 200
    assert req.data["serial"] == serial

    # With refresh=True on Gen 3
    with patch.dict(fork_api.robot_connections, {serial: MagicMock()}):
        with patch("vacuula_server.handlers.fork_api.send_robot_command_sync") as mock_sync:
            mock_sync.side_effect = [
                (200, {"data": {"model": "Botvac D7", "firmware": "4.5.3"}}),
                (200, {"data": {"battery": 100}}),
            ]
            req_ref = DummyRequest(path=f"/api/robot/{serial}/telemetry?refresh=true")
            fork_api.get_telemetry(req_ref, serial)
            assert req_ref.status == 200

    # With refresh=True on Gen 4
    g4_serial = "2126LB01A14109999"
    with patch.dict(fork_api.robot_connections, {g4_serial: MagicMock()}):
        with patch("vacuula_server.handlers.fork_api.send_robot_command_sync") as mock_sync:
            mock_sync.return_value = (200, {"body": {"model": "D9", "firmware": "1.2.3"}})
            req_ref4 = DummyRequest(path=f"/api/robot/{g4_serial}/telemetry?refresh=true")
            fork_api.get_telemetry(req_ref4, g4_serial)
            assert req_ref4.status == 200



def test_consumables_handlers():
    serial = "OPS123-consumables"
    req = DummyRequest()
    fork_api.get_consumables(req, serial)
    assert req.status == 200
    assert isinstance(req.data, list)

    req_thresh = DummyRequest(body={"consumable": "filter", "threshold_hours": 180.0})
    fork_api.post_consumable_threshold(req_thresh, serial)
    assert req_thresh.status == 200

    req_reset = DummyRequest(body={"consumable": "filter"})
    fork_api.post_consumable_reset(req_reset, serial)
    assert req_reset.status == 200


def test_schedules_handlers():
    serial = "OPS123-sched"
    req_list = DummyRequest()
    fork_api.get_server_schedules(req_list, serial)
    assert req_list.status == 200
    assert isinstance(req_list.data, list)

    req_create = DummyRequest(body={
        "name": "Evening Clean",
        "schedule_type": "one_off",
        "run_at_iso": "2026-11-03T18:00:00Z",
    })
    fork_api.post_server_schedule(req_create, serial)
    assert req_create.status == 200
    sched_id = req_create.data["id"]

    req_del = DummyRequest()
    fork_api.delete_server_schedule_handler(req_del, serial, sched_id)
    assert req_del.status == 200


def test_schedule_skip_handlers():
    serial = "OPS123-skip"
    req_get = DummyRequest()
    fork_api.get_schedule_skip_handler(req_get, serial)
    assert req_get.status == 200

    with patch("vacuula_server.handlers.fork_api.activate_skip_next_run", return_value=(200, {"ok": True})):
        req_post = DummyRequest(body={"hours": 24})
        fork_api.post_schedule_skip_handler(req_post, serial)
        assert req_post.status == 200

    with patch("vacuula_server.handlers.fork_api.cancel_skip_next_run", return_value=(200, {"ok": True})):
        req_del = DummyRequest()
        fork_api.delete_schedule_skip_handler(req_del, serial)
        assert req_del.status == 200


def test_dock_and_clean_here_handlers():
    serial = "OPS123-dock"

    # Dock handler
    with patch("vacuula_server.handlers.fork_api.dock_robot") as mock_dock:
        mock_dock.return_value = (200, {"ok": True, "message": "Returning to base"})
        req = DummyRequest()
        fork_api.post_robot_dock_handler(req, serial)
        assert req.status == 200

        mock_dock.return_value = (502, {"ok": False, "error": "Dock failed"})
        req_err = DummyRequest()
        fork_api.post_robot_dock_handler(req_err, serial)
        assert req_err.status == 502

    # Clean Here handler
    with patch("vacuula_server.handlers.fork_api.start_clean_here") as mock_clean:
        mock_clean.return_value = (200, {"started": True, "boundary_id": "b-1"})
        req = DummyRequest(body={"map_id": "m1", "vertices": [[0, 0], [1, 0], [1, 1]]})
        fork_api.post_clean_here_handler(req, serial)
        assert req.status == 200

        mock_clean.return_value = (400, {"error": "Must be on base"})
        req_err = DummyRequest(body={"map_id": "m1", "vertices": [[0, 0], [1, 0], [1, 1]]})
        fork_api.post_clean_here_handler(req_err, serial)
        assert req_err.status == 400


def test_queue_handlers():
    serial = "OPS123-queue"
    with patch("vacuula_server.handlers.fork_api.get_gen3_zone_queue", return_value={"zones": []}):
        req_get = DummyRequest()
        fork_api.get_queue_handler(req_get, serial)
        assert req_get.status == 200

    with patch("vacuula_server.handlers.fork_api.start_gen3_zone_queue", return_value=(200, {"started": True})):
        req_post = DummyRequest(body={"zones": [{"boundaryId": "z1"}]})
        fork_api.post_queue_handler(req_post, serial)
        assert req_post.status == 200

    with patch("vacuula_server.handlers.fork_api.cancel_gen3_zone_queue", return_value=(200, {"cancelled": True})):
        req_del = DummyRequest()
        fork_api.delete_queue_handler(req_del, serial)
        assert req_del.status == 200


def test_drive_handlers():
    serial = "OPS123-drive"
    with patch("vacuula_server.handlers.fork_api.drive_start", return_value=(200, {"active": True})):
        req = DummyRequest()
        fork_api.post_drive_start(req, serial)
        assert req.status == 200

    with patch("vacuula_server.handlers.fork_api.drive_input", return_value=(200, {"ack": True})):
        req = DummyRequest(body={"linear": 100, "angular": 50})
        fork_api.post_drive_input(req, serial)
        assert req.status == 200

    with patch("vacuula_server.handlers.fork_api.drive_stop", return_value=(200, {"stopped": True})):
        req = DummyRequest()
        fork_api.post_drive_stop(req, serial)
        assert req.status == 200

    with patch("vacuula_server.handlers.fork_api.drive_status", return_value=(200, {"active": False})):
        req = DummyRequest()
        fork_api.get_drive_status(req, serial)
        assert req.status == 200


def test_delete_robot_and_run():
    serial = "OPS123-delete-me"
    with get_session() as session:
        session.add(Robot(serial=serial, type="neato.gen3", name="Delete Me"))
        session.commit()

    with patch("vacuula_server.handlers.fork_api.notify_robots_changed"):
        req = DummyRequest()
        fork_api.delete_robot(req, serial)
        assert req.status == 200

    with get_session() as session:
        assert session.get(Robot, serial) is None


def test_robot_logs_and_download(tmp_path, monkeypatch):
    monkeypatch.setattr("vacuula_server.handlers.fork_api.UPLOADS_DIR", tmp_path / "uploads")
    serial = "OPS123-logtest"
    job_dir = tmp_path / "uploads" / "logs" / serial / "job-777"
    job_dir.mkdir(parents=True, exist_ok=True)
    log_file = job_dir / "robot_dump.tar.gz"
    log_file.write_bytes(b"GZIP_ARCHIVE_DATA")

    req_list = DummyRequest()
    fork_api.get_robot_logs(req_list, serial)
    assert req_list.status == 200
    assert len(req_list.data) == 1
    assert req_list.data[0]["job_id"] == "job-777"
    assert req_list.data[0]["filename"] == "robot_dump.tar.gz"

    req_dl = DummyRequest()
    fork_api.download_robot_log(req_dl, serial, "job-777", "robot_dump.tar.gz")
    assert req_dl.status == 200
    assert req_dl.data == b"GZIP_ARCHIVE_DATA"

    # Missing file returns 404
    req_nf = DummyRequest()
    fork_api.download_robot_log(req_nf, serial, "job-777", "nonexistent.log")
    assert req_nf.status == 404


def test_delete_run_and_purge_map(tmp_path, monkeypatch):
    from vacuula_server.models.persistent_map import PersistentMap, FloorPlan
    from vacuula_server.models.run import Gen3__Run, Gen4__Run

    monkeypatch.setattr("vacuula_server.handlers.fork_api.MAPS_DIR", tmp_path / "maps")
    serial3 = "OPS123-delrun3"
    run_id3 = "run-gen3-1"

    # Gen 3 setup
    map_dir3 = tmp_path / "maps" / serial3 / run_id3
    map_dir3.mkdir(parents=True, exist_ok=True)
    (map_dir3 / "FloorMap.png").write_bytes(b"png")

    with get_session() as session:
        session.add(Robot(serial=serial3, type="neato.gen3", name="G3 Bot"))
        session.add(PersistentMap(id=run_id3, robot=serial3, name="Map 3", base=[0.5, 0.5], enabled=True, in_maps_list=False))
        session.add(Gen3__Run(id=run_id3, robot=serial3, persistent_map=run_id3, run={}))
        session.commit()

    req_del3 = DummyRequest()
    fork_api.delete_run(req_del3, serial3, run_id3)
    assert req_del3.status == 200

    # Purge map
    with get_session() as session:
        session.add(PersistentMap(id="purge-map-3", robot=serial3, name="Purge Map", base=[0.5, 0.5], enabled=True, in_maps_list=True))
        session.commit()

    req_purge3 = DummyRequest()
    fork_api.purge_map(req_purge3, serial3, "purge-map-3")
    assert req_purge3.status == 200


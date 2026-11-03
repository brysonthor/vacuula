import pytest
from unittest.mock import patch, MagicMock
from vacuula_server.gen4 import app as gen4_app
from vacuula_server.models.robot import Robot
from vacuula_server.models.persistent_map import FloorPlan, Boundary
from vacuula_server.db import get_session


class DummyRequest:
    def __init__(self, body=None, path="/api/gen4"):
        self._body = body
        self.path = path
        self.command = "GET"
        self.status = 200
        self.data = None
        self.error_msg = None

    def read_json(self):
        return self._body

    def send_ok(self, data=None):
        self.status = 200
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


def test_floorplan_in_use_and_unuse():
    serial = "2126LB01A14101917"
    map_id = "fp-use-test-1"

    with get_session() as session:
        session.add(Robot(serial=serial, type="neato.gen4", name="G4 Bot"))
        session.add(FloorPlan(
            id=map_id,
            robot=serial,
            name="Living Room",
            promoted=False,
            in_maps_list=False,
            base=[0.0, 0.0, 0.0],
            origin=[0, 0],
            resolution=40.0,
            alignment=0.0,
            imgsize=[1000, 1000],
            created_at="2026-11-03T10:00:00Z",
        ))
        session.commit()

    # Mark in use
    req_use = DummyRequest()
    gen4_app.post_update_floorplan_in_use(req_use, serial, map_id)
    assert req_use.status == 200

    with get_session() as session:
        fp = session.get(FloorPlan, map_id)
        assert fp.in_maps_list is True

    # Mark in unuse
    req_unuse = DummyRequest()
    gen4_app.post_update_floorplan_in_unuse(req_unuse, serial, map_id)
    assert req_unuse.status == 200

    with get_session() as session:
        fp = session.get(FloorPlan, map_id)
        assert fp.in_maps_list is False


def test_boundaries_post_and_get():
    serial = "2126LB01A14101917"
    map_id = "fp-bounds-test-1"

    boundary_data = [
        {
            "id": "b-zone-1",
            "name": "Kitchen Zone",
            "color": "#00FF00",
            "type": "polygon",
            "vertices": [[0.1, 0.1], [0.3, 0.1], [0.3, 0.3]],
            "enabled": True,
            "function": "cleaning",
        },
        {
            "id": "b-nogo-1",
            "name": "Stairs NoGo",
            "color": "#FF0000",
            "type": "polyline",
            "vertices": [[0.5, 0.5], [0.6, 0.6]],
            "enabled": True,
            "function": "nogo",
        },
    ]

    req_post = DummyRequest(body=boundary_data)
    gen4_app.post_boundaries(req_post, serial, map_id)
    assert req_post.status == 200

    req_get = DummyRequest()
    gen4_app.get_boundaries(req_get, serial, map_id)
    assert req_get.status == 200
    assert len(req_get.data) == 2
    names = {b["name"] for b in req_get.data}
    assert "Kitchen Zone" in names
    assert "Stairs NoGo" in names


def test_post_promote():
    serial = "2126LB01A14101917"
    map_id = "fp-promote-test"

    with patch("vacuula_server.orchestrator.promote_gen4_floorplan", return_value=(200, {"promoted": True})):
        req = DummyRequest()
        gen4_app.post_promote(req, serial, map_id)
        assert req.status == 200

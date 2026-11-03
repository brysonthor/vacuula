import pytest
from vacuula_server.handlers.route_matcher import find_route, APP_ROUTES
from vacuula_server.handlers.fork_api import post_robot_dock_handler, post_clean_here_handler
from vacuula_server.handlers.app import get_robots, get_server_info


def test_find_route_exact_matches():
    handler, params = find_route(APP_ROUTES, "GET", "/api/robots")
    assert handler is get_robots
    assert params == []

    handler, params = find_route(APP_ROUTES, "GET", "/api/server")
    assert handler is get_server_info
    assert params == []


def test_find_route_dock_with_serial_extraction():
    handler, params = find_route(APP_ROUTES, "POST", "/api/robot/OPS42417-7c38660f057e/dock")
    assert handler is post_robot_dock_handler
    assert params == ["OPS42417-7c38660f057e"]

    # Gen 4 serial
    handler, params = find_route(APP_ROUTES, "POST", "/api/robot/2126LB01A14101917/dock")
    assert handler is post_robot_dock_handler
    assert params == ["2126LB01A14101917"]


def test_find_route_clean_here_with_serial_extraction():
    handler, params = find_route(APP_ROUTES, "POST", "/api/robot/OPS42417-7c38660f057e/clean-here")
    assert handler is post_clean_here_handler
    assert params == ["OPS42417-7c38660f057e"]


def test_find_route_ignores_query_params():
    handler, params = find_route(APP_ROUTES, "GET", "/api/robots?foo=bar&baz=1")
    assert handler is get_robots
    assert params == []


def test_find_route_unmatched_returns_none():
    handler, params = find_route(APP_ROUTES, "GET", "/api/unknown/endpoint")
    assert handler is None
    assert params == []

    # Wrong method
    handler, params = find_route(APP_ROUTES, "GET", "/api/robot/123/dock")
    assert handler is None
    assert params == []

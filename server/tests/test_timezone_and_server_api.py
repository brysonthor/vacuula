import os
from unittest.mock import patch
from vacuula_server import server_tz
from vacuula_server.server_tz import server_timezone, utc_offset_minutes, _resolve


def test_server_timezone_env_override():
    with patch.dict(os.environ, {"VACUULA_TZ": "America/New_York"}):
        # Test resolution with VACUULA_TZ
        resolved = _resolve()
        assert resolved == "America/New_York"
        offset = utc_offset_minutes("America/New_York")
        assert isinstance(offset, int)


def test_server_timezone_fallback_on_invalid_env():
    # If invalid string passed in VACUULA_TZ, falls back to Etc/UTC
    with patch.dict(os.environ, {"VACUULA_TZ": "Not/A_Real_Timezone_12345"}):
        resolved = _resolve()
        assert resolved == "Etc/UTC"

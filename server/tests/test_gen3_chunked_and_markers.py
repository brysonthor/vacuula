import io
import json
import pytest
from vacuula_server.gen3.chunked import iter_chunks, MessageAssembler
from vacuula_server.gen3.commands import build_command
from vacuula_server.gen3.map_utils import DOCK_MARKER_VALUES, MARKER_LABELS, RUN_BACKGROUND_VALUE, _run_label


def test_iter_chunks_single_chunk():
    data = b"5\r\nhello\r\n0\r\n\r\n"
    stream = io.BytesIO(data)
    chunks = list(iter_chunks(stream))
    assert chunks == [b"hello"]


def test_iter_chunks_multiple_chunks_and_extensions():
    data = b"5;ext=1\r\nhello\r\n6\r\n world\r\n0\r\n\r\n"
    stream = io.BytesIO(data)
    chunks = list(iter_chunks(stream))
    assert chunks == [b"hello", b" world"]


def test_message_assembler_heartbeat():
    assembler = MessageAssembler()
    # 1-byte non-JSON chunk (heartbeat)
    msgs = assembler.feed(b"\x01")
    assert msgs == [b"\x01"]


def test_message_assembler_split_json():
    assembler = MessageAssembler()
    # A single JSON message split across two chunks
    chunk1 = b'{"reqId": "42", "result": '
    chunk2 = b'"ok", "state": 1}'

    res1 = assembler.feed(chunk1)
    assert res1 == []  # waiting for next chunk

    res2 = assembler.feed(chunk2)
    assert len(res2) == 1
    decoded = json.loads(res2[0].decode())
    assert decoded["reqId"] == "42"
    assert decoded["result"] == "ok"


def test_map_markers_legend():
    assert 100 in DOCK_MARKER_VALUES
    assert 200 not in DOCK_MARKER_VALUES
    assert MARKER_LABELS[100] == "dock_marker"
    assert MARKER_LABELS[200] == "start_marker"
    assert MARKER_LABELS[150] == "end_marker"
    assert _run_label(RUN_BACKGROUND_VALUE) == "background"
    assert _run_label(100) == "dock_marker"
    assert _run_label(200) == "start_marker"
    assert _run_label(150) == "end_marker"
    assert _run_label(3) == "path_value_3"

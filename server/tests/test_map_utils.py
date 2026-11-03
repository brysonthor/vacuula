import pytest
import numpy as np
from vacuula_server.gen3 import map_utils as g3_map
from vacuula_server.gen4 import map_utils as g4_map


def test_gen3_rle_encode():
    cells = [1, 1, 1, 2, 2, 0, 0, 0, 0]
    encoded = g3_map._rle_encode(cells)
    assert encoded == [[1, 3], [2, 2], [0, 4]]


def test_gen3_classify_pixels():
    # BLACK (< 60) -> FREE (1)
    # WHITE (> 220) -> WALL (2)
    # GRAY (60..220) -> UNKNOWN (0)
    assert g3_map._classify(10) == g3_map.FREE
    assert g3_map._classify(250) == g3_map.WALL
    assert g3_map._classify(128) == g3_map.UNKNOWN


def test_gen4_rle_encode():
    cells = [5, 5, 6, 7, 7, 7]
    encoded = g4_map._rle_encode(cells)
    assert encoded == [[5, 2], [6, 1], [7, 3]]


def test_gen4_extract_metadata():
    pgm_header = (
        b"P5\n"
        b"# Neato metadata: origin_x=-40000 origin_y=-40000 resolution=40.0 alignment=0.069813\n"
        b"2000 2000\n"
        b"255\n"
    )
    md = g4_map.extract_metadata(pgm_header)
    assert md["origin_x"] == -40000
    assert md["origin_y"] == -40000
    assert md["resolution"] == 40.0
    assert md["alignment"] == 0.069813


def test_gen4_read_pgm_pixels():
    # Simple 2x2 8-bit PGM
    data = (
        b"P5\n"
        b"# Comment\n"
        b"2 2\n"
        b"255\n"
        b"\x01\x02\x03\x04"
    )
    res = g4_map._read_pgm_pixels(data)
    assert res["width"] == 2
    assert res["height"] == 2
    assert res["maxval"] == 255
    assert res["pixels"].shape == (2, 2)
    assert res["pixels"][0, 0] == 1
    assert res["pixels"][1, 1] == 4


def test_gen4_downsample_majority():
    arr = np.array([
        [1, 1, 2, 2],
        [1, 1, 2, 2],
        [3, 3, 4, 4],
        [3, 3, 4, 4],
    ], dtype=np.uint8)
    down = g4_map._downsample_majority(arr, downsample=2)
    assert down.shape == (2, 2)
    assert down[0, 0] == 1
    assert down[0, 1] == 2
    assert down[1, 0] == 3
    assert down[1, 1] == 4


def test_gen4_parse_session(tmp_path):
    import zlib
    from PIL import Image

    # Create dummy 4x4 image
    img = Image.new("L", (4, 4), color=255)
    raw_pgm = (
        b"P5\n"
        b"# Neato metadata: origin_x=0 origin_y=0 resolution=40 alignment=0\n"
        b"4 4\n"
        b"255\n"
        + bytes([0] * 16)
    )
    compressed = zlib.compress(raw_pgm)

    floor_path = tmp_path / "rank_binary.pgm.nz"
    run_path = tmp_path / "real_binary.pgm.nz"
    floor_path.write_bytes(compressed)
    run_path.write_bytes(compressed)

    out_dir = tmp_path / "output"
    floor_data, run_data = g4_map.parse_session(floor_path, run_path, out_dir)

    assert floor_data["map_type"] == "floor"
    assert run_data["map_type"] == "path"
    assert (out_dir / "floormap.json").exists()
    assert (out_dir / "runmap.json").exists()


def test_gen3_parse_session(tmp_path):
    from PIL import Image
    # Create simple FloorMap.png and RunMap.png
    floor_img = Image.new("RGBA", (20, 20), color=(255, 255, 255, 255))
    run_img = Image.new("RGBA", (20, 20), color=(0, 255, 0, 255))

    floor_file = tmp_path / "FloorMap.png"
    run_file = tmp_path / "RunMap.png"
    floor_img.save(floor_file)
    run_img.save(run_file)

    out_dir = tmp_path / "gen3_out"
    floor_data, run_data = g3_map.parse_session(floor_file, run_file, out_dir)
    assert (out_dir / "floormap.json").exists()
    assert (out_dir / "runmap.json").exists()
    assert floor_data["map_type"] == "floor"
    assert run_data["map_type"] == "run"


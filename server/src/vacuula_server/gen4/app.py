from __future__ import annotations
import logging
from vacuula_server.constants import MAPS_DIR
from vacuula_server.state import PendingRequest, robot_connections, pending_requests
from vacuula_server.db import get_session, db_commit
from vacuula_server.models.persistent_map import Boundary, FloorPlan
from sqlalchemy import select, update
from vacuula_server.gen4.handlers import robot_send_request

from typing import TYPE_CHECKING, Sequence
if TYPE_CHECKING:
    from vacuula_server.handlers.router import RouterHandler


logger = logging.getLogger(__name__)

def post_update_floorplan_in_use(req: RouterHandler, serial: str, map_id: str) -> None:
    """POST /robot/<serial>/maps/<map_id>/use - update map data"""
    with get_session() as session:
        existing = session.get(FloorPlan, map_id)
        if existing:
            existing.in_maps_list = True
        # else:
        #     # TODO: error

        if not db_commit(session, req):
            # TODO: error
            return

    req.send_ok()

def post_update_floorplan_in_unuse(req: RouterHandler, serial: str, map_id: str) -> None:
    """POST /robot/<serial>/maps/<map_id>/unuse - update map data"""
    with get_session() as session:
        existing = session.get(FloorPlan, map_id)
        if existing:
            existing.in_maps_list = False
        # else:
        #     # TODO: error

        if not db_commit(session, req):
            # TODO: error
            return

    req.send_ok()



def post_boundaries(req: RouterHandler, serial: str, map_id: str) -> None:
    """POST /robot/<serial>/maps/<map_id>/boundaries - replace map boundaries."""
    data = req.read_json()
    if data is None:
        return

    keys_required = {
        "id",
        "name",
        "color",
        "type",
        "vertices",
        "enabled",
        "function",
    }

    for boundary in data:
        if set(boundary) != keys_required:
            req.send_bad_request("not all required keys")
            return

    with get_session() as session:
        existing = session.query(Boundary).filter(
            Boundary.floorplan == map_id
        ).all()

        existing_by_id = {boundary.id: boundary for boundary in existing}
        incoming_ids = {boundary["id"] for boundary in data}

        for boundary in existing:
            if boundary.id not in incoming_ids:
                session.delete(boundary)

        for boundary in data:
            current = existing_by_id.get(boundary["id"])

            if current:
                current.name = boundary["name"]
                current.color = boundary["color"]
                current.type = boundary["type"]
                current.vertices = boundary["vertices"]
                current.enabled = boundary["enabled"]
                current.function = boundary["function"]
            else:
                session.add(Boundary(
                    id=boundary["id"],
                    floorplan=map_id,
                    name=boundary["name"],
                    color=boundary["color"],
                    type=boundary["type"],
                    vertices=boundary["vertices"],
                    enabled=boundary["enabled"],
                    function=boundary["function"],
                ))

        if not db_commit(session, req):
            return

    req.send_ok()



def get_boundaries(req: RouterHandler, serial: str, map_id: str) -> None:
    """GET /robot/<serial>/maps/<map_id>/boundaries - get boundaries"""

    with get_session() as session:
        boundaries: Sequence[Boundary] = session.execute(
            select(Boundary)
            .where(Boundary.floorplan == map_id)
        ).scalars().all()

    req.send_ok([{
        "id": b.id,
        "name": b.name,
        "enabled": b.enabled,
        "color": b.color,
        "vertices": b.vertices,
        "function": b.function,
        "type": b.type,
    } for b in boundaries if not b.id.startswith("clean-here-")])


from PIL import Image, ImageDraw
# Default pixel values. If empirical test on the robot shows different,
# tweak these.
FG_PIXEL = 0xFF  # inside zone
BG_PIXEL = 0x00  # outside zone

# Width of the rasterized line for shape="line" no-go markers (in pgm pixels).
# Increased from 3 to 9: a Neato D10 chassis is ~32 cm wide, so a 12 cm
# nominal line (3 px @ 40 mm/px) was THINNER than the robot itself. The path
# planner treats narrow tracks as informational, not as a hard obstacle, so
# the robot drove right over them. 9 px @ 40 mm/px = 36 cm -- just wider
# than the robot, forcing the planner to route around.
LINE_WIDTH_PX = 9

def _build_pgm_bytes(img: Image.Image, floorplan: FloorPlan) -> bytes:
    """Encode a PIL "L" image as PGM P5 with the Neato metadata comment header."""
    w, h = img.size
    # The rank header observed in samples has the form:
    #   P5
    #   # Neato metadata: origin_x=-40000 origin_y=-40000 resolution=40 alignment=0.008727
    #   2000 2000
    #   255
    #   <binary pixels>
    comment = (
    f"# Neato metadata: origin_x={floorplan.origin[0]} "
    f"origin_y={floorplan.origin[1]} "
    f"resolution={floorplan.resolution} "
    f"alignment={floorplan.alignment:.6f}"        # <- 6 casas decimais
    )
    # IMPORTANT: tracks are loaded into MapLayer2D<unsigned short> (2 bytes per
    # cell, big-endian per PGM P5 spec). Firmware allocates w*h*2 bytes and
    # rejects the load (PM_LOAD_FAIL) if the payload size doesn't match.
    # Reverse-engineered from /usr/bin/robot in firmware 1.7.0-2933, function
    # sub_0x00086bf0: `add x22, x20, x20` (double w*h) then `strh wzr` (store
    # 16-bit halfwords) -> vtable 0x001748d0 -> typeinfo 0x00176c10 =
    # '10MapLayer2DItE' (Itanium ABI 't' = unsigned short).
    header = (
        b"P5\r\n"
        + comment.encode("ascii") + b"\r\n"
        + f"{w} {h}".encode("ascii") + b"\r\n"
        + b"65535\r"                        # <- 2 bytes/pixel, only CR no LF
    )
    # Expand each 8-bit drawn pixel (0x00 or FG_PIXEL=0xFF) to 2 bytes
    # big-endian (0x0000 or 0xFFFF). Slice assignment on bytearray is C-level
    # fast — for a 2000x2000 canvas this is microseconds, not seconds.
    pixels_8 = img.tobytes()
    pixels_16 = bytearray(len(pixels_8) * 2)
    pixels_16[0::2] = pixels_8   # high byte (MSB in big-endian)
    pixels_16[1::2] = pixels_8   # low byte
    return header + bytes(pixels_16)

def post_promote(req: RouterHandler, serial: str, map_id: str) -> None:
    """POST /robot/<serial>/maps/<map_id>/promote - promote floorplan while preserving schedules"""
    from vacuula_server.orchestrator import promote_gen4_floorplan

    status, resp = promote_gen4_floorplan(serial, map_id, preserve_schedules=True)
    if status == 200:
        req.send_ok(resp)
    elif status == 404:
        req.send_not_found(resp.get("error", "Map not found"))
    elif status == 400:
        req.send_bad_request(resp.get("error", "Bad request"))
    else:
        req.send_error_response(status, resp.get("error", "Failed to promote floorplan"))

    

# is this really needded??? - if so it needs a major rewite lol
def _mark_targets_inside_zones(real_blob, cleaning_zones, floorplan):
    # Set byte==6 cells inside each cleaning-zone polygon to byte==4 in the
    # real.pgm payload, so the firmware's target finder has valid targets
    # (byte 3/4) even over already-cleaned floor. One-time, applied only to the
    # bytes sent in this promote; the file on disk is untouched. Returns the
    # (re-compressed) blob, or the original on any failure / no-op.
    try:
        import zlib as _zlib
        import numpy as _np
        raw = _zlib.decompress(real_blob)
        if not raw.startswith(b"P5"):
            return real_blob
        W, H = floorplan.imgsize
        # PGM (P5) pixels are 1 byte/cell when maxval <= 255, else 2 bytes/cell
        # big-endian (the firmware's zone maps are 16-bit, maxval=65535). Parse
        # maxval from the header so both widths are handled. The header may
        # carry '#' comment lines (the robot's real.pgm has a '# metadata:' line),
        # so tokens are read with a real PGM tokenizer that skips comments, NOT a
        # naive whitespace split. The pixel block is still located from the END
        # of the buffer (len - W*H*bpp), which is robust to any header layout.
        def _pgm_tokens(buf, n):
            toks, i, L = [], 0, len(buf)
            while len(toks) < n and i < L:
                c = buf[i:i+1]
                if c in b" \t\r\n":
                    i += 1
                elif c == b"#":
                    j = buf.find(b"\n", i)
                    i = L if j < 0 else j + 1
                else:
                    j = i
                    while j < L and buf[j:j+1] not in b" \t\r\n#":
                        j += 1
                    toks.append(buf[i:j]); i = j
            return toks
        toks = _pgm_tokens(raw, 4)          # P5, width, height, maxval
        if len(toks) < 4:
            logger.warning("malformed PGM header %r; skipping", toks)
            return real_blob
        try:
            maxval = int(toks[3])
        except ValueError:
            logger.warning("bad PGM maxval %r; skipping", toks[3])
            return real_blob
        bpp = 2 if maxval > 255 else 1
        dtype = _np.dtype(">u2") if bpp == 2 else _np.uint8
        npix = W * H * bpp
        pixels_offset = len(raw) - npix
        if pixels_offset < 4 or pixels_offset > 1024:
            logger.warning("real.pgm size mismatch (offset=%d, bpp=%d); skipping", pixels_offset, bpp)
            return real_blob
        arr = _np.frombuffer(raw[pixels_offset:pixels_offset + npix], dtype=dtype).reshape(H, W).copy()
        changed = 0
        for boundary in cleaning_zones:
            if boundary.type != "polygon" or len(boundary.vertices) < 3:
                continue
            pts = [(p[0] * W, p[1] * H) for p in boundary.vertices]
            mimg = Image.new("L", (W, H), 0)
            ImageDraw.Draw(mimg).polygon(pts, fill=1, outline=1)
            mask = _np.array(mimg, dtype=bool)
            targets = mask & (arr == 6)
            n = int(targets.sum())
            if n:
                arr[targets] = 4
                changed += n
        if not changed:
            logger.info("no byte=6 cells inside cleaning polygons; unchanged")
            return real_blob
        new_raw = raw[:pixels_offset] + arr.tobytes()
        logger.info("marked %d cells (6->4) inside cleaning polygons", changed)
        return _zlib.compress(new_raw, level=9)
    except Exception as _e:
        logger.exception("failed (non-fatal): %s: %s", type(_e).__name__, _e)
        return real_blob


def demote_floorplan(serial: str, map_id: str) -> tuple[bool, str]:
    """Returns (ok, message); (False, ...) when the robot is not connected so
    callers can answer 400 instead of raising."""
    conn = robot_connections.get(serial)
    if conn is None:
        return False, "Robot not connected"

    payload = {
        "ability": "maps.demote_floorplan",
        "rank_uuid":     map_id,
    }

    robot_send_request(conn, payload)

    with get_session() as session:
        session.execute(
            update(FloorPlan)
            .where(
                FloorPlan.robot == serial,
                FloorPlan.id == map_id,
            )
            .values(promoted=False)
        )

        session.commit()
    return True, ""

def delete_demote_floorplan(req: RouterHandler, serial: str, map_id: str) -> None:
    """DELETE /robot/<serial>/maps/<map_id> - demote floorplan"""

    ok, msg = demote_floorplan(serial, map_id)
    if not ok:
        req.send_bad_request(msg)
        return

    req.send_ok()



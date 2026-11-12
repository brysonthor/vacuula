from __future__ import annotations

from vacuula_server.generation import Generation
from socketserver import StreamRequestHandler
from ssl import SSLSocket
import threading
import time
# Shared robot connection

class Gen2Gen3Conn:
    def __init__(self, password: str, wfile: StreamRequestHandler.wfile, sock=None):
        self.password = password
        self.wfile = wfile
        # Underlying socket, used to unblock the reader thread when the
        # session is torn down or superseded by a newer login.
        self.sock = sock

class Gen4Conn:
    def __init__(self, socket: SSLSocket):
        self.socket = socket

class RobotConn:
    def __init__(self, serial: str, gen: Generation, conn: Gen2Gen3Conn | Gen4Conn, connected_at: float | None = None):
        self.serial = serial
        self.gen = gen
        self.conn = conn
        self.connected_at: float = connected_at if connected_at is not None else time.time()
        # self.addr = addr

        self.stop_event = threading.Event()

# from dataclasses import dataclass
# from typing import Literal, Union
# from ssl import SSLSocket


# @dataclass
# class Gen2Gen3Conn:
#     password: str
#     wfile: object  # replace with correct type


# @dataclass
# class Gen4Conn:
#     socket: SSLSocket


# @dataclass
# class RobotConn23:
#     gen: Literal[2, 3]
#     serial: str
#     conn: Gen2Gen3Conn


# @dataclass
# class RobotConn4:
#     gen: Literal[4]
#     serial: str
#     conn: Gen4Conn


# RobotConn = Union[RobotConn23, RobotConn4]
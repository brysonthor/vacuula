from __future__ import annotations
import logging
import ssl
from vacuula_server.env import GEN3_PORT, HOST_IP
from vacuula_server.handlers.router import RouterHandler
from vacuula_server.logger import LoggingThreadingHTTPServer
from vacuula_server.tls import create_ssl_context
import threading

logger = logging.getLogger(__name__)

# Upper bound for a client to complete the TLS handshake.
TLS_HANDSHAKE_TIMEOUT_S = 20


class Gen3HTTPSServer(LoggingThreadingHTTPServer):
    """HTTPS server that performs the TLS handshake in the per-request thread.

    Wrapping the *listening* socket makes accept() perform a blocking
    handshake with no timeout inside the single serve_forever thread, so one
    client stalling mid-handshake (e.g. a robot dropping off Wi-Fi) would block
    every subsequent Gen 3 connection. Handshake failures were also silently
    swallowed by socketserver; they are now logged.
    """

    def __init__(self, server_address, handler_class, ssl_context: ssl.SSLContext):
        super().__init__(server_address, handler_class)
        self.ssl_context = ssl_context

    def process_request_thread(self, request, client_address):
        try:
            request.settimeout(TLS_HANDSHAKE_TIMEOUT_S)
            tls_request = self.ssl_context.wrap_socket(request, server_side=True)
            # Restore blocking mode for the request handler (default for HTTP).
            tls_request.settimeout(None)
        except (OSError, ValueError) as e:
            logger.warning("Gen3 TLS handshake failed from %s: %s", client_address, e)
            self.shutdown_request(request)
            return
        super().process_request_thread(tls_request, client_address)


def start():
    # HTTPS server on gen3 port
    context = create_ssl_context()
    https_server_1 = Gen3HTTPSServer((HOST_IP, GEN3_PORT), RouterHandler, context)
    https_1_thread = threading.Thread(target=https_server_1.serve_forever, daemon=True)
    https_1_thread.start()
    logger.info("Gen3 listening on https://%s:%d", HOST_IP, GEN3_PORT)

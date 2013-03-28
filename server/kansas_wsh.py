# Implementation of Kansas websocket handler.
import logging
import json

from server.websocket_utils import JSONOutput
from server.websocket_handlers import KansasInitHandler

initHandler = KansasInitHandler()

def web_socket_do_extra_handshake(request):
    pass

def web_socket_transfer_data(request):
    """Drives the state machine for each connected client."""

    currentHandler = initHandler
    while True:
        line = request.ws_stream.receive_message()
        if not line:
            logging.info("Socket closed")
            return
        try:
            req = json.loads(line)
            logging.debug("Parsed json %s", req)
            logging.info("Handler %s", type(currentHandler))
            logging.info("Request type %s", req['type'])
            currentHandler = currentHandler.transition(
                req['type'],
                req.get('data'),
                JSONOutput(request.ws_stream, req['type']))
        except Exception, e:
            logging.exception(e)
            request.ws_stream.send_message(
               json.dumps({'type': 'error', 'msg': str(e)}),
               binary=False)

# vi:sts=4 sw=4 et

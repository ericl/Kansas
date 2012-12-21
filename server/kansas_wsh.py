# Implementation of Kansas websocket handler.


import copy
import json
import logging
import threading
import time

import decks


class JSONOutput(object):
    """JSONOutput is a convenience class for working with websocket streams."""

    def __init__(self, stream, reqtype):
        self.stream = stream
        self.reqtype = reqtype

    def reply(self, datum):
        self.stream.send_message(
            json.dumps({
                'type': self.reqtype + '_resp',
                'data': datum,
            }), binary=False)


class KansasGameState(object):
    """KansasGameState holds the entire state of the game in json format."""

    def __init__(self):
        self.data = copy.deepcopy(decks.DEFAULT_DECK)
        self.index = self.buildIndex()

    def buildIndex(self):
        index = {}
        for loc, stack in self.data['board'].iteritems():
            for card in stack:
                index[card] = ('board', loc)
        for user, hand in self.data['hands'].iteritems():
            for card in hand:
                index[card] = ('hands', user)
        return index

    def moveCard(self, card, dest_type, dest_key, dest_orient):
        assert dest_type in ['board', 'hands']
        assert type(dest_key) in [int, str, unicode]
        assert dest_orient in range(-4, 5)

        # Removes card from where it was.
        src_type, src_key = self.index[card]
        self.data[src_type][src_key].remove(card)
        if len(self.data[src_type][src_key]) == 0:
            del self.data[src_type][src_key]

        # Places card into new position.
        if dest_key not in self.data[dest_type]:
            self.data[dest_type][dest_key] = []
        self.data[dest_type][dest_key].append(card)
        self.data['orientations'][card] = dest_orient
        self.data['zIndex'][card] = max(self.data['zIndex'].values()) + 1
        self.index[card] = (dest_type, dest_key)


class KansasHandler(object):
    """KansasHandler implements a state machine where the transitions are
       driven by requests, and states correspond to KansasHandler classes."""

    def __init__(self):
        self._lock = threading.RLock()
        self.handlers = {
            'ping': self.handle_ping,
        }

    def handle_ping(self, request, output):
        logging.debug("served ping")
        output.reply('pong')

    def transition(self, reqtype, request, output):
        """Returns the handler instance that should serve future requests."""

        if reqtype not in self.handlers:
            raise Exception("Unexpected request type '%s'" % reqtype)
        logging.debug("serving %s", reqtype)
        self.handlers[reqtype](request, output)
        return self


class KansasInitHandler(KansasHandler):
    """The request handler for new websocket connections."""

    def __init__(self):
        KansasHandler.__init__(self)
        self.handlers['connect'] = self.handle_connect
        self.games = {}

    def handle_connect(self, request, output):
        with self._lock:
            logging.info(request)
            if request['gameid'] in self.games:
                logging.info("Joining existing game '%s'", request['gameid'])
                game = self.games[request['gameid']]
                game.streams[output.stream] = request['user']
            else:
                logging.info("Creating new game '%s'", request['gameid'])
                game = KansasGameHandler(request['user'], output.stream)
                self.games[request['gameid']] = game
        with game._lock:
            output.reply(game.snapshot())


    def transition(self, reqtype, request, output):
        if reqtype == 'connect':
            KansasHandler.transition(self, reqtype, request, output)
            return self.games[request['gameid']]
        else:
            return KansasHandler.transition(self, reqtype, request, output)


class KansasGameHandler(KansasHandler):
    """The request handler for clients in a game."""

    def __init__(self, creator, creatorOutputStream):
        KansasHandler.__init__(self)
        self._seqno = 1000
        self._state = KansasGameState()
        self.handlers['broadcast'] = self.handle_broadcast
        self.handlers['move'] = self.handle_move
        self.handlers['resync'] = self.handle_resync
        self.streams = {creatorOutputStream: creator}

    def handle_move(self, req, output):
        """Processes and broadcasts a globally ordered series of updates."""

        with self._lock:
            move = req['move']
            dest_t = move['dest_type']
            dest_k = move['dest_key']
            seqno = self.apply_move(move)
            logging.info("Accepted move request '%s'", req)
            self.broadcast(
                set(self.streams.keys()),
                'update',
                {
                    # move delta is sufficient in most cases
                    'move': move,
                    # z_stack enforces stack ordering
                    'z_stack': self._state.data[dest_t][dest_k],
                    # z_index enforces global ordering
                    'z_index': self._state.data['zIndex'][move['card']],
                    # seqno is a sanity check for the client
                    'seqno': seqno,
                })

    def handle_broadcast(self, req, output):
        with self._lock:
            self.broadcast(
                set(self.streams.keys()) - {output.stream},
                'broadcast_message',
                req)
            output.reply('ok')

    def handle_resync(self, req, output):
        with self._lock:
            output.reply(self.snapshot())

    def snapshot(self):
        with self._lock:
            return self._state.data, self._seqno

    def nextseqno(self):
        with self._lock:
            self._seqno += 1
            return self._seqno

    def broadcast(self, streamSet, reqtype, data):
        logging.info("Broadcasting %s: '%s'", reqtype, data)
        start = time.time()
        for stream in streamSet:
            try:
                stream.send_message(
                    json.dumps({
                        'type': reqtype,
                        'data': data,
                    }),
                    binary=False)
            except Exception, e:
                logging.exception(e)
                logging.warning("Removing broken stream %s", stream)
                del self.streams[stream]
        logging.info("Broadcast took %.2f seconds" % (time.time() - start))

    def apply_move(self, move):
        """Applies move and increments seqno, returning True on success."""
        with self._lock:
            card = move['card']
            dest_type = move['dest_type']
            dest_key = move['dest_key']
            dest_orient = move['dest_orient']
            self._state.moveCard(card, dest_type, dest_key, dest_orient)
            return self.nextseqno()



initHandler = KansasInitHandler()


def web_socket_do_extra_handshake(request):
    pass


def web_socket_transfer_data(request):
    """Drives the state machine for each connected client."""

    currentHandler = initHandler
    while True:
        line = request.ws_stream.receive_message()
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

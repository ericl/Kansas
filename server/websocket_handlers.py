'''
Created on Mar 27, 2013

@author: huangchenglai
'''
import threading
import logging
import random
import time
import json
import collections

from server.loaders import UrlLoader
from server.states import KansasGameState


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
        
        # Transitions to the current state by default.
        return self


class KansasInitHandler(KansasHandler):
    """The request handler created for each new websocket connection."""

    def __init__(self):
        KansasHandler.__init__(self)
        self.handlers['connect'] = self.handle_connect
        self.handlers['connect_searchapi'] = self.handle_connect_searchapi
        self.games = {}

    def handle_connect_searchapi(self, request, output):
        output.reply("ok")

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

        # Atomically registers the player with the game handler.
        with game._lock:
            output.reply(game.snapshot())

    def transition(self, reqtype, request, output):
        if reqtype == 'connect':
            KansasHandler.transition(self, reqtype, request, output)
            return self.games[request['gameid']]
        elif reqtype == 'connect_searchapi':
            KansasHandler.transition(self, reqtype, request, output)
            return KansasSearchHandler()
        else:
            return KansasHandler.transition(self, reqtype, request, output)


class KansasSearchHandler(KansasHandler):
    """There is a singleton search handler for all search api requests."""

    def __init__(self):
        KansasHandler.__init__(self)
        self.handlers['query'] = self.handle_query
        self.urlLoader = UrlLoader()

    def handle_query(self, request, output):
        try:
            try:
                logging.info("Trying exact match")
                urls = self.urlLoader.cardNameToUrls(request['term'], True)
                output.reply({'urls': urls, 'tags': request.get('tags')})
            except Exception:
                logging.info("Trying inexact match")
                urls = self.urlLoader.cardNameToUrls(request['term'], False)
                output.reply({'urls': urls, 'tags': request.get('tags')})
        except Exception:
            output.reply({'error': 'No match found.', 'tags': request.get('tags')})


class KansasGameHandler(KansasHandler):
    """There is single game handler for each game, shared among all players.
       Enforces a global ordering on game-state update broadcasts."""

    def __init__(self, creator, creatorOutputStream):
        KansasHandler.__init__(self)
        self._seqno = 1000
        self._state = KansasGameState()
        self.handlers['broadcast'] = self.handle_broadcast
        self.handlers['move'] = self.handle_move
        self.handlers['bulkmove'] = self.handle_bulkmove
        self.handlers['stackop'] = self.handle_stackop
        self.handlers['resync'] = self.handle_resync
        self.handlers['reset'] = self.handle_reset
        self.streams = {creatorOutputStream: creator}

    def handle_stackop(self, req, output):
        with self._lock:
            dest_t = req['dest_type']
            dest_k = req['dest_key']
            stack = self._state.data[dest_t][dest_k]
            if req['op_type'] == 'invert':
                stack.reverse()
                self._state.reverseOrientations(stack)
            elif req['op_type'] == 'reverse':
                stack.reverse()
            elif req['op_type'] == 'shuffle':
                self._state.resetOrientations(stack)
                random.shuffle(stack)
            else:
                raise Exception("invalid stackop type")
            self._state.reassignZ(stack)
            self.broadcast(
                set(self.streams.keys()),
                'stackupdate',
                {
                    'op': req,
                    'z_stack': stack,
                    'orient': [self._state.data['orientations'][c] for c in stack],
                    'seqno': self.nextseqno(),
                })

    def handle_bulkmove(self, req, output):
        with self._lock:
            logging.info("Starting bulk move.")
            updatebuffer = collections.defaultdict(list)
            for move in req['moves']:
                try:
                    dest_t = move['dest_type']
                    dest_k = move['dest_key']
                    if dest_t == 'hands':
                        if move['dest_prev_type'] == 'board':
                            move['dest_orient'] = 1
                        elif move['dest_orient'] > 0:
                            move['dest_orient'] = 1
                        else:
                            move['dest_orient'] = -1
                    src_type, src_key, seqno = self.apply_move(move)
                    updatebuffer[dest_t, dest_k].append({
                        'move': move,
                        'old_type': src_type,
                        'old_key': src_key,
                    })
                except:
                    logging.warning("Ignoring bad move: " + str(move));
            msg = []
            for (dest_t, dest_k), updates in updatebuffer.iteritems():
                msg.append({
                    'dest_type': dest_t,
                    'dest_key': dest_k,
                    'updates': updates,
                    'z_stack': self._state.data[dest_t][dest_k],
                })
            self.broadcast(set(self.streams.keys()), 'bulkupdate', msg)

    def handle_move(self, req, output):
        with self._lock:
            move = req['move']
            dest_t = move['dest_type']
            dest_k = move['dest_key']
            if dest_t == 'hands':
                if move['dest_prev_type'] == 'board':
                    move['dest_orient'] = 1
                elif move['dest_orient'] > 0:
                    move['dest_orient'] = 1
                else:
                    move['dest_orient'] = -1
            src_type, src_key, seqno = self.apply_move(move)
            logging.info("Accepted move request '%s'", req)
            self.broadcast(
                set(self.streams.keys()),
                'update',
                {
                    # move delta is sufficient in most cases
                    'move': move,
                    # z_stack enforces stack ordering
                    'z_stack': self._state.data[dest_t][dest_k],
                    # seqno is a sanity check for the client
                    'seqno': seqno,
                    # information about the origin of the move
                    'old_type': src_type,
                    'old_key': src_key,
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

    def handle_reset(self, req, output):
        with self._lock:
            self._state = KansasGameState()
            self.broadcast(
                set(self.streams.keys()),
                'reset',
                self.snapshot())

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
                        'time': time.time(),
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
            src_type, src_key = self._state.moveCard(
                card, dest_type, dest_key, dest_orient)
            return src_type, src_key, self.nextseqno()
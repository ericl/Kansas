# Implementation of Kansas websocket handler.



import Image
import copy
import json
import logging
import os
import random
import threading
import time
import urllib2
import decks


kSmallImageSize = (140, 200)
kServingPrefix = ''
kCachePath = '../cache'


if not os.path.exists(kCachePath):
    os.makedirs(kCachePath)


class CachingLoader(dict):
    def __init__(self, values):
        start = time.time()
        dict.__init__(self, copy.deepcopy(values))
        self.oldPrefix = self['resource_prefix']
        logging.info("new CachingLoader")

        # The cached files are assumed served from this path by another server.
        self['resource_prefix'] = kServingPrefix

        def download(suffix):
            url = self.toResource(suffix)
            path = self.cachePath(url)
            if not os.path.exists(path):
                logging.info("GET " + url)
                imgdata = urllib2.urlopen(url).read()
                with open(path, 'w') as f:
                    f.write(imgdata)
            return path

        # Caches front image urls.
        for card, suffix in self['urls'].items():
            # Downloads large version of images.
            large_path = download(suffix)
            self['urls'][card] = large_path

            # Generates small version of images.
            small_path = large_path[:-4] + ('@%dx%d.jpg' % kSmallImageSize)
            if not os.path.exists(small_path):
                self.resize(large_path, small_path)
            self['urls_small'][card] = small_path

        # Caches the back image.
        self['default_back_url'] = download(self['default_back_url'])

        # Caches other back urls.
        for card, suffix in self['back_urls'].items():
            self['back_urls'][card] = download(suffix)

        logging.info("Cache load in %.3f seconds" % (time.time() - start))

    def cachePath(self, url):
        return os.path.join(kCachePath, hex(hash('$' + url))[2:] + '.jpg')

    def resize(self, large_path, small_path):
        """Resizes image found at large_path and saves to small_path."""
        logging.info("Resize %s -> %s" % (large_path, small_path))
        Image.open(large_path)\
             .resize(kSmallImageSize, Image.ANTIALIAS)\
             .save(small_path)

    def toResource(self, url):
        if url.startswith('http:'):
            return url
        else:
            return self.oldPrefix + url


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
                'time': time.time(),
            }), binary=False)


class KansasGameState(object):
    """KansasGameState holds the entire state of the game in json format."""

    def __init__(self):
        self.data = CachingLoader(decks.DEFAULT_MAGIC_DECK)
        self.index = self.buildIndex()
        self.assignZIndices()
        self.assignOrientations()

    def assignZIndices(self):
        if self.data['zIndex']:
            i = max(self.data['zIndex'].values())
        else:
            i = 0
        for loc, stack in self.data['board'].iteritems():
            for card in stack:
                if card not in self.data['zIndex']:
                    self.data['zIndex'][card] = i
                    i += 1
                if card not in self.data['orientations']:
                    self.data['orientations'][card] = -1
        for user, hand in self.data['hands'].iteritems():
            for card in hand:
                if card not in self.data['zIndex']:
                    self.data['zIndex'][card] = i
                    i += 1
                if card not in self.data['orientations']:
                    self.data['orientations'][card] = -1

    def reverseOrientations(self, stack):
        for card in stack:
            self.data['orientations'][card] *= -1

    def resetOrientations(self, stack):
        canonicalOrient = self.data['orientations'][stack[-1]]
        for card in stack:
            self.data['orientations'][card] = canonicalOrient

    def reassignZ(self, stack):
        i = max(self.data['zIndex'].values()) + 1
        for card in stack:
            self.data['zIndex'][card] = i
            i += 1

    def assignOrientations(self):
        i = 0
        for loc, stack in self.data['board'].iteritems():
            for card in stack:
                self.data['zIndex'][card] = i
                i += 1
        for user, hand in self.data['hands'].iteritems():
            for card in hand:
                self.data['zIndex'][card] = i
                i += 1

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
        if dest_type == 'board':
            dest_key = int(dest_key)
        else:
            assert type(dest_key) in [str, unicode], type(dest_key)
        assert dest_orient in range(-4, 5)

        src_type, src_key = self.index[card]
        # Removes card from where it was.
        self.data[src_type][src_key].remove(card)
        if len(self.data[src_type][src_key]) == 0:
            del self.data[src_type][src_key]

        # Places card into new position.
        if dest_key not in self.data[dest_type]:
            self.data[dest_type][dest_key] = []
        self.data[dest_type][dest_key].append(card)
        self.index[card] = (dest_type, dest_key)

        self.data['orientations'][card] = dest_orient
        self.data['zIndex'][card] = max(self.data['zIndex'].values()) + 1

        return src_type, src_key


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

        # Atomically registers the player with the game handler.
        with game._lock:
            output.reply(game.snapshot())

    def transition(self, reqtype, request, output):
        if reqtype == 'connect':
            KansasHandler.transition(self, reqtype, request, output)
            return self.games[request['gameid']]
        else:
            return KansasHandler.transition(self, reqtype, request, output)


class KansasGameHandler(KansasHandler):
    """There is single game handler for each game, shared among all players.
       Enforces a global ordering on game-state update broadcasts."""

    def __init__(self, creator, creatorOutputStream):
        KansasHandler.__init__(self)
        self._seqno = 1000
        self._state = KansasGameState()
        self.handlers['broadcast'] = self.handle_broadcast
        self.handlers['move'] = self.handle_move
        self.handlers['stackop'] = self.handle_stackop
        self.handlers['resync'] = self.handle_resync
        self.handlers['reset'] = self.handle_reset
        self.streams = {creatorOutputStream: creator}

    def handle_stackop(self, req, output):
        with self._lock:
            dest_t = req['dest_type']
            dest_k = req['dest_key']
            stack = self._state.data[dest_t][dest_k]
            if req['op_type'] == 'reverse':
                stack.reverse()
                self._state.reverseOrientations(stack)
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
                    'z_index': [self._state.data['zIndex'][c] for c in stack],
                    'orient': [self._state.data['orientations'][c] for c in stack],
                    'seqno': self.nextseqno(),
                })

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
                    # z_index enforces global ordering
                    'z_index': self._state.data['zIndex'][move['card']],
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

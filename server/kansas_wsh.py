# Implementation of Kansas websocket handler.

import copy
import collections
import json
import logging
import os
import random
import threading
import time
import urllib2
import re
import decks

try:
    import Image
    haveImaging = True
except:
    logging.warning("Failed to import imaging module.")
    haveImaging = False

kSmallImageSize = (92, 131)
kServingPrefix = ''
kLocalServingAddress = 'http://localhost:8000/'
kCachePath = '../cache'


if not os.path.exists(kCachePath):
    os.makedirs(kCachePath)


# TODO split into loader module
lookupCache = {}
def CardNameToUrls(name, exact=False):
    key = (name, exact)
    if key in lookupCache:
        val = lookupCache[key]
        if not val:
            raise Exception
        return val
    url = "http://magiccards.info/query?q=%s%s&v=card&s=cname" %\
        ('!' if exact else 'l:en+', '+'.join(name.split()))
    logging.info("GET " + url)
    req = urllib2.Request(url)
    stream = urllib2.urlopen(req)
    data = stream.read()
    matches = re.finditer(
        '"http://magiccards.info/scans/en/[a-z0-9]*/[a-z0-9]*.jpg"',
        data)
    try:
        urls = [m.group() for m in matches]
        if urls:
            logging.info("found " + ','.join(urls))
            lookupCache[key] = urls
            return urls
        raise Exception("no matches found")
    except Exception, e:
        lookupCache[key] = None
        raise e


class CachingLoader(dict):
    def __init__(self, values):
        start = time.time()
        dict.__init__(self, copy.deepcopy(values))
        self.oldPrefix = self['resource_prefix']
        logging.info("new CachingLoader")

        # The cached files are assumed served from this path by another server.
        self['resource_prefix'] = kServingPrefix

        def download(suffix):
            url = self.toAbsoluteURL(suffix)
            path = self.cachePath(url)
            if not os.path.exists(path):
                logging.info("GET " + url)
                imgdata = urllib2.urlopen(url).read()
                with open(path, 'wb') as f:
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
                small_path = self.resize(large_path, small_path)
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
        if haveImaging:
            logging.info("Resize %s -> %s" % (large_path, small_path))
            Image.open(large_path)\
                 .resize(kSmallImageSize, Image.ANTIALIAS)\
                 .save(small_path)
            return small_path
        else:
            return large_path

    def toAbsoluteURL(self, url):
        if url.startswith('/'):
            return kLocalServingAddress + url
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
            assert type(loc) is int, "card locs must be int"
            random.shuffle(stack)
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
        i = min([self.data['zIndex'][s] for s in stack])
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
        # Implements Z-change on any action except pure orientation changes.
        if ((src_type, src_key) != (dest_type, dest_key)
                or self.data['orientations'][card] == dest_orient):
            # Removes card from where it was.
            self.data[src_type][src_key].remove(card)
            if len(self.data[src_type][src_key]) == 0:
                del self.data[src_type][src_key]

            # Places card into new position.
            if dest_key not in self.data[dest_type]:
                self.data[dest_type][dest_key] = []
            self.data[dest_type][dest_key].append(card)
            self.index[card] = (dest_type, dest_key)
            self.data['zIndex'][card] = max(self.data['zIndex'].values()) + 1

        self.data['orientations'][card] = dest_orient

        return src_type, src_key

    def remove_card(self, card):
        loc_type, loc = self.index[card]
        del self.index[card]
        self.data['board'][loc].remove(card)
    

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

    def notify_closed(self, stream):
        """Callback for when a stream has been closed."""
        pass

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

    MAX_GAMES = 5

    def __init__(self):
        KansasHandler.__init__(self)
        self.handlers['connect'] = self.handle_connect
        self.handlers['list_games'] = self.handle_list_games
        self.handlers['connect_searchapi'] = self.handle_connect_searchapi
        self.games = {}

    def handle_connect_searchapi(self, request, output):
        output.reply("ok")

    def handle_list_games(self, request, output):
        self.garbage_collect_games()
        with self._lock:
            resp = []
            ranked = sorted(
                self.games.items(),
                key=lambda (k, v): -v.last_used)
            for gameid, handler in ranked:
                resp.append({
                    'gameid': gameid,
                    'presence': handler.presence_count()})
            output.reply(resp)

    def garbage_collect_games(self):
        if len(self.games) > KansasInitHandler.MAX_GAMES:
            ranked = sorted(
                self.games.items(),
                key=lambda (k, v): -v.last_used)
            while len(self.games) > KansasInitHandler.MAX_GAMES:
                victim_id, victim = ranked.pop()
                victim.terminate()
        for gameid, game in self.games.items():
            if game.terminated:
                del self.games[gameid]

    def handle_connect(self, request, output):
        with self._lock:
            logging.info(request)
            presence = {'uuid': request['uuid'], 'name': request['user']}
            if request['gameid'] in self.games:
                logging.info("Joining existing game '%s'", request['gameid'])
                game = self.games[request['gameid']]
                game.streams[output.stream] = presence
            else:
                logging.info("Creating new game '%s'", request['gameid'])
                game = KansasGameHandler(presence, output.stream)
                self.games[request['gameid']] = game
            game.notify_presence()

        # Atomically registers the player with the game handler.
        with game._lock:
            output.reply(game.snapshot())

        with self._lock:
            self.garbage_collect_games()

    def transition(self, reqtype, request, output):
        if reqtype == 'connect':
            KansasHandler.transition(self, reqtype, request, output)
            return self.games[request['gameid']]
        elif reqtype == 'connect_searchapi':
            KansasHandler.transition(self, reqtype, request, output)
            return searchHandler
        else:
            return KansasHandler.transition(self, reqtype, request, output)


class KansasSearchHandler(KansasHandler):
    """There is a singleton search handler for all search api requests."""

    def __init__(self):
        KansasHandler.__init__(self)
        self.handlers['query'] = self.handle_query

    def handle_query(self, request, output):
        try:
            try:
                logging.info("Trying exact match")
                urls = CardNameToUrls(request['term'], True)
                output.reply({'urls': urls, 'tags': request.get('tags')})
            except Exception:
                logging.info("Trying inexact match")
                urls = CardNameToUrls(request['term'], False)
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
        self.handlers['bulkmove'] = self.handle_bulkmove
        self.handlers['stackop'] = self.handle_stackop
        self.handlers['resync'] = self.handle_resync
        self.handlers['reset'] = self.handle_reset
        self.handlers['end'] = self.handle_end
        self.handlers['remove'] = self.handle_remove
        self.streams = {creatorOutputStream: creator}
        self.last_used = time.time()
        self.terminated = False

    def handle_stackop(self, req, output):
        with self._lock:
            dest_t = req['dest_type']
            dest_k = req['dest_key']
            print dest_k, self._state.data[dest_t].keys()
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

    def handle_remove(self, req, output):
        with self._lock:
            logging.info("Starting mass excommunication.")
            for card in req:
                try: 
                    self._state.remove_card(card)           
                except:
                    logging.warning("Ignoring bad remove: " + str(card))
            self.broadcast(
                set(self.streams.keys()),
                'reset', self.snapshot())

    def snapshot(self):
        with self._lock:
            return self._state.data, self._seqno

    def handle_end(self, req, output):
        self.terminate()
    
    def terminate(self):
        logging.info("Terminating game.")
        with self._lock:
            self.terminated = True
            for s in self.streams:
                try:
                    s.send_message(
                       json.dumps({
                       'type': 'error',
                       'msg': "game terminated"}),
                       binary=False)
                    s.close_connection()
                except Exception, e:
                    logging.exception(e)
            self.streams = {}

    def nextseqno(self):
        with self._lock:
            self._seqno += 1
            return self._seqno

    def broadcast(self, streamSet, reqtype, data):
        logging.info("Broadcasting %s: '%s'", reqtype, data)
        start = time.time()
        self.last_used = start
        presence_changed = False
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
                presence_changed = True
                del self.streams[stream]
        logging.info("Broadcast took %.2f seconds" % (time.time() - start))
        if presence_changed:
            self.notify_presence()

    def presence_count(self):
        with self._lock:
            return len(self.streams)

    def notify_presence(self):
        with self._lock:
            self.broadcast(
                set(self.streams.keys()),
                'presence',
                self.streams.values())

    def notify_closed(self, stream):
        with self._lock:
            if stream in self.streams:
                del self.streams[stream]
                self.notify_presence()
            else:
                logging.warning("Stream already closed.")

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
searchHandler = KansasSearchHandler()


def web_socket_do_extra_handshake(request):
    pass


def web_socket_transfer_data(request):
    """Drives the state machine for each connected client."""

    currentHandler = initHandler
    while True:
        line = request.ws_stream.receive_message()
        if not line:
            logging.info("Socket closed")
            currentHandler.notify_closed(request.ws_stream)
            return
        try:
            req = json.loads(line)
            logging.debug("Parsed json %s", req)
            logging.debug("Handler %s", type(currentHandler))
            logging.debug("Request type %s", req['type'])
            currentHandler = currentHandler.transition(
                req['type'],
                req.get('data'),
                JSONOutput(request.ws_stream, req['type']))
        except Exception, e:
            logging.exception(e)
            request.ws_stream.send_message(
               json.dumps({'type': 'error', 'msg': str(e)}),
               binary=False)


# vim: ts=4 sw=4 et

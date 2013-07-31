# Implementation of Kansas websocket handler.

from server import config
from server import datasource
from server import imagecache
from server import namespaces

import copy
import collections
import json
import logging
import os
import random
import threading
import time

try:
    import Image
    haveImaging = True
except:
    logging.warning("Failed to import imaging module.")
    haveImaging = False


Games = namespaces.Namespace(config.kDBPath, 'Games', version=2)
ClientDB = namespaces.Namespace(config.kDBPath, 'ClientDB', version=2)


def SubspaceKey(scope, sourceid):
    return "%s::%s" % (scope, sourceid)


class KansasRedirect(Exception):
    def __init__(self, msg, url):
        Exception.__init__(self, msg)
        self.url = url


BLANK_DECK = {
    'deck_name': 'Blank deck',
    'resource_prefix': '',
    'default_back_url': '',
    'board': {},
    'hands': {},
    'orientations': {},
    'urls_small': {},
    'urls': {},
    'back_urls': {},
    'titles': {}
}


class CachingLoader(dict):
    def __init__(self, values):
        dict.__init__(self, copy.deepcopy(values))
        self.oldPrefix = self['resource_prefix']
        if self['urls']:
            self.highest_id = max(self['urls'].keys())
        else:
            self.highest_id = 0

        # The cached files are assumed served from this path by another server.
        self['resource_prefix'] = config.kServingPrefix

    def new_card(self, front_url):
        """Returns id of new card."""

        self.highest_id += 1
        new_id = self.highest_id
        large_path = self['urls'][new_id] = self.download(front_url)
        small_path = os.path.join(
            config.kCachePath,
            os.path.basename(large_path)[:-4]
                + ('@%dx%d.jpg' % config.kSmallImageSize))
        if not os.path.exists(small_path):
            small_path = self.resize(large_path, small_path)
        self['urls_small'][new_id] = small_path
        self['orientations'][new_id] = -1
        return new_id

    def download(self, suffix):
        url = self.toLocalURL(suffix)
        return imagecache.Cached(url)

    def resize(self, large_path, small_path):
        """Resizes image found at large_path and saves to small_path."""
        if haveImaging:
            logging.info("Resize %s -> %s" % (large_path, small_path))
            Image.open(large_path)\
                 .resize(config.kSmallImageSize, Image.ANTIALIAS)\
                 .save(small_path)
            return small_path
        else:
            return large_path

    def toLocalURL(self, url):
        if url.startswith('/') \
                or url.startswith(config.kCachePath) \
                or url.startswith('http:'):
            return url
        else:
            return self.oldPrefix + url


class JSONOutput(object):
    """JSONOutput is a convenience class for working with websocket streams."""

    def __init__(self, stream, reqtype, future_id):
        self.stream = stream
        self.reqtype = reqtype
        self.future_id = future_id
        self.replied = False

    def reply(self, datum):
        self.replied = True
        self.stream.send_message(
            json.dumps({
                'type': self.reqtype + '_resp',
                'data': datum,
                'time': time.time(),
                'future_id': self.future_id,
            }), binary=False)


class KansasGameState(object):
    """KansasGameState holds the entire state of the game in json format."""

    def __init__(self, sourceid, data=None):
        self.data = CachingLoader(data or BLANK_DECK)
        self.data['default_back_url'] = datasource.BackUrl(sourceid)
        self.index = self.buildIndex()
        self.initializeStacks(shuffle=True)
        self.sourceid = sourceid
        self.gc()

    def gc(self):
        for s in ['orientations', 'urls_small', 'urls']:
            for card in self.data[s].keys():
                if not self.containsCard(card):
                    del self.data[s][card]

    def containsCard(self, card):
        return card in self.index

    def initializeStacks(self, shuffle=False):
        for loc, stack in self.data['board'].iteritems():
            assert type(loc) is int, "card locs must be int"
            if shuffle:
                random.shuffle(stack)
            for card in stack:
                if card not in self.data['orientations']:
                    self.data['orientations'][card] = -1
        for user, hand in self.data['hands'].iteritems():
            for card in hand:
                if card not in self.data['orientations']:
                    self.data['orientations'][card] = -1
        self.gc()

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

        self.data['orientations'][card] = dest_orient

        return src_type, src_key

    def remove_card(self, card):
        loc_type, loc = self.index[card]
        del self.index[card]
        self.data[loc_type][loc].remove(card)
        if len(self.data[loc_type][loc]) == 0:
            del self.data[loc_type][loc]
        
    def add_card(self, card):
        loc = card['loc']
        name = card['name']
        stream, _ = datasource.Find(self.sourceid, name, exact=True)
        if stream:
            url = stream[0]['img_url']
        else:
            raise Exception("Cannot find '%s'" % name);
        card_id = self.data.new_card(url)
        if loc in self.data['board']:
            self.data['board'][loc].append(card_id)
        else:
            self.data['board'][loc] = [card_id]
        self.index[card_id] = ('board', loc)
        return card_id
    

class KansasHandler(object):
    """KansasHandler implements a state machine where the transitions are
       driven by requests, and states correspond to KansasHandler classes."""

    def __init__(self):
        self._lock = threading.RLock()
        self.handlers = {}
        self.handlers['ping'] = self.handle_ping
        self.handlers['keepalive'] = self.handle_keepalive
        self.handlers['query'] = self.handle_query
        self.handlers['bulkquery'] = self.handle_bulkquery
        self.handlers['sleep'] = self.handle_sleep
        self.handlers['clone_scope'] = self.handle_clone_scope
        self.handlers['list_scope'] = self.handle_list_scope

    def handle_list_scope(self, request, output):
        scope = request['scope']
        sourceid = request['sourceid']
        clientdb = ClientDB.Subspace(SubspaceKey(scope, sourceid))
        games = Games.Subspace(SubspaceKey(scope, sourceid))
        output.reply({
            'decks': clientdb.List(),
            'games': games.List(),
        })

    def handle_clone_scope(self, request, output):
        """Copies data from one scope to another - for sysadmin purposes."""

        src = request['src']
        dest = request['dest']
        dbs = [ClientDB, Games]
        for db in dbs:
            for sourcetype in datasource.AllSources():
                src_space = db.Subspace(SubspaceKey(src, sourcetype))
                dest_space = db.Subspace(SubspaceKey(dest, sourcetype))
                for k, _ in dest_space:
                    dest_space.Delete(k)
                for k, v in src_space:
                    dest_space.Put(k, v)

    def handle_ping(self, request, output):
        logging.debug("served ping")
        output.reply('pong')

    def handle_keepalive(self, req, output):
        logging.debug('keepalive from ' + str(output.stream));
        self.streams[output.stream]['last_keepalive'] = time.time()

    def handle_sleep(self, request, output):
        time.sleep(5)
        output.reply("done")
    
    def handle_bulkquery(self, request, output):
        resp = {}
        logging.info('bulkquery: ' + str(request));
        for term in request['terms']:
            stream, _ = datasource.Find(self.sourceid, term, True)
            if stream:
                resp[term] = stream[0]
            else:
                resp[term] = None
        output.reply({'req': request, 'resp': resp})

    def handle_query(self, request, output):
        if request.get('allow_inexact'):
            logging.info("Trying inexact match")
            stream, meta = datasource.Find(
                request['datasource'], request['term'], exact=False)
        else:
            logging.info("Trying exact match")
            stream, meta = datasource.Find(
                request['datasource'], request['term'], exact=True)
        output.reply({
            'stream': stream,
            'meta': meta,
            'req': request})

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
    """The request handler for inbound websocket connections."""

    def __init__(self):
        KansasHandler.__init__(self)
        self.spaces = {}
        self.handlers['set_scope'] = self.handle_set_scope

    def handle_set_scope(self, request, output):
        scope = request['scope']
        sourceid = request['datasource']

        if not datasource.IsValid(sourceid):
            raise KansasRedirect("invalid datasource: " + sourceid, "/");

        assert scope, scope
        if (scope, sourceid) not in self.spaces:
            self.spaces[scope, sourceid] = KansasSpaceHandler(scope, sourceid)

    def transition(self, reqtype, request, output):
        if reqtype == 'set_scope':
            KansasHandler.transition(self, reqtype, request, output)
            scope = request['scope']
            sourceid = request['datasource']
            return self.spaces[scope, sourceid]
        else:
            return KansasHandler.transition(self, reqtype, request, output)


class KansasSpaceHandler(KansasHandler):
    """The request handler created for Kansas scope."""

    MAX_GAMES = 5

    def __init__(self, scope, sourceid):
        KansasHandler.__init__(self)
        self.sourceid = sourceid
        self.handlers['connect'] = self.handle_connect
        self.handlers['list_games'] = self.handle_list_games
        self.handlers['end_game'] = self.handle_end_game
        self.subspaceKey = SubspaceKey(scope, sourceid)
        self.scope = scope
        self.games = {}
        self.ScopedGames = Games.Subspace(self.subspaceKey)
        for gameid, snapshot in self.ScopedGames:
            logging.debug("Restoring %s as %s" % (gameid, str(snapshot)))
            game = self.new_game(gameid)
            game.restore(snapshot)
            self.games[gameid] = game
            

    def handle_end_game(self, request, output):
        with self._lock:
            self.games[request].terminate()
        self.garbage_collect_games()

    def handle_list_games(self, request, output):
        self.garbage_collect_games()
        with self._lock:
            resp = []
            ranked = sorted(
                self.games.items(),
                key=lambda (k, v): (bool(not v.presence_count()), -v.last_used))
            for gameid, handler in ranked:
                resp.append({
                    'gameid': gameid,
                    'presence': handler.presence_count()})
            output.reply(resp)

    def garbage_collect_games(self):
        if len(self.games) > self.MAX_GAMES:
            ranked = sorted(
                self.games.items(),
                key=lambda (k, v): (bool(not v.presence_count()), -v.last_used))
            while len(self.games) > self.MAX_GAMES:
                victim_id, victim = ranked.pop()
                self.delete_game(victim_id)
        for gameid, game in self.games.items():
            if game.terminated:
                self.delete_game(gameid)
    
    def new_game(self, gameid):
        logging.info("Creating new game '%s'", gameid)
        game = KansasGameHandler(gameid, self.scope, self.sourceid)
        self.games[gameid] = game
        return game

    def delete_game(self, gameid):
        logging.info("Deleting game '%s'", gameid)
        self.games[gameid].terminate()
        del self.games[gameid]

    def handle_connect(self, request, output):
        with self._lock:
            logging.info(request)
            presence = {'uuid': request['uuid'], 'name': request['user']}
            if request['gameid'] in self.games:
                logging.info("Joining existing game '%s'", request['gameid'])
                game = self.games[request['gameid']]
            else:
                game = self.new_game(request['gameid'])
                self.games[request['gameid']] = game
                game.save()
            game.add_stream(output.stream, presence)
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
        else:
            return KansasHandler.transition(self, reqtype, request, output)


class KansasGameHandler(KansasHandler):
    """There is single game handler for each game, shared among all players.
       Enforces a global ordering on game-state update broadcasts."""

    def __init__(self, gameid, scope, sourceid):
        KansasHandler.__init__(self)
        self._seqno = 1000
        self._state = KansasGameState(sourceid=sourceid)
        self.gameid = gameid
        self.subspaceKey = SubspaceKey(scope, sourceid)
        self.handlers['broadcast'] = self.handle_broadcast
        self.handlers['bulkmove'] = self.handle_bulkmove
        self.handlers['end'] = self.handle_end
        self.handlers['remove'] = self.handle_remove
        self.handlers['add'] = self.handle_add
        self.handlers['kvop'] = self.handle_kvop
        self.ScopedClientDB = ClientDB.Subspace(self.subspaceKey)
        self.ScopedGames = Games.Subspace(self.subspaceKey)
        self.streams = {}
        self.sourceid = sourceid
        self.last_used = time.time()
        self.terminated = False

    def save(self):
        logging.info("Saving snapshot of %s." % self.gameid)
        self.ScopedGames.Put(self.gameid, self.snapshot())

    def add_stream(self, stream, presence_info):
        self.streams[stream] = presence_info
        self.streams[stream]['last_keepalive'] = time.time()

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
                except Exception, e:
                    logging.exception(e);
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
            self.save()

    def handle_broadcast(self, req, output):
        with self._lock:
            if req.get('include_self'):
                exclude = set()
            else:
                exclude = {output.stream}
            self.broadcast(
                set(self.streams.keys()) - exclude,
                'broadcast_message',
                req)
        output.reply("ok")

    def handle_remove(self, req, output):
        with self._lock:
            removed = set()
            for card in req:
                if self._state.containsCard(card):
                    removed.add(card)
                    self._state.remove_card(card)
            self._state.gc()
            self.broadcast(
                set(self.streams.keys()),
                'bulk_remove', list(removed))
            self.save()
        output.reply("done")

    def handle_add(self, req, output):
        with self._lock:
            added = []
            requestor = req['requestor']
            for card in req['cards']:
                new_id = self._state.add_card(card)
                added.append({
                    'id': new_id,
                    'orient': self._state.data['orientations'][new_id],
                    'url': self._state.data['urls'][new_id],
                    'small_url': self._state.data['urls_small'][new_id],
                    'pos': self._state.index[new_id],
                })
            self._state.initializeStacks()
            self.broadcast(
                set(self.streams.keys()),
                'bulk_add', {
                    'cards': added,
                    'requestor': requestor,
                })
            self.save()
        output.reply("done")
    
    def handle_kvop(self, req, output):
        op = req['op']
        ns = self.ScopedClientDB.Subspace(req['namespace'])
        resp = None
        if op == 'Put':
            resp = ns.Put(req['key'], req['value'])
        elif op == 'Delete':
            resp = ns.Delete(req['key'])
        elif op == 'Get':
            resp = ns.Get(req['key'])
        elif op == 'List':
            resp = []
            for k, _ in ns:
                resp.append(k)
        else:
            raise Exception("invalid kvop")
        output.reply({'req': req, 'resp': resp})

    def snapshot(self):
        with self._lock:
            return dict(self._state.data), self._seqno

    def restore(self, snapshot):
        with self._lock:
            self._state = KansasGameState(sourceid=self.sourceid, data=snapshot[0])
            self._seqno = snapshot[1]

    def handle_end(self, req, output):
        self.terminate()
    
    def terminate(self):
        logging.info("Terminating game.")
        with self._lock:
            self.terminated = True
            self.ScopedGames.Delete(self.gameid)
            for s in self.streams:
                try:
                    s.send_message(
                       json.dumps({
                       'type': 'error',
                       'msg': "game terminated"}),
                       binary=False)
                    s.close_connection(wait_response=False)
                except Exception, e:
                    logging.exception(e)
            self.streams = {}

    def nextseqno(self):
        with self._lock:
            self._seqno += 1
            return self._seqno

    def broadcast(self, streamSet, reqtype, data):
        logging.info("Broadcasting %s", reqtype)
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

    def gc_streams(self):
        with self._lock:
            for stream in self.streams.keys():
                last = self.streams[stream]['last_keepalive']
                if time.time() - last > 60:
                    try:
                        del self.streams[stream]
                        stream.close_connection(wait_response=False)
                    except Exception, e:
                        logging.exception(e)

    def presence_count(self):
        with self._lock:
            self.gc_streams()
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
            output = JSONOutput(
                request.ws_stream,
                req['type'],
                req.get('future_id'))
            currentHandler = currentHandler.transition(
                req['type'],
                req.get('data'),
                output)
        except KansasRedirect, e:
            logging.info("redirecting to: " + e.url)
            request.ws_stream.send_message(
               json.dumps({
                    'type': 'redirect',
                    'msg': e.message,
                    'url': e.url,
               }),
               binary=False)
        except Exception, e:
            logging.exception(e)
            request.ws_stream.send_message(
               json.dumps({'type': 'error', 'msg': str(e)}),
               binary=False)


# vim: ts=4 sw=4 et

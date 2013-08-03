# Implements card searching and caching.

from server import config
from server import imagecache
from server import namespaces
from server import plugins

import logging
import time
import threading
import random

QueryCache = namespaces.Namespace(config.kDBPath, 'QueryCache', version=6)
Knowledge = namespaces.Namespace(config.kDBPath, 'Knowledge', version=1)


_SOURCES = {
    'magiccards.info': plugins.MagicCardsInfoPlugin(),
    'poker': plugins.PokerCardsPlugin(),
    'customscans': None,
}


def AllSources():
    return _SOURCES.keys()


def IsValid(source):
    return source in _SOURCES


def BackUrl(source):
    return _SOURCES[source].GetBackUrl()


def _FindCards(source, name, exact):
    """Same as FindCards but skips caches."""

    if source not in _SOURCES:
        raise Exception("Source '%s' not found." % str(source))

    return _SOURCES[source].Fetch(name, exact)


class BackgroundLearner(threading.Thread):
    # TODO get rid of this once experiment is done
    def run(self):
        last_size = 0
        death_counter = 0
        maxctr = 0
        ss = Knowledge.Subspace("magiccards.info")
        abc = 'abcdefghijklmnopqrstuvwxyz'
        while death_counter < 1000:
            time.sleep(random.random() * 5)
            if random.random() > .5:
                length = 2
            else:
                length = 3
            query = ''
            for _ in range(length):
                query += random.choice(abc)
            print query
            Find('magiccards.info', query)
            ct = 0
            for k, v in ss:
                if not imagecache.CachePeek(v[0]) and ct < 10:
                    ct += 1
                    imagecache.Cached(v[0])
            size = len(ss.List())
            logging.info("Knowledge of magic is now %d, ctr %d (max %d).", size, death_counter, maxctr)
            if size == last_size:
                death_counter += 1
            else:
                maxctr = max(maxctr, death_counter)
                death_counter = 0
            last_size = size


BackgroundLearner().start()

def Find(source, name, exact=False):
    """Returns (stream, meta), where
        stream is a list of
        {
            'name': 'Card Name',
            'img_url': 'http://...',
            'info_url': 'http://...',
        }
        and meta is a dictionary of extra attributes."""

    key = str((str(source), str(name), bool(exact)))
    result = QueryCache.Get(key)

    if result is None:
        logging.info("Cache miss on '%s'", key)
        result = _FindCards(source, name, exact)
        QueryCache.Put(key, result)
    else:
        logging.info("Cache HIT on '%s'", key)

    # Rewrites result stream to use cached images if possible.
    start = time.time()
    ss = Knowledge.Subspace(source)
    for card in result[0]:
        ss.Put(card['name'], (card['img_url'], card['info_url']))
        card['img_url'] = imagecache.CachedIfPresent(card['img_url'])
    logging.info("Knowledge update took %.2fs.", time.time() - start)

    return result

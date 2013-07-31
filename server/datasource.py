# Implements card searching and caching.

from server import config
from server import imagecache
from server import namespaces
from server import plugins

import logging

QueryCache = namespaces.Namespace(config.kDBPath, 'QueryCache', version=5)


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
    for card in result[0]:
        card['img_url'] = imagecache.CachedIfPresent(card['img_url'])

    return result

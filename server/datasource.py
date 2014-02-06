# Implements card searching and caching.

from server import config
from server import imagecache
from server import namespaces
from server import plugins

import logging

QueryCache = namespaces.Namespace(config.kDBPath, 'QueryCache', version=9)
Knowledge = namespaces.Namespace(config.kDBPath, 'Knowledge', version=1)


_SOURCES = {
    'localdb': plugins.LocalDBPlugin(),
    'magiccards.info': plugins.MagicCardsInfoPlugin(),
    'pokerdb': plugins.PokerCardsPlugin(),
}


def AllSources():
    return _SOURCES.keys()


def IsValid(source):
    return source in _SOURCES


def BackUrl(source):
    return _SOURCES[source].GetBackUrl()


def Sample(source):
    return _SOURCES[source].Sample()


def SampleDeck(source, term, num_decks):
    return _SOURCES[source].SampleDeck(term, num_decks)


def _FindCards(source, name, exact, limit=None):
    """Same as FindCards but skips caches."""

    if source not in _SOURCES:
        raise Exception("Source '%s' not found." % str(source))

    return _SOURCES[source].Fetch(name, exact, limit)


def Find(source, name, exact=False, limit=None):
    """Returns (stream, meta), where
        stream is a list of
        {
            'name': 'Card Name',
            'img_url': 'http://...',
            'info_url': 'http://...',
        }
        and meta is a dictionary of extra attributes."""

    key = str((str(source), str(name), bool(exact), str(limit)))
    result = QueryCache.Get(key)

    if result is None:
        logging.info("Cache miss on '%s'", key)
        result = _FindCards(source, name, exact, limit)
        QueryCache.Put(key, result)
    else:
        logging.info("Cache HIT on '%s'", key)

    # Rewrites result stream to use cached images if possible.
    for card in result[0]:
        card['img_url'] = imagecache.CachedIfPresent(card['img_url'])

    return result

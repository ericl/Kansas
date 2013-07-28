# Implements card searching and caching.

from server import config
from server import imagecache
from server import namespaces

import logging
import re
import urllib2

QueryCache = namespaces.Namespace(config.kDBPath, 'QueryCache', version=0)


def _FindCards(source, name, exact):
    """Same as FindCards but skips caches."""

    if source not in _SOURCES:
        raise Exception("Source '%s' not found." % str(source))

    return _SOURCES[source].Fetch(name, exact)


def FindCards(source, name, exact=False):
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


class MagicCardsInfoPlugin(object):
    def Fetch(self, name, exact):
        url = "http://magiccards.info/query?q=%s%s&v=card&s=cname" %\
            ('!' if exact else 'l:en+', '+'.join(name.split()))
        logging.info("GET " + url)
        req = urllib2.Request(url)
        stream = urllib2.urlopen(req)
        data = stream.read()
        matches = re.finditer(
            '"http://magiccards.info/scans/en/[a-z0-9]*/[a-z0-9]*.jpg"',
            data)
        has_more = bool(re.findall('"\/query.*;p=2"', data))
        urls = [m.group() for m in matches]
        logging.info("found " + ','.join(urls))
        stream = []
        for a in urls:
            stream.append({
                'name': 'Unknown(TODO)',
                'img_url': a[1:-1],
                'info_url': 'Unknown(TODO)',
            })
        meta = {
            'has_more': has_more,
            'more_link': 'Unknown(TODO)',
        }
        return (stream, meta)


_SOURCES = {
    'magiccards.info': MagicCardsInfoPlugin(),
    'mtg': None,
    'localdb': None,
    'poker': None,
}

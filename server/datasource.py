# Implements card searching and caching.

from server import config
from server import imagecache
from server import namespaces

import logging
import re
import urllib2

QueryCache = namespaces.Namespace(config.kDBPath, 'QueryCache', version=4)


def _FindCards(source, name, exact):
    """Same as FindCards but skips caches."""

    if source not in _SOURCES:
        raise Exception("Source '%s' not found." % str(source))

    return _SOURCES[source].Fetch(name, exact)


def Find(name, exact=False):
    return FindCards('magiccards.info', name, exact)

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
            r'<a href="/([a-z0-9]*)/en/([a-z0-9]*).html">(.*?)</a>\s+<img',
            data)
        has_more = bool(re.findall('"\/query.*;p=2"', data))
        stream = []
        for m in matches:
            m1, m2, m3 = m.group(1), m.group(2), m.group(3)
            stream.append({
                'name': m3,
                'img_url': "http://magiccards.info/scans/en/%s/%s.jpg" % (m1, m2),
                'info_url': "http://magiccards.info/%s/en/%s.html" % (m1, m2),
            })
        meta = {
            'has_more': has_more,
            'more_url': "http://magiccards.info/query?q=" + name,
        }
        return (stream, meta)


_SOURCES = {
    'magiccards.info': MagicCardsInfoPlugin(),
    'mtg': None,
    'localdb': None,
    'poker': None,
}

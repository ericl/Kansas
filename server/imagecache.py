# Implements local caching of images.

from server import config
from server import namespaces

import logging
import os
import urllib2

# Stores map of url -> cached file, which can be used to invert _toHashName().
CacheMap = namespaces.Namespace(config.kDBPath, 'CacheMap', version=0)


def _toHashName(url):
    return hex(hash('$' + url))[2:] + '.jpg'


def CachedIfPresent(url):
    logging.debug("cache conditional lookup: " + url)

    return Cached(url, dont_fetch=True) or url


def CachePeek(url):
    return CacheMap.Get(url)


def Cached(url, dont_fetch=False):
    if url.startswith(config.kCachePath) \
            or url.startswith(config.kLocalServingAddress) \
            or url.startswith("../") \
            or url.startswith("/"):
        logging.info("skip local url: " + url)
        return url

    logging.debug("cache lookup: " + url)

    name = _toHashName(url)
    path = os.path.join(config.kCachePath, name)

    if not os.path.exists(path):
        logging.debug("cache miss: " + url)

        if dont_fetch:
            return None

        logging.info("GET " + url)
        imgdata = urllib2.urlopen(url).read()

        with open(path, 'wb') as f:
            f.write(imgdata)

        CacheMap.Put(url, name)

    return path

'''
Created on Mar 27, 2013

@author:
'''
import time
import logging
import copy
import urllib2
import os
import re

try:
    import Image
    haveImaging = True
except:
    logging.warning("Failed to import imaging module.")
    haveImaging = False
    
MAGIC_TYPE = "magic"
    
class PiecesConfigLoader():
    pass

class PieceConfigLoader():
    @staticmethod
    def magic_card_name_to_url(name):
        req = urllib2.Request("http://magiccards.info/query?q=!%s&v=card&s=cname" % '+'.join(name.split()))
        stream = urllib2.urlopen(req)
        data = stream.read()
        match = re.search('"http://magiccards.info/scans/en/[a-z0-9]*/[0-9]*.jpg"', data)
        return match.group()[33:-1]
    
    @staticmethod
    def magic_card_file_to_deck(filename):
        deck = open('piece/%s' %filename)
        deckdata = {
        'deck_name': filename,
        'deck_type' : MAGIC_TYPE,
        'resource_prefix': 'http://magiccards.info/scans/en/',
        'default_back_url': '/third_party/images/mtg_detail.jpg',
        'urls': {}
        }
        i = 0
        while True:
            read = deck.readline()
            if not read: break
            for line in read.strip().split('\n'):
                if line:
                    num, name = line.split(' ', 1)
                    num = int(num)
                    try:
                        url = PieceConfigLoader.magic_card_name_to_url(name)
                        for _ in range(num):
                            deckdata['urls'][i] = url
                            i += 1
                    except Exception, e:
                        print "failed", e
        return deckdata

class UrlLoader():
    def __init__(self):
        self.lookupCache = {}
        
    def cardNameToUrls(self, name, exact=False):
        key = (name, exact)
        if key in self.lookupCache:
            val = self.lookupCache[key]
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
                self.lookupCache[key] = urls
                return urls
            raise Exception("no matches found")
        except Exception, e:
            self.lookupCache[key] = None
            raise e

class CachingLoader(dict):
    def __init__(self, values, kSmallImageSize, kServingPrefix, kLocalServingAddress, kCachePath):
        start = time.time()
        dict.__init__(self, copy.deepcopy(values))
        self.oldPrefix = self['resource_prefix']
        
        logging.info("new CachingLoader")

        self.kSmallImageSize = kSmallImageSize
        self.kLocalServingAddress = kLocalServingAddress
        self.kCachePath = kCachePath
        # The cached files are assumed served from this path by another server.
        self['resource_prefix'] = kServingPrefix
        
        if not os.path.exists(kCachePath):
            os.makedirs(kCachePath)

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
        return os.path.join(self.kCachePath, hex(hash('$' + url))[2:] + '.jpg')

    def resize(self, large_path, small_path):
        """Resizes image found at large_path and saves to small_path."""
        if haveImaging:
            logging.info("Resize %s -> %s" % (large_path, small_path))
            Image.open(large_path)\
                 .resize(self.kSmallImageSize, Image.ANTIALIAS)\
                 .save(small_path)
            return small_path
        else:
            return large_path

    def toAbsoluteURL(self, url):
        if url.startswith('/'):
            return self.kLocalServingAddress + url
        if url.startswith('http:'):
            return url
        else:
            return self.oldPrefix + url

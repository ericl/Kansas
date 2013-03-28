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
import json

try:
    import Image
    haveImaging = True
except:
    logging.warning("Failed to import imaging module.")
    haveImaging = False
    
MAGIC_TYPE = "magic"
PIECE_EXTENSION = ".piece"
PIECE_PATH = "../piece"
    
class PiecesConfigLoader():
    
    DECK_NAMES = "deck_names"
    BOARD = "board"
    DECK_TYPE = "deck_type"
    URLS = "urls"
    RESOURCE_PREFIX = "resource_prefix"
    DEFAULT_BACK_URL = "default_back_url"
        
    @classmethod
    def load_decks(cls):
        import server.config as config
        decks = {}
        decks[cls.DECK_NAMES] = []
        decks[cls.BOARD] = {}
        decks[cls.URLS] = {}
        decks_config = config.decks
        counter = 0
        for loc, filename in decks_config.iteritems():
            if PieceConfigLoader.deck_config_exist(filename):
                with open("%s/%s" % (PIECE_PATH, PieceConfigLoader.deck_config_name(filename)), 'r') as f:
                    deck = json.load(f)
            else:
                deck = PieceConfigLoader.create_deck_config(filename)
                
            decks[cls.DECK_NAMES].append(PieceConfigLoader.deck_name(filename))
            decks[cls.BOARD][long(loc)] = range(counter, counter+len(deck[cls.URLS]))
            for _, val in deck[cls.URLS].iteritems():
                decks[cls.URLS][counter] = val
                counter += 1
                
            #FIXME Need to generalize this!!!
            decks[cls.RESOURCE_PREFIX] = deck[cls.RESOURCE_PREFIX]
            decks[cls.DEFAULT_BACK_URL] = deck[cls.DEFAULT_BACK_URL]
                  
        return decks 

class PieceConfigLoader(PiecesConfigLoader):
    
    @classmethod
    def deck_name(cls, filename):
        return os.path.splitext(filename)[0]+PIECE_EXTENSION
    
    @classmethod
    def deck_config_name(cls, filename):
        return os.path.splitext(filename)[0]+PIECE_EXTENSION
    
    @classmethod
    def deck_config_exist(cls, filename):
        return os.path.exists("%s/%s" % (PIECE_PATH, cls.deck_config_name(filename)))
        
    @classmethod
    def magic_card_name_to_url(cls, name):
        req = urllib2.Request("http://magiccards.info/query?q=!%s&v=card&s=cname" % '+'.join(name.split()))
        stream = urllib2.urlopen(req)
        data = stream.read()
        match = re.search('"http://magiccards.info/scans/en/[a-z0-9]*/[0-9]*.jpg"', data)
        return match.group()[33:-1]
    
    @classmethod
    def create_deck_config(cls, filename):
        deck = open('%s/%s' % (PIECE_PATH, filename))
        
        #FIXME generalize to any card
        
        deckdata = {
                    cls.DECK_NAMES: filename,
                    cls.DECK_TYPE : MAGIC_TYPE,
                    cls.RESOURCE_PREFIX : 'http://magiccards.info/scans/en/',
                    cls.DEFAULT_BACK_URL : '/third_party/images/mtg_detail.jpg',
                    cls.URLS : {}
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
                        url = cls.magic_card_name_to_url(name)
                        for _ in range(num):
                            deckdata['urls'][i] = url
                            i += 1
                    except Exception, e:
                        print "failed", e
                        
        storepath = "%s/%s" % (PIECE_PATH, cls.deck_config_name(filename))
        with open(storepath, 'w') as f:
            json.dump(deckdata, f)
            f.flush()
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
        
        self['hands'] = {}
        self['zIndex'] = {}
        self['orientations'] = {}
        self['urls_small'] = {}
        self['back_urls'] = {}
        self['titles'] = {}
        
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

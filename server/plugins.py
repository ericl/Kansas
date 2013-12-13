# Plugins for various board games compatible with Kansas.

import collections
import csv
import glob
import logging
import os
import random
import re
import urllib2


class DefaultPlugin(object):

    def GetBackUrl(self):
        return '/third_party/cards52/cropped/Blue_Back.png'

    def Fetch(self, name, exact):
        return []

    def Sample(self):
        return []


class PokerCardsPlugin(DefaultPlugin):
    def Sample(self):
        cards, _ = self.Fetch("", False)
        return [c['name'] for c in random.sample(cards, 5)]

    def Fetch(self, name, exact):
        stream = []
        for card in glob.glob("../third_party/cards52/cropped/[A-Z0-9][A-Z0-9]*.png"):
            abbrev = card.split("/")[-1].split(".")[0]
            if exact:
                if name.lower() == abbrev.lower():
                    stream.append({
                        'name': abbrev,
                        'img_url': card,
                        'info_url': card,
                    })
            else:
                if name.lower() in abbrev.lower():
                    stream.append({
                        'name': abbrev,
                        'img_url': card,
                        'info_url': card,
                    })
        return stream, {}


class Card(object):
    def __init__(self, row):
        self.name = row[0]
        self.type = row[1]
        self.mana = row[2]
        self.cost = int(row[3]) if row[3] else 0

    def colors(self):
        return set(self.mana).intersection(set('WRBGU'))

    def __repr__(self):
        return str((self.name, self.type, self.mana, self.cost))


class CardCatalog(object):
    def __init__(self, catalog, catalogFile):
        self.byType = collections.defaultdict(list)
        self.byName = {}
        self.byColor = collections.defaultdict(list)
        self.byCost = collections.defaultdict(list)
        logging.info("Building card catalog.")
        for c in csv.reader(open(catalogFile), escapechar='\\'):
            try:
                self._register(Card(c))
            except Exception, e:
                print "Failed to parse", c, e
        logging.info("Done building card catalog.")

    def basicLands(self):
        return ['Plains', 'Mountain', 'Island', 'Swamp', 'Forest']

    def complement(self, land, lands):
        byLand = {
            'Plains': 'W',
            'Mountain': 'R',
            'Island': 'U',
            'Swamp': 'B',
            'Forest': 'G',
        }
        color = byLand[land]
        colors = set([byLand[l] for l in lands])
        return [
            "4 " + self.choose(color, colors, 0, 2),
            "4 " + self.choose(color, colors, 0, 3),
            "3 " + self.choose(color, colors, 2, 5),
            "3 " + self.choose(color, colors, 2, 5),
            "2 " + self.choose(color, colors, 3, 7),
            "2 " + self.choose(color, colors, 5, 99),
        ]

    def choose(self, color, colors, minCost, maxCost):
        for _ in range(20):
            cand = random.choice(self.byColor[color])
            if len(cand.colors() - colors) == 0 \
                    and cand.cost >= minCost and cand.cost <= maxCost:
                break
        return cand.name

    def makeDeck(self):
        land1 = random.choice(self.basicLands())
        land2 = random.choice(self.basicLands())
        if land1 == land2:
            base = ["24 " + land1]
        else:
            base = ["12 " + land1, "12 " + land2]
        cards = []
        cards.extend(self.complement(land1, [land1, land2]))
        cards.extend(self.complement(land2, [land1, land2]))
        return cards + base

    def _register(self, card):
        self.byName[card.name] = card
        self.byType[card.type].append(card)
        for color in card.colors():
            self.byColor[color].append(card)
        self.byCost[card.cost].append(card)


class LocalDBPlugin(DefaultPlugin):
    DB_PATH = '../localdb'
    SCRAPE_PATH = '../scrape.txt'

    def __init__(self):
        self.catalog = {}
        self.index = {}
        if not os.path.isdir(self.DB_PATH):
            return
        for f in os.listdir(self.DB_PATH):
            name = f.replace('_', '/').replace('.jpg', '')
            key = str(name.replace('\xc3\x86', 'ae').lower())
            self.catalog[key] = urllib2.quote(os.path.join(self.DB_PATH, f))
            self.index[key] = name
        self.cards = CardCatalog(self.catalog, LocalDBPlugin.SCRAPE_PATH)

    def Sample(self):
        return self.cards.makeDeck()

    def GetBackUrl(self):
        return '/third_party/images/mtg_detail.jpg'

    def Fetch(self, name, exact):
        stream, meta = [], {}
        if name == '':
            return stream, meta
        name = name.strip()
        needle = str(name.lower())
        if exact:
            if needle in self.catalog:
                stream.append({
                    'needle': needle,
                    'img_url': self.catalog[needle],
                    'info_url': self.catalog[needle],
                })
        else:
            ct = 0
            for fullname, url in self.catalog.iteritems():
                if needle in fullname:
                    print fullname, self.catalog[fullname]
                    stream.append({
                        'name': fullname,
                        'img_url': self.catalog[fullname],
                        'info_url': self.catalog[fullname],
                    })
                    ct += 1
                    if ct > 1000:
                        break
        meta = {
            'has_more': False,
            'more_url': "",
        }
        return stream, meta


class MagicCardsInfoPlugin(DefaultPlugin):

    def GetBackUrl(self):
        return '/third_party/images/mtg_detail.jpg'

    def Sample(self):
        return ["Island", "Plains", "Mountain", "Swamp", "Forest"]

    def Fetch(self, name, exact):
        if name == '':
            return [], {}
        url = "http://magiccards.info/query?q=%s%s&v=olist&s=cname" %\
            ('!' if exact else 'l:en+', '+'.join(name.split()))
        logging.info("GET " + url)
        req = urllib2.Request(url)
        stream = urllib2.urlopen(req)
        data = stream.read()
        if 'selected="selected">View as a List' in data:
            matches = re.finditer(
                r'<a href="/([a-z0-9]*)/en/([a-z0-9]*).html">(.*?)</a>',
                data)
        else:
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

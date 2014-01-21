# Plugins for various board games compatible with Kansas.

import collections
import csv
import glob
import logging
import os
import random
import re
import time
import urllib2


class DefaultPlugin(object):

    def GetBackUrl(self):
        return '/third_party/cards52/cropped/Blue_Back.png'

    def Fetch(self, name, exact):
        return []

    def Sample(self):
        return []

    def SampleDeck(self, term, num_decks):
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


landsByColor = {
    'W': 'Plains',
    'R': 'Mountain',
    'U': 'Island',
    'B': 'Swamp',
    'G': 'Forest',
}

def sanitize(s):
    return s.replace("\xc3\x86", "Ae").decode('ascii', errors='ignore')

class MagicCard(object):

    def __init__(self, row):
        self.name = sanitize(row[0])
        self.type = row[1]
        self.mana = row[2]
        self.cost = int(row[3]) if row[3] else 0
        self.text = sanitize(row[4])
        self.set = row[5] # Format: setname (rarity)
        self.tokens = (
            [x.lower() for x in set(self.name.split()) if len(x) > 2] +
            [x.lower() for x in set(self.text.split()) if len(x) > 3 and re.match('^[a-zA-Z]+$', x)])

        self.byLand = {
            'Plains': 'W',
            'Mountain': 'R',
            'Island': 'U',
            'Swamp': 'B',
            'Forest': 'G',
        }
        self.basicLands = ['Plains', 'Mountain', 'Island', 'Swamp', 'Forest']

    def colors(self):
        text_colors = set([c for c in 'WRBGU' if '{%s}' %c \
            if '{%s}' %c in self.text])

        if self.type == 'Land':
            text_colors = text_colors | set([self.byLand[land] \
                for land in self.basicLands if land in self.text])

        return set(self.mana).union(text_colors).intersection(set('WRBGU'))

    def __repr__(self):
        return str((self.name, self.type, self.mana, self.cost))


class CardCatalog(object):
    def __init__(self, catalogFile):
        self.byType = collections.defaultdict(list)
        self.byName = {}
        self.byColor = collections.defaultdict(list)
        self.byCost = collections.defaultdict(list)
        self.byTokens = collections.defaultdict(list)
        logging.info("Building card catalog.")
        for c in csv.reader(open(catalogFile), escapechar='\\'):
            try:
                if len(c[0]) > 35:
                    raise Exception("the name is way too long")
                self._register(MagicCard(c))
            except Exception, e:
                print "Failed to parse", c, e
        logging.info("Done building card catalog.")
        self.topTokens = []
        for k, v in self.byTokens.iteritems():
            if len(v) >= 10:
                self.topTokens.append(k)
        print self.topTokens

        self.byLand = {
            'Plains': 'W',
            'Mountain': 'R',
            'Island': 'U',
            'Swamp': 'B',
            'Forest': 'G',
        }
        self.basicLands = ['Plains', 'Mountain', 'Island', 'Swamp', 'Forest']

    def complement(self, land, lands, taken, theme=None):
        color = self.byLand[land]
        colors = set([self.byLand[l] for l in lands])
        return [
            "4 " + self.chooseSpell(color, colors, 0, 2, taken, theme),
            "4 " + self.chooseSpell(color, colors, 1, 3, taken, theme),
            "4 " + self.chooseSpell(color, colors, 2, 5, taken, theme),
            "2 " + self.chooseSpell(color, colors, 3, 7, taken, theme),
            "2 " + self.chooseSpell(color, colors, 4, 8, taken, theme),
            "2 " + self.chooseSpell(color, colors, 5, 99, taken, theme),
        ]

    def chooseSpell(self, color, colors, minCost, maxCost, taken, theme=None):

        def valid(cand):
            if cand is None: return False
            if cand.type == 'land': return False
            if cand.name in taken: return False
            if cand.cost < minCost: return False
            if cand.cost > maxCost: return False
            if len(cand.colors() - colors) > 0: return False
            return True

        cand = None

        if theme and random.random() < 0.66:
            tries = 20
            pool = Catalog.byTokens[random.choice(theme)]
            while not valid(cand) and tries > 0:
                tries -= 1
                cand = random.choice(pool)
            logging.debug(str(["chooseSpell", color, colors, minCost, maxCost, theme, len(taken), cand.name, tries]))

        tries = 10
        while not valid(cand) and tries > 0:
            tries -= 1
            if random.random() < 0.1:
                cand = random.choice(self.byColor['colorless'])
            else:
                cand = random.choice(self.byColor[color])

        taken.add(cand.name)
        return cand.name

    def chooseLand(self, colors):
        for _ in range(20):
            cand = random.choice(self.byType['Land'])
            if cand in self.basicLands: continue
            if len(cand.colors() - colors) == 0:
                break
        return cand.name

    def makeDeck(self):
        land1 = random.choice(self.basicLands)
        land2 = random.choice(self.basicLands)
        if land1 == land2:
            base = ["20 " + land1]
        else:
            base = ["10 " + land1, "10 " + land2]
        colors = set([self.byLand[l] for l in [land1, land2]])
        base.append("4 " + self.chooseLand(colors))
        cards = []
        taken = set()
        cards.extend(self.complement(land1, [land1, land2], taken))
        cards.extend(self.complement(land2, [land1, land2], taken))
        return base + sorted(cards, reverse=True)

    def randomTheme(self):
        return random.choice(self.topTokens)

    def makeThemedDeck(self, theme):
        colorVotes = collections.defaultdict(float)
        for t in theme:
            pool = self.byTokens[t]
            for card in pool:
                colors = card.colors()
                for color in colors:
                    colorVotes[color] += 1.0 / (len(colors) + len(pool))
        rankedColors = sorted([(v, k) for (k, v) in colorVotes.items()], reverse=True)
        if len(rankedColors) > 0:
            land1 = landsByColor[rankedColors[0][1]]
        else:
            land1 = random.choice(self.basicLands)
        if len(rankedColors) > 1:
            land2 = landsByColor[rankedColors[1][1]]
        else:
            land2 = random.choice(self.basicLands)
        if land1 == land2:
            base = ["20 " + land1]
        else:
            base = ["10 " + land1, "10 " + land2]
        colors = set([self.byLand[l] for l in [land1, land2]])
        base.append("4 " + self.chooseLand(colors))
        cards = []
        taken = set()
        cards.extend(self.complement(land1, [land1, land2], taken, theme))
        cards.extend(self.complement(land2, [land1, land2], taken, theme))
        return base + sorted(cards, reverse=True)

    def _register(self, card):
        self.byName[card.name] = card
        self.byType[card.type].append(card)
        for token in card.tokens:
            self.byTokens[token].append(card)
        for color in card.colors():
            self.byColor[color].append(card)
        if not card.colors():
            self.byColor['colorless'].append(card)
        self.byCost[card.cost].append(card)


Catalog = CardCatalog("../mtg_info.txt")


class LocalDBPlugin(DefaultPlugin):
    DB_PATH = '../localdb'

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

    def Sample(self):
        return Catalog.makeDeck()

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
        return Catalog.makeDeck()

    def SampleDeck(self, term, num_decks):
        start = time.time()
        random.seed(hash(term))
        output = {}
        for _ in range(num_decks):
            theme = []
            for word in term.split():
                if word in Catalog.byTokens:
                    theme.append(word)
                else:
                    tokens = list(Catalog.byTokens)
                    random.shuffle(tokens)
                    for key in tokens:
                        if word in key:
                            theme.append(key)
                            break
            while len(theme) < 2:
                theme.insert(0, Catalog.randomTheme())
            key = ' '.join([w[0].upper() + w[1:] for w in theme])
            theme = tuple(theme)
            output[key] = Catalog.makeThemedDeck(theme)
        logging.info("Deck gen took %.2fms", 1000*(time.time() - start))
        return output

    def Fetch(self, name, exact):
        if name == '':
            return [], {}

        def DoQuery(url):
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

        url = "http://magiccards.info/query?q=%s%s&v=olist&s=cname" %\
            ('!' if exact else 'l:en+', '+'.join(name.split()))

        return DoQuery(url)

# Plugins for various board games compatible with Kansas.

import collections
import csv
import glob
import logging
import os
import random
import re
import shlex
import time
import urllib2


class DefaultPlugin(object):

    def GetBackUrl(self):
        return '/third_party/cards52/cropped/Blue_Back.png'

    def Fetch(self, name, exact, limit=None):
        return []

    def Sample(self):
        return []

    def SampleDeck(self, term, num_decks):
        return []


class PokerCardsPlugin(DefaultPlugin):
    def Sample(self):
        cards, _ = self.Fetch("", False)
        return [c['name'] for c in random.sample(cards, 5)]

    def Fetch(self, name, exact, limit=None):
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
    return s \
        .replace("\xc3\x86", "Ae") \
        .replace("\xc3\xa1", "a") \
        .decode('ascii', errors='ignore')

class MagicCard(object):

    def __init__(self, row):
        self.name = sanitize(row[0])
        self.type = row[1]
        self.subtype = row[2]
        self.searchtype = ' '.join([self.type, self.subtype]).lower()
        self.mana = row[3]
        self.cost = int(row[4]) if row[3] else 0
        self.text = sanitize(row[5])
        colorstring = ""
        numcolors = 0
        if 'U' in self.mana or ('Land' in self.type and '{U}' in self.text):
            colorstring += "blue "
            numcolors += 1
        if 'B' in self.mana or ('Land' in self.type and '{B}' in self.text):
            colorstring += "black "
            numcolors += 1
        if 'R' in self.mana or ('Land' in self.type and '{R}' in self.text):
            colorstring += "red "
            numcolors += 1
        if 'G' in self.mana or ('Land' in self.type and '{G}' in self.text):
            colorstring += "green "
            numcolors += 1
        if 'W' in self.mana or ('Land' in self.type and '{W}' in self.text):
            colorstring += "white "
            numcolors += 1
        if numcolors > 1:
            colorstring += "multi "
        if numcolors == 0:
            colorstring += "colorless "
        elif numcolors == 1:
            colorstring += "mono single "
        elif numcolors == 2:
            colorstring += "dual two "
        elif numcolors == 3:
            colorstring += "tri three "
        elif numcolors == 4:
            colorstring += "quad four "
        elif numcolors == 5:
            colorstring += "five all rainbow "
        self.searchtext = ' '.join([self.name, self.type, self.text, self.subtype, colorstring]).lower()
        self.set = row[6]
        self.rarity = row[7]
        self.tokens = (
            [x.lower() for x in set(self.name.split()) if len(x) > 2] +
            [x.lower() for x in set(self.type.split()) if len(x) > 2] +
            [x.lower() for x in set(self.subtype.split()) if len(x) > 2] +
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
        self.initialized = True
        self.byType = collections.defaultdict(list)
        self.byName = {}
        self.bySlug = {}
        self.byColor = collections.defaultdict(list)
        self.byCost = collections.defaultdict(list)
        self.byTokens = collections.defaultdict(list)
        logging.info("Building card catalog.")
        try:
            for c in csv.reader(open(catalogFile), escapechar='\\'):
                try:
                    if len(c[0]) > 35:
                        raise Exception("the name is way too long")
                    self._register(MagicCard(c))
                except Exception, e:
                    logging.warning("Failed to parse %s: %s", c, e)
        except Exception, e:
            logging.warning("Failed to load catalog: %s", e)
            self.initialized = False
        logging.info("Done building card catalog.")
        self.topTokens = []
        for k, v in self.byTokens.iteritems():
            if len(v) >= 10:
                self.topTokens.append(k)

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

        tries = 30
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
        if not self.initialized:
            return []
        land1 = random.choice(self.basicLands)
        land2 = random.choice(self.basicLands)
        if land1 == land2:
            base = ["20 " + land1]
        else:
            base = ["10 " + land1, "10 " + land2]
        colors = set([self.byLand[l] for l in [land1, land2]])
        land3 = self.chooseLand(colors)
        base.append("4 " + land3)
        cards = []
        taken = {land1, land2, land3}
        cards.extend(self.complement(land1, [land1, land2], taken))
        cards.extend(self.complement(land2, [land1, land2], taken))
        return base + sorted(cards, reverse=True)

    def makeDecks(self, term, num_decks):
        if not self.initialized:
            return {}
        start = time.time()
        output = {}
        # TODO(ekl) dynamically chose the number of decks based on number of search
        # results and number of available combinations based on the input term.
        for i in range(num_decks):
            theme = []
            for word in term.split():
                if word in ['of', 'a', 'the', 'in']:
                    continue
                if word in Catalog.byTokens:
                    theme.append(word)
                else:
                    tokens = list(Catalog.byTokens)
                    random.seed(hash(tuple(theme)) + i)
                    random.shuffle(tokens)
                    for key in tokens:
                        if word in key:
                            theme.append(key)
                            break
            while len(theme) < 2:
                random.seed(hash(tuple(theme)) + i)
                theme.insert(0, Catalog.randomTheme())
            key = ' '.join([w[0].upper() + w[1:] for w in theme])
            theme = tuple(theme)
            random.seed(hash(theme) + i)
            output[key] = self.makeThemedDeck(theme)
        logging.info("Deck gen took %.2fms", 1000*(time.time() - start))
        return output

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
        self.bySlug[card.name.lower()] = card
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
        self.fullnames = {}
        if not os.path.isdir(self.DB_PATH):
            return
        for f in os.listdir(self.DB_PATH):
            name = f.replace('_', '/').replace('.jpg', '')
            key = sanitize(name).lower()
            self.catalog[key] = urllib2.quote(os.path.join(self.DB_PATH, f))
            self.fullnames[key] = sanitize(name)
            self.index[key] = name

    def Sample(self):
        return Catalog.makeDeck()

    def SampleDeck(self, term, num_decks):
        return Catalog.makeDecks(term, num_decks)

    def GetBackUrl(self):
        return '/third_party/images/mtg_detail.jpg'

    def Fetch(self, name, exact, limit=None):
        start = time.time()
        stream, meta = [], {}
        if name == '':
            return stream, meta
        name = name.strip()
        needle = str(name.lower())
        if exact:
            if needle in self.catalog:
                stream.append({
                    'name': name,
                    'img_url': self.catalog[needle],
                    'info_url': self.catalog[needle],
                })
        else:
            ct = 0
            ranked = collections.defaultdict(list)
            try:
                parts = set(shlex.split(needle))
            except ValueError:
                parts = set(needle.split())
            for key, url in self.catalog.iteritems():
                card = Catalog.bySlug.get(key)
                rank = 0
                if needle == key:
                    rank += 13
                elif needle in key:
                    rank += 12
                elif card and needle in card.searchtype:
                    rank += 11
                elif card and needle in card.text:
                    rank += 7
                elif card and needle in card.searchtext:
                    rank += 6
                if card:
                    rank += sum([p in key or p in card.searchtype for p in parts])
                if card:
                    rank += sum([p in card.searchtext for p in parts])
                if rank > 0:
                    ranked[rank].append(key)
            ranks = sorted(ranked.keys(), reverse=True)
            for r in ranks:
                for key in ranked[r]:
                    stream.append({
                        'name': self.fullnames[key],
                        'img_url': self.catalog[key],
                        'info_url': self.catalog[key],
                    })
                    ct += 1
                    if ct >= limit:
                        break
                if ct >= limit:
                    break
        meta = {
            'has_more': False,
            'more_url': "",
        }
        logging.info("search for %s took %.2f ms", needle, 1000*(time.time() - start))
        return stream, meta


class MagicCardsInfoPlugin(DefaultPlugin):

    def GetBackUrl(self):
        return '/third_party/images/mtg_detail.jpg'

    def Sample(self):
        return Catalog.makeDeck()

    def SampleDeck(self, term, num_decks):
        return Catalog.makeDecks(term, num_decks)

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

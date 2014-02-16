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


kThemeBlacklist = { 'of', 'them', 'while', 'bad', 'size', 'share', 'combination', 'exactly', 'opponents', 'shuffles', 'attach', 'turned', 'lost', 'step', 'become', 'attacked', 'produces', 'shares', 'putting', 'second', 'storage', 'abilities', 'blockers', 'upkeep', 'evoke', 'rebound', 'players', 'already', 'tied', 'unpaired', 'unattached', 'deck', 'exchange', 'away', 'been', 'twice', 'returned', 'opening', 'text', 'once', 'leaves', 'leave', 'choice', 'stays', 'still', 'spent', 'returned', 'colorless', 'also', 'a', 'types', 'fewer', 'will', 'reveals', 'single', 'died', 'exchange' 'effect', 'nonbasic', 'word', 'words', 'kit', 'paid', 'random', 'sources', 'casts', 'the', 'in', 'remain', 'false', 'spend', 'total', 'move', 'played', 'entered', 'activated', 'greatest', 'affinity', 'instead', 'declare', 'which', 'attached', 'instead', 'play', 'increasing', 'does', 'assign', 'noncreature', 'unblocked', 'costs', 'kind', 'named', 'maximum', 'greatest', 'owner', 'take', 'remains', 'colors', 'common', 'rather', 'empty', 'there', 'untapped', 'form', 'source', 'flip', 'removed', 'both', 'nontoken', 'for', 'soon', 'much', 'nonwhite', 'nonblack', 'nonred', 'nonblue', 'nongreen', 'loss', 'after', 'before', 'same', 'could', 'begin', 'being', 'bottom', 'and', 'or', 'either', 'draws', 'lasts', 'comes', 'plays', 'change', 'instances', 'third', 'five', 'adds', 'since', 'targets', 'least', 'unattach', 'amount', 'game', 'they', 'one', 'pair', 'discarding', 'causes', 'convoke', 'cause', 'effects', 'back', 'most', 'enough', 'repeat', 'attackers', 'keeps', 'down', 'wins', 'blocks', 'regular', 'untaps', 'forces', 'chooses', 'many', 'enter', 'says', 'treated', 'name', 'call', 'every', 'must', 'though', 'cause', 'give', }


class DefaultPlugin(object):

    def GetBackUrl(self):
        return '/third_party/cards52/cropped/Blue_Back.png'

    def Complete(self, cards):
        return []

    def Fetch(self, name, exact, limit=None):
        return []

    def Sample(self):
        return []

    def SampleDeck(self, term, num_decks):
        return []


class PokerCardsPlugin(DefaultPlugin):
    def Sample(self):
        cards, _ = self.Fetch("", False)
        return ["1 " + c['name'] for c in random.sample(cards, 5)]

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
        self.goodQuality = None  # if image is modern and not unhinged / unglued
        self.name = sanitize(row[0])
        self.type = row[1]
        self.subtype = row[2]
        self.searchtype = ' '.join([self.type, self.subtype]).lower()
        self.mana = row[3]
        self.cost = int(row[4]) if row[3] else 0
        self.text = sanitize(row[5])
        self.set = row[6]
        self.rarity = row[7]
        if self.set in ['Unhinged', 'Unglued']:
            self.goodQuality = False
        coststring = "mana=%d" % self.cost
        colorstring = ""
        numcolors = 0
        if 'U' in self.mana or ('Land' in self.type and '{U}' in self.text):
            colorstring += "mana=blue "
            numcolors += 1
        if 'B' in self.mana or ('Land' in self.type and '{B}' in self.text):
            colorstring += "mana=black "
            numcolors += 1
        if 'R' in self.mana or ('Land' in self.type and '{R}' in self.text):
            colorstring += "mana=red "
            numcolors += 1
        if 'G' in self.mana or ('Land' in self.type and '{G}' in self.text):
            colorstring += "mana=green "
            numcolors += 1
        if 'W' in self.mana or ('Land' in self.type and '{W}' in self.text):
            colorstring += "mana=white "
            numcolors += 1
        if numcolors > 1:
            colorstring += "mana=multi "
        if numcolors != 0:
            colorstring += "mana=colored "
        if numcolors == 0:
            colorstring += "mana=colorless "
        elif numcolors == 1:
            colorstring += "mana=mono mana=single "
        elif numcolors == 2:
            colorstring += "mana=dual mana=two "
        elif numcolors == 3:
            colorstring += "mana=tri mana=three "
        elif numcolors == 4:
            colorstring += "mana=quad mana=four "
        elif numcolors == 5:
            colorstring += "mana=five mana=all mana=rainbow "
        self.searchtext = ' '.join([self.name, self.type, self.text, self.subtype, coststring, colorstring, 'mana=' + self.mana]).lower()
        self.searchtokens = set(self.searchtext.split())
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
        logging.info("Building card catalog.")
        self.initialized = True
        self.byType = collections.defaultdict(list)
        self.byName = {}
        self.bySlug = {}
        self.byColor = collections.defaultdict(list)
        self.byCost = collections.defaultdict(list)
        self.byTokens = collections.defaultdict(list)
        try:
            self.newCards = set([sanitize(x[2:-1]) for x in
                open("../classification.txt").readlines() if x[0] == "0"])
        except Exception, e:
            logging.warning("Failed to load classification: %s", e)
            self.newCards = set()
        try:
            for c in csv.reader(open(catalogFile), escapechar='\\'):
                try:
                    card = MagicCard(c)
                    if card.name in self.newCards:
                        card.goodQuality = True
                    self._register(card)
                except Exception, e:
                    logging.warning("Failed to parse %s: %s", c, e)
        except Exception, e:
            logging.warning("Failed to load catalog: %s", e)
            self.initialized = False
        logging.info("Done building card catalog.")
        self.topTokens = []
        for k, v in self.byTokens.iteritems():
            if len(v) >= 10 and len(v) < 170 and re.match('^[a-z]+$', k):
                if k not in kThemeBlacklist:
                    self.topTokens.append(k)
        logging.info("%d possible themes", len(self.topTokens))

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
            "4 " + self.chooseSpell(color, colors, 1, 2, taken, theme),
            "3 " + self.chooseSpell(color, colors, 1, 3, taken, theme),
            "3 " + self.chooseSpell(color, colors, 2, 4, taken, theme),
            "3 " + self.chooseSpell(color, colors, 3, 4, taken, theme),
            "3 " + self.chooseSpell(color, colors, 5, 7, taken, theme),
            "1 " + self.chooseSpell(color, colors, 6, 99, taken, theme),
            "1 " + self.chooseSpell(color, colors, 6, 99, taken, theme),
        ]

    def chooseSpell(self, color, colors, minCost, maxCost, taken, theme=None):

        def valid(cand):
            if cand is None: return False
            if not cand.goodQuality: return False
            if cand.type == 'land': return False
            if cand.name in taken: return False
            if cand.cost < minCost: return False
            if cand.cost > maxCost: return False
            if len(cand.colors() - colors) > 0: return False
            return True

        cand = None

        if theme:
            tries = 10
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

    def complete(self, cards):
        deck = {}
        total = 0
        for k, v in cards.iteritems():
            total += v
            try:
                deck[k] = self.byName[k]
            except:
                pass
        logging.info("FOUND " + str(total))
        if total >= 60:
            return []
        colorVotes = collections.defaultdict(float)
        for card in deck.values():
            colors = card.colors()
            for color in colors:
                colorVotes[color] += 1
        rankedColors = sorted([(v, k) for (k, v) in colorVotes.items()], reverse=True)
        if len(rankedColors) == 0:
            land1 = random.choice(self.basicLands)
            if random.random() > .5:
                land2 = random.choice(self.basicLands)
            else:
                land2 = land1
        else:
            land1 = landsByColor[rankedColors[0][1]]
            if len(rankedColors) > 1:
                land2 = landsByColor[rankedColors[1][1]]
            else:
                land2 = land1
        out = []
        if land1 == land2:
            if land1 not in cards:
                out.append("20 " + land1)
                total += 20
        else:
            if land1 not in cards:
                out.append("10 " + land1)
                total += 10
            if land2 not in cards:
                out.append("10 " + land2)
                total += 10
        colors = set([self.byLand[l] for l in [land1, land2]])
        taken = set(deck.keys())
        while total < 45:
            out.append("4 " + self.chooseSpell(random.choice(list(colors)), colors, 1, 4, taken))
            total += 4
        while total < 59:
            out.append("2 " + self.chooseSpell(random.choice(list(colors)), colors, 0, 99, taken))
            total += 2
        while total < 60:
            out.append("1 " + self.chooseSpell(random.choice(list(colors)), colors, 0, 99, taken))
            total += 1
        return out

    def makeDeck(self):
        if not self.initialized:
            return []
        land1 = random.choice(self.basicLands)
        land2 = random.choice(self.basicLands)
        if land1 == land2:
            base = ["24 " + land1]
        else:
            base = ["12 " + land1, "12 " + land2]
        cards = []
        taken = {land1, land2}
        cards.extend(self.complement(land1, [land1, land2], taken))
        cards.extend(self.complement(land2, [land1, land2], taken))
        return base + sorted(cards, reverse=True)

    def makeDecks(self, term, num_decks):
        if not self.initialized:
            return {}
        start = time.time()
        output = {}
        random.seed(hash(term))
        # TODO(ekl) dynamically chose the number of decks based on number of search
        # results and number of available combinations based on the input term.
        for i in range(num_decks):
            parts = [p for p in term.split() if p not in kThemeBlacklist]
            def gen():
                word = ''
                avail = list(set(parts))
                if avail:
                    word = random.choice(avail)
                if word not in Catalog.byTokens:
                    tokens = list(Catalog.byTokens)
                    random.shuffle(tokens)
                    for key in tokens:
                        if word in key:
                            word = key
                            break
                if word not in Catalog.byTokens:
                    word = Catalog.randomTheme()
                theme = [word]
                theme.insert(0, Catalog.randomTheme())
                if random.random() > 0.5:
                    theme.insert(0, Catalog.randomTheme())
                return theme
            if i == 0 and len(parts) > 1:
                if all([p in Catalog.byTokens for p in parts]):
                    theme = parts
                else:
                    theme = []
                    for word in parts:
                        if word not in Catalog.byTokens:
                            tokens = list(Catalog.byTokens)
                            random.shuffle(tokens)
                            for key in tokens:
                                if word in key:
                                    word = key
                                    break
                        if word in Catalog.byTokens:
                            theme.append(word)
                    if len(theme) < 2:
                        theme = gen()
            else:
                theme = gen()
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
            ratio = rankedColors[1][0] / rankedColors[0][0]
            logging.info("%s ratio: %s/%s %f", ' '.join(theme), rankedColors[1][1], rankedColors[0][1], ratio)
            if ratio < 0.5:
                land2 = land1
            else:
                land2 = landsByColor[rankedColors[1][1]]
        else:
            land2 = random.choice(self.basicLands)
        if land1 == land2:
            base = ["24 " + land1]
        else:
            base = ["12 " + land1, "12 " + land2]
        colors = set([self.byLand[l] for l in [land1, land2]])
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

    def Complete(self, cards):
        return Catalog.complete(cards)

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
            mana_expr = "(mana|cost|cmc)\s*(>|<|>=|<=|=|==|)\s*(\d+)"
            predicates = []
            def add_pred(op, val):
                if op == '==':
                    predicates.append(lambda c: c.cost == val)
                elif op == '>':
                    predicates.append(lambda c: c.cost > val)
                elif op == '>=':
                    predicates.append(lambda c: c.cost >= val)
                elif op == '<':
                    predicates.append(lambda c: c.cost < val)
                elif op == '<=':
                    predicates.append(lambda c: c.cost <= val)
                else:
                    assert False, op
            for match in re.finditer(mana_expr, needle):
                needle = re.sub(mana_expr, '', needle)
                op, val = match.group(2), int(match.group(3))
                if op == '=' or op == '':
                    op = '=='
                logging.info("Using predicate: cost %s %d" % (op, val))
                add_pred(op, val)
            mana = {'red', 'blue', 'white', 'black', 'green'}
            other_mana = {'dual', 'mono', 'multi', 'colored', 'colorless', 'single', 'two', 'three', 'tri', 'quad', 'four', 'five', 'all', 'rainbow'}
            def expand(parts):
                out = []
                num_mana = 0
                for p in parts:
                    if p == 'x':
                        out.append('mana=X')
                    if p in mana:
                        num_mana += 1
                    if p in mana or p in other_mana:
                        out.append('mana=' + p)
                if num_mana == 1 and 'dual' not in out:
                    out.append('mana=mono')
                elif num_mana == 2 and 'mono' not in out:
                    out.append('mana=dual')
                logging.info("Expanded query: " + str(out))
                return out
            ct = 0
            ranked = collections.defaultdict(list)
            try:
                parts = shlex.split(needle)
            except ValueError:
                parts = needle.split()
            expanded = expand(parts)
            for title, url in self.catalog.iteritems():
                card = Catalog.bySlug.get(title)
                rank = 0.0
                if card and predicates:
                    if all([ok(card) for ok in predicates]):
                        rank += 1
                    else:
                        continue
                if needle == title:
                    rank += 20
                def rankit(p, missing):
                    rank = 0
                    if p in title or p in card.searchtype:
                        rank += 1
                    if p in card.searchtokens:
                        rank += 1
                    if p in card.searchtext:
                        if ' ' in p:
                            rank += len(p.split())
                        else:
                            rank += 1
                    else:
                        missing[0] += 1
                    return rank
                if card:
                    if card.goodQuality:
                        rank += 0.5
                    missing = [0]
                    for p in parts:
                        rank += rankit(p, missing)
                    rank -= 3 * missing[0]
                    for p in expanded:
                        rank += rankit(p, missing)
                if rank >= 1:
                    ranked[rank].append(title)
            ranks = sorted(ranked.keys(), reverse=True)
            for r in ranks:
                for title in ranked[r]:
                    stream.append({
                        'name': self.fullnames[title],
                        'img_url': self.catalog[title],
                        'info_url': self.catalog[title],
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
        logging.info("search for '%s' took %.2f ms", needle,
                     1000*(time.time() - start))
        return stream, meta


class MagicCardsInfoPlugin(DefaultPlugin):

    def GetBackUrl(self):
        return '/third_party/images/mtg_detail.jpg'

    def Sample(self):
        return Catalog.makeDeck()

    def SampleDeck(self, term, num_decks):
        return Catalog.makeDecks(term, num_decks)

    def Fetch(self, name, exact, limit):
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

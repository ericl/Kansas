'''
Created on Mar 27, 2013

@author: 
'''
import piece.decks as decks 
from server.loaders import CachingLoader

class KansasGameState(object):
    """KansasGameState holds the entire state of the game in json format."""

    def __init__(self):
        self.data = CachingLoader(decks.DEFAULT_MAGIC_DECK, (123, 175), '', 'http://localhost:8000/', '../cache')
        self.index = self.buildIndex()
        self.assignZIndices()
        self.assignOrientations()

    def assignZIndices(self):
        if self.data['zIndex']:
            i = max(self.data['zIndex'].values())
        else:
            i = 0
        for loc, stack in self.data['board'].iteritems():
            for card in stack:
                if card not in self.data['zIndex']:
                    self.data['zIndex'][card] = i
                    i += 1
                if card not in self.data['orientations']:
                    self.data['orientations'][card] = -1
        for user, hand in self.data['hands'].iteritems():
            for card in hand:
                if card not in self.data['zIndex']:
                    self.data['zIndex'][card] = i
                    i += 1
                if card not in self.data['orientations']:
                    self.data['orientations'][card] = -1

    def reverseOrientations(self, stack):
        for card in stack:
            self.data['orientations'][card] *= -1

    def resetOrientations(self, stack):
        canonicalOrient = self.data['orientations'][stack[-1]]
        for card in stack:
            self.data['orientations'][card] = canonicalOrient

    def reassignZ(self, stack):
        i = min([self.data['zIndex'][s] for s in stack])
        for card in stack:
            self.data['zIndex'][card] = i
            i += 1

    def assignOrientations(self):
        i = 0
        for loc, stack in self.data['board'].iteritems():
            for card in stack:
                self.data['zIndex'][card] = i
                i += 1
        for user, hand in self.data['hands'].iteritems():
            for card in hand:
                self.data['zIndex'][card] = i
                i += 1

    def buildIndex(self):
        index = {}
        for loc, stack in self.data['board'].iteritems():
            for card in stack:
                index[card] = ('board', loc)
        for user, hand in self.data['hands'].iteritems():
            for card in hand:
                index[card] = ('hands', user)
        return index

    def moveCard(self, card, dest_type, dest_key, dest_orient):
        assert dest_type in ['board', 'hands']
        if dest_type == 'board':
            dest_key = int(dest_key)
        else:
            assert type(dest_key) in [str, unicode], type(dest_key)
        assert dest_orient in range(-4, 5)

        src_type, src_key = self.index[card]
        # Implements Z-change on any action except pure orientation changes.
        if ((src_type, src_key) != (dest_type, dest_key)
                or self.data['orientations'][card] == dest_orient):
            # Removes card from where it was.
            self.data[src_type][src_key].remove(card)
            if len(self.data[src_type][src_key]) == 0:
                del self.data[src_type][src_key]

            # Places card into new position.
            if dest_key not in self.data[dest_type]:
                self.data[dest_type][dest_key] = []
            self.data[dest_type][dest_key].append(card)
            self.index[card] = (dest_type, dest_key)
            self.data['zIndex'][card] = max(self.data['zIndex'].values()) + 1

        self.data['orientations'][card] = dest_orient

        return src_type, src_key
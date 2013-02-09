#!/usr/bin/env python
# TODO get rid of me

import pprint
import urllib2
import sys
import re
from m_deck import DECK

def name_to_url(name):
  req = urllib2.Request("http://magiccards.info/query?q=!%s&v=card&s=cname" % '+'.join(name.split()))
  stream = urllib2.urlopen(req)
  data = stream.read()
  match = re.search('"http://magiccards.info/scans/en/[a-z0-9]*/[a-z0-9]*.jpg"', data)
  return match.group()[33:-1]

i = 0
buf = {}
while len(buf) < 60:
  print "> Enter card specifier (e.g. 4 Mountain):",
  line = raw_input().strip()
  if line:
    try:
      num, name = line.split(' ', 1)
      num = int(num)
      url = name_to_url(name)
      for _ in range(num):
        buf[i] = url
        i += 1
      print "\r\nFound %s, deck now has %d cards." % (url, len(buf))
    except Exception, e:
     print "Could not find '%s'" % line

if len(buf) != 60:
  print "Deck must have exactly 60 cards. Sorry."
  exit()

name = None
while not name:
  print "> Name your deck:",
  name = raw_input().strip()
choice = None
while choice not in ['a', 'b']:
  print "These are the current decks."
  print "  a) %s" % DECK['_deck0']
  print "  b) %s" % DECK['_deck1']
  print "> Choose deck to replace:",
  choice = raw_input().strip()
if choice == 'a':
  DECK['_deck0'] = name
  offset = 0
else:
  DECK['_deck1'] = name
  offset = 60
print offset
print buf.keys()
for i, v in buf.iteritems():
  DECK['urls'][int(i + offset)] = v
with open('m_deck.py', 'w') as deckfile:
    print >>deckfile, "DECK = %s" % pprint.pformat(DECK)

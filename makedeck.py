#!/usr/bin/env python

import urllib2
import re

DECK = """
4 Boartusk Liege
4 Flinthoof Boar
4 Gristleback
4 Krosan Tusker
4 Pygmy Razorback

2 Boar Umbra
2 Cultivate
4 Groundswell
4 Rampant Growth
4 Lightning Bolt

14 Forest
6 Mountain
4 Terramorphic Expanse
"""

def name_to_url(name):
  req = urllib2.Request("http://magiccards.info/query?q=!%s&v=card&s=cname" % '+'.join(name.split()))
  stream = urllib2.urlopen(req)
  data = stream.read()
  match = re.search('"http://magiccards.info/scans/en/[a-z0-9]*/[0-9]*.jpg"', data)
  return match.group()[33:-1]

i = 60
for line in DECK.strip().split('\n'):
  if line:
    num, name = line.split(' ', 1)
    num = int(num)
    try:
      url = name_to_url(name)
      for _ in range(num):
        print '%d: "%s",' % (i, url)
        i += 1
    except Exception, e:
       print "failed", e

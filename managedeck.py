#!/usr/bin=/env python
# TODO get rid of me

import pprint
import urllib2
import re
import sys
from m_deck import DECKS

def name_to_url(name):
	req = urllib2.Request("http://magiccards.info/query?q=!%s&v=card&s=cname" % '+'.join(name.split()))
	stream = urllib2.urlopen(req)
	data = stream.read()
	match = re.search('"http://magiccards.info/scans/en/[a-z0-9]*/[a-z0-9]*.jpg"', data)
	return match.group()[33:-1]

if sys.argv[1] == '-a':
	print "Enter card specifiers (e.g. 4 Black Lotus)"
	print "Enter 'done' when finished"
	i = 0
	buf = {}
	while True:
		line = raw_input("> ").strip()
		if line == 'done': break
		match = re.match(r'[0-9]+ [a-zA-Z,\-\' \/\(\)]+', line)
		if match:
			try:
				line = match.group().strip()
				num, name = line.split(' ', 1)
				print line
				num = int(num)
				url = name_to_url(name)
				for _ in range(num):
					buf[i] = url
					i += 1
				print "\r\nFound %s, deck now has %d cards." % (name, len(buf))
			except Exception, e:
				print "Could not find '%s'" % line
	name = None
	while not name:
		print "> Name your deck:",
		name = raw_input().strip()
	DECKS[name] = {}
	DECKS[name]['urls'] = buf
	with open('m_deck.py', 'w') as deckfile:
		print >>deckfile, "DECKS = %s" % pprint.pformat(DECKS)
elif sys.argv[1] == '-l':
	print "Listing of Decks...\n =============="
	for name in DECKS.keys():
		print name
elif sys.argv[1] == '-r':
	print "Enter deck to remove"
	print "Enter 'done' when finished"
	while True:
		line = raw_input("> ").strip()
		if line == 'done': break
		try:
			del DECKS[line]
		except Exception, e:
			print "Could not delete deck '%s'" % line
	with open('m_deck.py', 'w') as deckfile:
		print >>deckfile, "DECKS = %s" % pprint.pformat(DECKS)
else:
	print "-a to add, -l to list, -r to remove"

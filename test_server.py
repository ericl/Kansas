#!/usr/bin/env python

import sys
from mod_pywebsocket import standalone

if __name__ == '__main__':
    if len(sys.argv) != 2:
        print "Usage: %s <port>" % sys.argv[0]
    else:
        print "Test console at http://localhost:%d/console.html" % int(sys.argv[1])
        standalone._main(['-p', sys.argv[1], '-d', 'server', '--log_level=info'])

#!/bin/bash
# Installs dependencies for Ubuntu 13.04

sudo apt-get install python-leveldb python-imaging subversion
svn checkout http://pywebsocket.googlecode.com/svn/trunk/ pywebsocket-read-only
cd pywebsocket-read-only/src
sudo python setup.py install

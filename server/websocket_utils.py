'''
Created on Mar 27, 2013

As named, this module includes all the websocket_utils

@author: huangchenglai
'''

import json
import time

class JSONOutput(object):
    """JSONOutput is a convenience class for working with websocket streams."""

    def __init__(self, stream, reqtype):
        self.stream = stream
        self.reqtype = reqtype

    def reply(self, datum):
        self.stream.send_message(
            json.dumps({
                'type': self.reqtype + '_resp',
                'data': datum,
                'time': time.time(),
            }), binary=False)
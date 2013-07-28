# Plugins for various board games compatible with Kansas.

import logging
import re
import urllib2


class MagicCardsInfoPlugin(object):
    BACK_URL = '/third_party/images/mtg_detail.jpg'

    def Fetch(self, name, exact):
        url = "http://magiccards.info/query?q=%s%s&v=card&s=cname" %\
            ('!' if exact else 'l:en+', '+'.join(name.split()))
        logging.info("GET " + url)
        req = urllib2.Request(url)
        stream = urllib2.urlopen(req)
        data = stream.read()
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

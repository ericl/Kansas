import os

kSmallImageSize = (92, 131)
kServingPrefix = ''
kLocalServingAddress = 'http://localhost:8000/'
kCachePath = '../cache'
kDBPath = '../db'
kDefaultSource = 'magiccards.info'

if not os.path.exists(kCachePath):
    os.makedirs(kCachePath)

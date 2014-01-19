import os

kSmallImageSize = (92, 131)
kServingPrefix = ''
kLocalServingAddress = 'http://localhost:9000/'
kCachePath = '../cache'
kDBPath = '../db'

if not os.path.exists(kCachePath):
    os.makedirs(kCachePath)

import os

kSmallImageSize = (92, 131)
kServingPrefix = ''
kLocalServingAddress = 'http://localhost:8000/'
kCachePath = '../cache'
kClientVersion = 42
kDBPath = '../db'

if not os.path.exists(kCachePath):
    os.makedirs(kCachePath)

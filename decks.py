# Deck configurations for kansas_wsh.

DEFAULT_DECK = {
    'deck_name': 'Test deck',
    'resource_prefix': 'third_party/cards52/cropped/',
    'default_back_url': 'Blue_Back.png',
    'board': {
        262145: [6,7,8,9],
        65540: [10],
    },
    'hands': {},
    'zIndex': {
        6: 0,
        7: 1,
        8: 2,
        9: 3,
        10: 4,
    },
    'orientations': {
        6: -1,
        7: -1,
        8: -1,
        9: -1,
        10: 2,
    },
    'urls': {
        6: '2C.png',
        7: '2D.png',
        8: '2H.png',
        9: '2S.png',
        10: '3C.png',
    },
    'back_urls': {
        6: 'Red_Back.png',
    },
    'titles': {
        6: '2 of Clubs',
        7: '2 of Diamonds',
        8: '2 of Hearts',
        9: '2 of Spades',
        10: '3 of Clubs',
    }
}

DEFAULT_MAGIC_DECK = {
    'deck_name': 'Test magic deck',
    'resource_prefix': 'http://gatherer.wizards.com/Handlers/Image.ashx?type=card&multiverseid=',
    'default_back_url': '5607',
    'board': {
        262145: [12, 4, 9, 10, 23, 19, 27, 13, 15, 14, 2, 28, 25, 17, 29, 18, 26, 20, 8, 1, 24, 7, 0, 5, 3, 6, 21, 11, 16, 22],
    },
    'hands': {
    },
    'zIndex': {
    },
    'orientations': {
    },
    'urls': {
        0: 141959,
        1: 195402,
        2: 195402,
        3: 141959,
        4: 96918,
        5: 141959,
        6: 96918,
        7: 96918,
        8: 289314,
        9: 289323,
        10: 289314,
        11: 289314,
        12: 141959,
        13: 278063,
        14: 278063,
        15: 278063,
        16: 289323,
        17: 205026,
        18: 289323,
        19: 205026,
        20: 209046,
        21: 195402,
        22: 209046,
        23: 289323,
        24: 209046,
        25: 239968,
        26: 239968,
        27: 239968,
        28: 35344,
        29: 35344,
    },
    'back_urls': {
    },
    'titles': {
    }
}

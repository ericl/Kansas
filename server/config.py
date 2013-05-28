'''
Created on Mar 29, 2013

@author: huangchenglai
'''
import json

CONFIG_FILE = "config.json"
DECKS = "decks"
P1 = "44892300"
P2 = "70321710"

def update_player_deck(deckfile, player):
    with open(CONFIG_FILE, "r") as f:
        config = json.load(f)
    if player == 1:
        config[DECKS][P1] = deckfile
    elif player == 2:
        config[DECKS][P2] = deckfile
    with open(CONFIG_FILE, "w") as f:
        json.dump(config, f)
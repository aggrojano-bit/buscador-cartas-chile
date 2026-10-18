"""Game of Magic Singles (Shopify, Concepción) - https://gameofmagicsingles.cl

Usa el mismo formato que Oasis Games:
  título "Sol Ring (288) (Pool Party Foil) [Secret Lair Drop Series]",
  variantes "Near Mint Foil", SKU "SLD-288-PPF-EN-FO-1".
"""
from .oasisgames import OasisGames


class GameOfMagic(OasisGames):
    id = "gameofmagic"
    nombre = "Game of Magic"
    url = "https://gameofmagicsingles.cl"
    tipo_producto = "MTG Single"

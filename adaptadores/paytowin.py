"""Pay to Win MTG (Shopify) - https://www.paytowin.cl

Usa el mismo formato que Oasis Games:
  título "Sol Ring [Fallout]", variantes "Near Mint Foil", SKU "PIP-239-EN-FO-1".
"""
from .oasisgames import OasisGames


class PayToWin(OasisGames):
    id = "paytowin"
    nombre = "Pay to Win"
    url = "https://www.paytowin.cl"
    tipo_producto = "MTG Single"

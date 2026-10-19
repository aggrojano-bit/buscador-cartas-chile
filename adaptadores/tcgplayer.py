"""TCGplayer (EE.UU.) - https://www.tcgplayer.com

No se lee su sitio: se usan los precios de TCGplayer que Scryfall entrega con cada
edición (Scryfall los recibe directamente de TCGplayer) y su enlace al producto.
Es el precio de mercado (market price) de cartas NM; TCGplayer es un marketplace,
así que el precio real depende del vendedor. No informa stock.
"""
from .base import Adaptador, Oferta


class TCGplayer(Adaptador):
    id = "tcgplayer"
    nombre = "TCGplayer"
    url = "https://www.tcgplayer.com"
    busqueda = "/search/magic/product?q={q}"
    pais = "US"
    moneda = "USD"

    async def buscar(self, nombre_carta, ediciones=None, avance=None):
        ofertas = []
        for e in ediciones or []:
            enlace = e["enlaces"].get("tcgplayer") or self.enlace_busqueda(nombre_carta)
            for acabado, precio in e["precios_scryfall"]["tcgplayer"].items():
                if not precio:
                    continue
                ofertas.append(Oferta(
                    tienda=self.id,
                    titulo=f"{e['nombre']} [{e['set_nombre']}] #{e['numero']} (precio de mercado)",
                    url=enlace,
                    precio=precio,
                    moneda="USD",
                    condicion="NM",
                    acabado=acabado,
                    scryfall_id=e["id"],
                    stock_conocido=False,
                ))
        return ofertas

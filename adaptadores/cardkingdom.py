"""Card Kingdom (EE.UU.) - https://www.cardkingdom.com

Su sitio está protegido con Cloudflare, así que no se lee directamente: se usan
los precios diarios que publica MTGJSON (ya descargados por app/cardkingdom.py),
que vienen con el id de Scryfall de cada edición.
Limitación: MTGJSON no informa el stock. Los precios son de cartas NM en inglés.
"""
from app import cardkingdom

from .base import Adaptador, ErrorTienda, Oferta


class CardKingdom(Adaptador):
    id = "cardkingdom"
    nombre = "Card Kingdom"
    url = "https://www.cardkingdom.com"
    busqueda = "/catalog/search?search=header&filter%5Bname%5D={q}"
    pais = "US"
    moneda = "USD"

    async def buscar(self, nombre_carta, ediciones=None, avance=None):
        ediciones = ediciones or []
        precios = cardkingdom.precios(e["id"] for e in ediciones)
        if not precios and cardkingdom.estado["cargando"]:
            raise ErrorTienda("todavía se están descargando los precios de MTGJSON")
        ofertas = []
        for e in ediciones:
            for acabado, dato in precios.get(e["id"], {}).items():
                ofertas.append(Oferta(
                    tienda=self.id,
                    titulo=f"{e['nombre']} [{e['set_nombre']}] #{e['numero']}",
                    url=dato["url"] or f"{self.url}/catalog/search?filter%5Bname%5D={nombre_carta}",
                    precio=dato["precio"],
                    moneda="USD",
                    condicion="NM",
                    idioma="EN",
                    acabado=acabado,
                    scryfall_id=e["id"],
                    stock_conocido=False,
                ))
        return ofertas

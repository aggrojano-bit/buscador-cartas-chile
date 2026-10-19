"""Friki Cards (Jumpseller) - https://www.frikicards.cl

Su robots.txt prohíbe el buscador, así que se usa su sitemap (ver _jumpseller_sitemap.py).
  nombre       "Sol Ring - Commander 2013 (inglés)"
               "Sol Ring (Love Your LGS Foil) - Promotional (inglés)"
  descripción  "Condición: NM ..."
Casi nunca indica el número de colección, y no informa cuántas unidades quedan.
"""
import re

from ._jumpseller_sitemap import AdaptadorJumpsellerSitemap, precio_y_disponibilidad
from .base import Oferta, acabado_desde_texto, condicion, idioma

NOMBRE = re.compile(r"^(?P<carta>.+?)(?:\s*\((?P<variante>[^)]*)\))?\s+-\s+(?P<set>.+?)(?:\s*\((?P<idioma>[^)]*)\))?\s*$")
# "Condición: NMCualquier otro detalle..." (el texto viene pegado, por eso se buscan los valores conocidos)
CONDICION = re.compile(r"Condici[oó]n:\s*(Near Mint|Lightly Played|Moderately Played|Heavily Played|Damaged|NM|LP|MP|HP|DMG|EX|SP|PL)")


class FrikiCards(AdaptadorJumpsellerSitemap):
    id = "frikicards"
    nombre = "Friki Cards"
    url = "https://www.frikicards.cl"
    # Sus términos permiten ver la tienda solo para uso personal (no volver a publicar su contenido)
    solo_uso_personal = True

    def interpretar(self, url, producto, ruta, opciones, pagina):
        precio, disponible, moneda = precio_y_disponibilidad(producto)
        if precio <= 0:
            return None
        nombre = producto["name"]
        partes = NOMBRE.match(nombre)
        texto_condicion = CONDICION.search(producto.get("description") or "")
        texto_condicion = texto_condicion.group(1) if texto_condicion else ""
        # A veces el número va en el paréntesis: "Lightning Bolt (675 - Hadoken - Non-Foil) - Secret Lair"
        numero = re.match(r"(\d{1,4}[a-z]?)\b", partes.group("variante") or "") if partes else None
        return Oferta(
            tienda=self.id,
            titulo=nombre,
            url=url,
            precio=precio,
            moneda=moneda,
            disponible=disponible,
            stock=None if disponible else 0,
            condicion=condicion(texto_condicion),
            condicion_original=texto_condicion or None,
            idioma=idioma(partes.group("idioma") or "") if partes else idioma(nombre),
            acabado=acabado_desde_texto(nombre),
            set_nombre=partes.group("set") if partes else None,
            numero=numero.group(1) if numero else None,
        )

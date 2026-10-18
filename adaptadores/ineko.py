"""Ineko Card Shop (WooCommerce) - https://inekosingles.com

Productos con variantes de condición/foil:
  título    "Sol Ring (0910) [Secret Lair Drop Series]"
  variante  "Variante: Near Mint Foil"
Las variantes (con precio y stock) se piden en una sola consulta por grupo de productos.
La tienda no indica el idioma en la mayoría de las cartas.
"""
from ._woocommerce import AdaptadorWooCommerce, precio, stock_variante
from .base import (Oferta, acabado_desde_texto, condicion, entre_corchetes, idioma,
                   numero_entre_parentesis, solo_disponibles)


class Ineko(AdaptadorWooCommerce):
    id = "ineko"
    nombre = "Ineko Card Shop"
    url = "https://inekosingles.com"

    async def buscar(self, nombre_carta, ediciones=None, avance=None):
        productos = {p["id"]: p for p in await self.productos(nombre_carta, stock_status="instock")}
        variantes = await self.variantes(productos)

        ofertas = []
        for pid, p in productos.items():
            titulo = p["name"]
            es_etched = "etched" in titulo.lower()
            del_producto = []
            for v in variantes.get(pid, []):
                texto = str(v.get("variation") or "").split(":", 1)[-1].strip()
                acabado = acabado_desde_texto(texto)
                if acabado == "foil" and es_etched:
                    acabado = "etched"
                del_producto.append(Oferta(
                    tienda=self.id,
                    titulo=titulo,
                    url=p["permalink"],
                    precio=precio(v["prices"]),
                    disponible=bool(v["is_in_stock"]),
                    stock=stock_variante(v),
                    condicion=condicion(texto),
                    condicion_original=texto or None,
                    idioma=idioma(titulo),
                    acabado=acabado,
                    set_nombre=entre_corchetes(titulo),
                    numero=numero_entre_parentesis(titulo),
                ))
            ofertas.extend(solo_disponibles(del_producto))
        return ofertas

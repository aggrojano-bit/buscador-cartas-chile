"""Ineko Card Shop (WooCommerce) - https://inekosingles.com

Productos con variantes de condición/foil:
  título    "Sol Ring (0910) [Secret Lair Drop Series]"
  variante  "Variante: Near Mint Foil"
Las variantes (con precio y stock) se piden en una sola consulta por grupo de productos.
La tienda no indica el idioma en la mayoría de las cartas.
"""
import re

from ._woocommerce import AdaptadorWooCommerce, precio
from .base import (Oferta, acabado_desde_texto, condicion, entre_corchetes, idioma,
                   numero_entre_parentesis, solo_disponibles)

GRUPO = 12  # productos por consulta de variantes (12 x 8 variantes < 100)


class Ineko(AdaptadorWooCommerce):
    id = "ineko"
    nombre = "Ineko Card Shop"
    url = "https://inekosingles.com"

    async def buscar(self, nombre_carta):
        productos = {p["id"]: p for p in await self.productos(nombre_carta, stock_status="instock")}
        variantes = {}
        ids = list(productos)
        for i in range(0, len(ids), GRUPO):
            resp = await self.get(f"{self.url}/wp-json/wc/store/v1/products", params={
                "type": "variation", "parent[]": ids[i:i + GRUPO], "per_page": 100})
            for v in resp.json():
                variantes.setdefault(v["parent"], []).append(v)

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
                disponible_texto = (v.get("stock_availability") or {}).get("text", "")
                cantidad = v.get("low_stock_remaining")
                if cantidad is None and re.match(r"^\d+", disponible_texto):
                    cantidad = int(re.match(r"^\d+", disponible_texto).group())
                del_producto.append(Oferta(
                    tienda=self.id,
                    titulo=titulo,
                    url=p["permalink"],
                    precio=precio(v["prices"]),
                    disponible=bool(v["is_in_stock"]),
                    stock=cantidad if v["is_in_stock"] else 0,
                    condicion=condicion(texto),
                    condicion_original=texto or None,
                    idioma=idioma(titulo),
                    acabado=acabado,
                    set_nombre=entre_corchetes(titulo),
                    numero=numero_entre_parentesis(titulo),
                ))
            ofertas.extend(solo_disponibles(del_producto))
        return ofertas

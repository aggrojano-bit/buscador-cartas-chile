"""La Cripta (WooCommerce) - https://lacripta.cl

Productos con variantes de idioma y estado:
  título      "Sol Ring (0356)"                      -> número
  categorías  "MTG", "Final Fantasy Commander Decks"  -> edición
  variante    "Idioma: Inglés, Estado: NM"
"""
from ._woocommerce import AdaptadorWooCommerce, precio, stock_variante
from .base import Oferta, acabado_desde_texto, condicion, idioma, numero_entre_parentesis, solo_disponibles

CATEGORIAS_GENERICAS = {"mtg", "magic", "magic: the gathering", "singles", "sin categorizar"}


class LaCripta(AdaptadorWooCommerce):
    id = "lacripta"
    nombre = "La Cripta"
    url = "https://lacripta.cl"

    async def buscar(self, nombre_carta, ediciones=None, avance=None):
        productos = {p["id"]: p for p in await self.productos(nombre_carta, stock_status="instock")}
        variantes = await self.variantes(productos)

        ofertas = []
        for pid, p in productos.items():
            titulo = p["name"]
            categorias = [c["name"] for c in p.get("categories", []) if c["name"].lower() not in CATEGORIAS_GENERICAS]
            del_producto = []
            for v in variantes.get(pid, []):
                texto = str(v.get("variation") or "")
                del_producto.append(Oferta(
                    tienda=self.id,
                    titulo=titulo + (f" [{categorias[0]}]" if categorias else ""),
                    url=p["permalink"],
                    precio=precio(v["prices"]),
                    disponible=bool(v["is_in_stock"]),
                    stock=stock_variante(v),
                    condicion=condicion(texto),
                    condicion_original=texto or None,
                    idioma=idioma(texto),
                    acabado=acabado_desde_texto(titulo + " " + texto),
                    set_nombre=categorias[0] if categorias else None,
                    numero=numero_entre_parentesis(titulo),
                ))
            ofertas.extend(solo_disponibles(del_producto))
        return ofertas

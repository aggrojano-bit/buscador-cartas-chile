"""Base para tiendas hechas con Shopify.

1. Usa el buscador público de la tienda (/search) para encontrar los productos.
2. Lee cada producto en formato JSON (/products/<handle>.js), que trae
   las variantes con precio y disponibilidad. Se piden hasta 3 a la vez,
   respetando el ritmo máximo de la tienda (ver pausa).
Cada tienda solo define cómo interpretar sus títulos y variantes.
"""
import asyncio
import re

from .base import Adaptador, ErrorTienda, nombre_coincide, slug

MAX_PAGINAS = 5
MAX_PRODUCTOS = 80
EN_PARALELO = 3


class AdaptadorShopify(Adaptador):
    pausa = 0.5   # máximo 2 peticiones por segundo: Shopify está hecho para mucho tráfico

    async def buscar(self, nombre_carta, ediciones=None, avance=None):
        nombre = nombre_carta.split(" // ")[0]
        semaforo = asyncio.Semaphore(EN_PARALELO)

        async def leer_producto(handle):
            async with semaforo:
                resp = await self.get(f"{self.url}/products/{handle}.js")
            if resp.status_code != 200:
                return []
            producto = resp.json()
            if not nombre_coincide(producto["title"], nombre):
                return []
            ofertas = self.interpretar(producto)
            if avance is not None:
                avance.extend(ofertas)
            return ofertas

        # Los productos se empiezan a leer apenas aparece cada página de resultados
        tareas = []
        try:
            await self._buscar_handles(nombre, al_encontrar=lambda h: tareas.append(asyncio.create_task(leer_producto(h))))
            resultados = await asyncio.gather(*tareas)
        except BaseException:
            for t in tareas:
                t.cancel()
            raise
        return [o for lista in resultados for o in lista]

    async def _buscar_handles(self, nombre, al_encontrar):
        clave = slug(nombre)
        handles = []
        for pagina in range(1, MAX_PAGINAS + 1):
            resp = await self.get(f"{self.url}/search", params={"q": nombre, "type": "product", "page": pagina})
            if resp.status_code != 200:
                raise ErrorTienda(f"el buscador respondió HTTP {resp.status_code}")
            encontrados = dict.fromkeys(re.findall(r'href="(?:/[a-z]{2}(?:-[a-z]{2})?)?/products/([^"?#/]+)', resp.text))
            nuevos = [h for h in encontrados if clave in h and h not in handles][:MAX_PRODUCTOS - len(handles)]
            if not nuevos:
                break
            for h in nuevos:
                al_encontrar(h)
            handles.extend(nuevos)
            if len(handles) >= MAX_PRODUCTOS:
                break
        return handles

    def url_producto(self, producto):
        return f"{self.url}/products/{producto['handle']}"

    def interpretar(self, producto):
        """Convierte un producto de Shopify en una lista de Oferta."""
        raise NotImplementedError

"""Base para tiendas Jumpseller cuyo robots.txt prohíbe usar el buscador (/search).

En vez del buscador se usa el sitemap (el índice de páginas que la propia tienda
publica para los buscadores): se descarga como máximo una vez al día, se buscan
los enlaces cuyo nombre empieza con la carta y se lee cada página de producto
(datos estructurados JSON-LD + opciones del producto).
"""
import asyncio
import json
import re
import time

from app import red
from app.config import CARPETA_DATOS

from .base import Adaptador, nombre_coincide, slug

HORAS_SITEMAP = 24
MAX_PRODUCTOS = 60
EN_PARALELO = 3


class AdaptadorJumpsellerSitemap(Adaptador):
    pausa = 0.5   # máximo 2 peticiones por segundo (Jumpseller es una plataforma en la nube)
    rutas_robots = ["/sitemap.xml", "/sol-ring"]

    def __init__(self):
        self._urls = None
        self._fecha_urls = 0

    async def _urls_sitemap(self):
        ruta = CARPETA_DATOS / f"sitemap_{self.id}.xml"
        if not ruta.exists() or time.time() - ruta.stat().st_mtime > HORAS_SITEMAP * 3600:
            await self.revisar_robots(f"{self.url}/sitemap.xml")
            await red.descargar(f"{self.url}/sitemap.xml", ruta, pausa=self.pausa)
        fecha = ruta.stat().st_mtime
        if self._urls is None or self._fecha_urls != fecha:
            texto = await asyncio.to_thread(ruta.read_text, encoding="utf-8")
            self._urls = re.findall(r"<loc>([^<]+)</loc>", texto)
            self._fecha_urls = fecha
        return self._urls

    async def buscar(self, nombre_carta, ediciones=None, avance=None):
        nombre = nombre_carta.split(" // ")[0]
        patron = re.compile(rf"/{re.escape(slug(nombre))}(-[^/]*)?$")
        urls = [u for u in await self._urls_sitemap() if patron.search(u)][:MAX_PRODUCTOS]
        semaforo = asyncio.Semaphore(EN_PARALELO)

        async def leer(url):
            async with semaforo:
                resp = await self.get(url)
            if resp.status_code != 200:
                return None
            producto, ruta, opciones = datos_pagina(resp.text)
            if not producto or not nombre_coincide(producto.get("name", ""), nombre):
                return None
            oferta = self.interpretar(url, producto, ruta, opciones, resp.text)
            if oferta and avance is not None:
                avance.append(oferta)
            return oferta

        resultados = await asyncio.gather(*(leer(u) for u in urls))
        return [o for o in resultados if o]

    def interpretar(self, url, producto, ruta, opciones, pagina):
        raise NotImplementedError


def datos_pagina(pagina):
    """(producto JSON-LD, nombres de la ruta de navegación, {opción: valor})"""
    producto, ruta = None, []
    for bloque in re.findall(r'<script type="application/ld\+json"[^>]*>(.*?)</script>', pagina, re.S):
        try:
            datos = json.loads(bloque)
        except ValueError:
            continue
        for nodo in datos if isinstance(datos, list) else [datos]:
            if nodo.get("@type") == "Product":
                producto = nodo
            elif nodo.get("@type") == "BreadcrumbList":
                ruta = [e["item"]["name"] for e in nodo.get("itemListElement", [])]
    opciones = {}
    m = re.search(r'"options":\s*(\[.*?\])\s*,\s*"option_types"', pagina, re.S)
    if m:
        try:
            for o in json.loads(m.group(1)):
                valores = [v["name"] for v in o.get("values", [])]
                if len(valores) == 1:
                    opciones[o["name"].lower()] = valores[0]
        except (ValueError, KeyError, TypeError):
            pass
    return producto, ruta, opciones


def precio_y_disponibilidad(producto):
    oferta = producto.get("offers") or {}
    if isinstance(oferta, list):
        oferta = oferta[0] if oferta else {}
    precio = float(oferta.get("price") or oferta.get("lowPrice") or 0)
    return precio, str(oferta.get("availability", "")).endswith("InStock"), oferta.get("priceCurrency", "CLP")

"""Cliente HTTP compartido.

Todas las consultas a internet pasan por aquí para que:
  - lleven un User-Agent identificable, y
  - respeten una pausa mínima entre peticiones al mismo sitio.
"""
import asyncio
import time
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from .config import AJUSTES

_contacto = AJUSTES["general"].get("contacto", "").strip()
USER_AGENT = "BuscadorCartasChile/0.1 (app personal, uso no comercial" + (f"; {_contacto}" if _contacto else "") + ")"

_cliente = None
_candados = {}   # un candado por sitio, para hacer las peticiones de a una
_ultima = {}     # hora de la última petición a cada sitio


def cliente():
    global _cliente
    if _cliente is None:
        _cliente = httpx.AsyncClient(
            headers={"User-Agent": USER_AGENT, "Accept": "application/json;q=0.9,*/*;q=0.8"},
            timeout=httpx.Timeout(30, connect=10),
            follow_redirects=True,
        )
    return _cliente


async def cerrar():
    if _cliente is not None:
        await _cliente.aclose()


async def _esperar_turno(host, pausa):
    espera = _ultima.get(host, 0) + pausa - time.monotonic()
    if espera > 0:
        await asyncio.sleep(espera)


async def obtener(url, *, pausa, params=None, headers=None):
    """GET respetando la pausa mínima para ese sitio."""
    host = urlsplit(url).hostname
    candado = _candados.setdefault(host, asyncio.Lock())
    async with candado:
        await _esperar_turno(host, pausa)
        try:
            return await cliente().get(url, params=params, headers=headers)
        finally:
            _ultima[host] = time.monotonic()


async def descargar(url, destino: Path, *, pausa=1.0):
    """Descarga un archivo grande a disco sin cargarlo entero en memoria."""
    host = urlsplit(url).hostname
    candado = _candados.setdefault(host, asyncio.Lock())
    temporal = destino.with_suffix(destino.suffix + ".parcial")
    async with candado:
        await _esperar_turno(host, pausa)
        try:
            async with cliente().stream("GET", url, timeout=httpx.Timeout(300, connect=15)) as resp:
                resp.raise_for_status()
                with open(temporal, "wb") as archivo:
                    async for trozo in resp.aiter_bytes(1 << 16):
                        archivo.write(trozo)
        finally:
            _ultima[host] = time.monotonic()
    temporal.replace(destino)

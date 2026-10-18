"""Cliente HTTP compartido.

Todas las consultas a internet pasan por aquí para que:
  - lleven un User-Agent identificable, y
  - respeten una pausa mínima entre el inicio de dos peticiones al mismo sitio
    (pausa=0.5 significa como máximo 2 peticiones por segundo a ese sitio).
"""
import asyncio
import time
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from .config import CONTACTO

USER_AGENT = "BuscadorCartasChile/0.1 (app personal, uso no comercial" + (f"; {CONTACTO}" if CONTACTO else "") + ")"

_cliente = None
_candados = {}   # un candado por sitio, para repartir los turnos en orden
_ultima = {}     # hora en que empezó (o empezará) la última petición a cada sitio


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


async def _esperar_turno(url, pausa):
    """Reserva el próximo turno libre para ese sitio y espera hasta que llegue."""
    host = urlsplit(url).hostname
    async with _candados.setdefault(host, asyncio.Lock()):
        turno = max(time.monotonic(), _ultima.get(host, 0) + pausa)
        _ultima[host] = turno
    espera = turno - time.monotonic()
    if espera > 0:
        await asyncio.sleep(espera)


async def obtener(url, *, pausa, params=None, headers=None):
    """GET respetando la pausa mínima para ese sitio."""
    await _esperar_turno(url, pausa)
    return await cliente().get(url, params=params, headers=headers)


async def descargar(url, destino: Path, *, pausa=1.0):
    """Descarga un archivo grande a disco sin cargarlo entero en memoria."""
    temporal = destino.with_suffix(destino.suffix + ".parcial")
    await _esperar_turno(url, pausa)
    async with cliente().stream("GET", url, timeout=httpx.Timeout(300, connect=15)) as resp:
        resp.raise_for_status()
        with open(temporal, "wb") as archivo:
            async for trozo in resp.aiter_bytes(1 << 16):
                archivo.write(trozo)
    temporal.replace(destino)

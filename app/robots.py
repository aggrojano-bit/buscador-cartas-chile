"""Respeta el robots.txt de cada tienda, también cuando la tienda lo cambia.

- Antes de cada consulta a una tienda se revisa que su robots.txt la permita.
- Una vez al día se vuelve a leer el robots.txt de todas las tiendas. Si alguna
  pasa a prohibir lo que la app lee, esa tienda queda sola en modo «a mano»
  (y vuelve a leerse automáticamente si la tienda lo permite de nuevo).

Las reglas se interpretan como dice el estándar (RFC 9309): se usa el grupo que
nombra a este programa o, si no hay, el grupo "*"; gana la regla más larga que
calce con la ruta; "*" calza con cualquier texto y "$" marca el final.
"""
import logging
import re
import time
from urllib.parse import urlsplit

import httpx

from . import db, red

HORAS = 24
NOMBRE_BOT = "buscadorcartaschile"   # cómo se llama este programa en el User-Agent (red.py)

log = logging.getLogger("robots")
_reglas = {}     # sitio -> (momento en que se leyó, lista de reglas)
bloqueos = {}    # id de tienda -> ruta que su robots.txt prohíbe


class RobotsProhibe(Exception):
    """El robots.txt de la tienda prohíbe la ruta que se iba a leer."""


def interpretar(texto):
    """Reglas que aplican a este programa: lista de (permitir, patrón)."""
    grupos = []          # (agentes, reglas)
    agentes, reglas, en_reglas = [], [], False
    for linea in texto.splitlines():
        linea = linea.split("#", 1)[0].strip()
        if ":" not in linea:
            continue
        campo, valor = (x.strip() for x in linea.split(":", 1))
        campo = campo.lower()
        if campo == "user-agent":
            if en_reglas:   # empieza un grupo nuevo
                grupos.append((agentes, reglas))
                agentes, reglas, en_reglas = [], [], False
            agentes.append(valor.lower())
        elif campo in ("allow", "disallow"):
            en_reglas = True
            if valor:       # "Disallow:" vacío no prohíbe nada
                reglas.append((campo == "allow", valor))
    if agentes:
        grupos.append((agentes, reglas))

    propias = [r for ags, rs in grupos if any(a != "*" and a in NOMBRE_BOT for a in ags) for r in rs]
    if propias:
        return propias
    return [r for ags, rs in grupos if "*" in ags for r in rs]


def _calza(patron, ruta):
    regex = re.escape(patron).replace(r"\*", ".*")
    if regex.endswith(r"\$"):
        regex = regex[:-2] + "$"
    return re.match(regex, ruta) is not None


def permitido(reglas, ruta):
    """Gana la regla más larga que calza; si empatan, la que permite."""
    mejor = None
    for permite, patron in reglas:
        if _calza(patron, ruta):
            clave = (len(patron), permite)
            if mejor is None or clave > mejor:
                mejor = clave
    return mejor is None or mejor[1]


async def _reglas_de(sitio):
    """Reglas del sitio (https://host). None = no se pudo leer el robots.txt."""
    guardado = _reglas.get(sitio)
    if guardado and time.time() - guardado[0] < HORAS * 3600:
        return guardado[1]
    clave = f"robots:{sitio}"
    texto = db.cache_leer(clave)
    if texto is None:
        try:
            resp = await red.obtener(f"{sitio}/robots.txt", pausa=1.0)
        except httpx.HTTPError as error:
            resp = None
            log.warning("No se pudo leer %s/robots.txt: %s", sitio, error)
        if resp is not None and resp.status_code < 300:
            texto = resp.text
        elif resp is not None and 400 <= resp.status_code < 500 and resp.status_code not in (403, 429):
            texto = ""   # sin robots.txt: todo permitido
        if texto is None:
            # No se pudo saber: se usa lo último conocido (aunque esté vencido)
            texto = db.cache_leer(clave, permitir_vencido=True)
            if texto is None:
                return None
        else:
            db.cache_guardar(clave, texto, HORAS)
    reglas = interpretar(texto)
    _reglas[sitio] = (time.time(), reglas)
    return reglas


async def ruta_prohibida(url, params=None):
    """Devuelve la ruta si el robots.txt la prohíbe; None si se puede leer (o no se sabe)."""
    completa = httpx.URL(url, params=params)
    partes = urlsplit(str(completa))
    ruta = completa.raw_path.decode()
    reglas = await _reglas_de(f"{partes.scheme}://{partes.netloc}")
    if reglas is None or permitido(reglas, ruta):
        return None
    return ruta


async def revisar_tienda(adaptador):
    """Revisa las rutas que usa la tienda y actualiza su bloqueo. Devuelve la ruta prohibida o None."""
    for ruta in adaptador.rutas_robots:
        prohibida = await ruta_prohibida(adaptador.url + ruta)
        if prohibida:
            if adaptador.id not in bloqueos:
                log.warning("%s: su robots.txt ahora prohíbe %s; pasa a revisarse a mano", adaptador.nombre, prohibida)
            bloqueos[adaptador.id] = prohibida
            return prohibida
    if bloqueos.pop(adaptador.id, None):
        log.info("%s: su robots.txt vuelve a permitir la lectura", adaptador.nombre)
    return None


async def revisar_todas(adaptadores):
    """Revisa todas las tiendas que tienen rutas que vigilar. Devuelve {id: ruta prohibida o None}."""
    resultado = {}
    for a in adaptadores:
        if a.rutas_robots:
            resultado[a.id] = await revisar_tienda(a)
    return resultado

"""Consulta todas las tiendas en paralelo, con caché, y empareja los resultados.

Cada tienda corre en su propia tarea de fondo: la página pregunta cada pocos
segundos y va mostrando las tiendas a medida que terminan. Si una tienda falla,
las demás siguen; si había datos guardados de antes, se muestran marcados como antiguos.
"""
import asyncio
import logging
import time

from adaptadores import ACTIVAS, NO_INCLUIDAS

from . import db
from .config import AJUSTES
from .emparejar import emparejar

HORAS = AJUSTES["cache"]["horas_precios_tiendas"]
TIEMPO_MAXIMO = 240           # segundos que se espera a una tienda antes de darla por caída
REINTENTO_TRAS_ERROR = 600    # no reintentar una tienda caída antes de 10 minutos

log = logging.getLogger("tiendas")
_tareas = {}    # clave -> tarea en curso
_errores = {}   # clave -> (momento, resultado) de la última falla


def _clave(adaptador, carta):
    return f"tienda:{adaptador.id}:{carta.lower()}"


async def _ejecutar(adaptador, carta, ediciones, clave):
    inicio = time.time()
    try:
        busqueda = adaptador.buscar(carta, ediciones) if adaptador.usa_ediciones else adaptador.buscar(carta)
        ofertas = await asyncio.wait_for(busqueda, TIEMPO_MAXIMO)
        resultado = {"estado": "ok", "fecha": time.time(),
                     "ofertas": [o.a_dict() for o in ofertas if o.precio > 0]}
        db.cache_guardar(clave, resultado, HORAS)
        _errores.pop(clave, None)
        log.info("%s: %d ofertas para %s (%.0f s)", adaptador.nombre, len(resultado["ofertas"]), carta, time.time() - inicio)
    except Exception as error:
        mensaje = "tardó demasiado en responder" if isinstance(error, asyncio.TimeoutError) else str(error) or type(error).__name__
        log.warning("%s no disponible: %s", adaptador.nombre, mensaje)
        anterior = db.cache_leer(clave, permitir_vencido=True)
        if anterior:
            resultado = {**anterior, "estado": "antiguo", "error": mensaje}
        else:
            resultado = {"estado": "error", "error": mensaje, "fecha": time.time(), "ofertas": []}
        _errores[clave] = (time.time(), resultado)


def _resultado_guardado(clave):
    guardado = db.cache_leer(clave)
    if guardado is not None:
        return guardado
    falla = _errores.get(clave)
    if falla and time.time() - falla[0] < REINTENTO_TRAS_ERROR:
        return falla[1]
    return None


def consultar(carta, ediciones, forzar=False):
    """Estado de cada tienda + ofertas emparejadas. Lanza las consultas que falten."""
    tiendas = []
    ofertas = []
    for adaptador in ACTIVAS:
        clave = _clave(adaptador, carta)
        info = adaptador.info()
        tarea = _tareas.get(clave)
        if tarea and not tarea.done():
            tiendas.append({**info, "estado": "cargando"})
            continue
        resultado = None if forzar else _resultado_guardado(clave)
        if resultado is None:
            _errores.pop(clave, None)
            _tareas[clave] = asyncio.create_task(_ejecutar(adaptador, carta, ediciones, clave))
            tiendas.append({**info, "estado": "cargando"})
            continue
        tiendas.append({**info, "estado": resultado["estado"], "error": resultado.get("error"),
                        "fecha": resultado.get("fecha"), "cantidad": len(resultado["ofertas"])})
        for o in resultado["ofertas"]:
            edicion, motivo, candidatos = emparejar(o, ediciones)
            ofertas.append({**o, "pais": adaptador.pais, "tienda_nombre": adaptador.nombre,
                            "edicion_id": edicion, "emparejado_por": motivo, "candidatos": candidatos})
    return {
        "tiendas": tiendas,
        "completo": all(t["estado"] != "cargando" for t in tiendas),
        "ofertas": ofertas,
        "no_incluidas": NO_INCLUIDAS,
    }

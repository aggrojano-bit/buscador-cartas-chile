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
MINIMO_ENTRE_ACTUALIZACIONES = 600   # "Actualizar precios" no vuelve a consultar datos de hace menos de 10 min

log = logging.getLogger("tiendas")
_tareas = {}    # clave -> tarea en curso
_parciales = {} # clave -> ofertas encontradas hasta ahora por una tienda que sigue buscando
_errores = {}   # clave -> (momento, resultado) de la última falla


def _clave(adaptador, carta):
    return f"tienda:{adaptador.id}:{carta.lower()}"


async def _ejecutar(adaptador, carta, ediciones, clave):
    inicio = time.time()
    avance = _parciales[clave] = []
    try:
        ofertas = await asyncio.wait_for(adaptador.buscar(carta, ediciones, avance), TIEMPO_MAXIMO)
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
    finally:
        _parciales.pop(clave, None)


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

    def agregar(adaptador, lista):
        for o in lista:
            edicion, motivo, candidatos = emparejar(o, ediciones)
            ofertas.append({**o, "pais": adaptador.pais, "tienda_nombre": adaptador.nombre,
                            "edicion_id": edicion, "emparejado_por": motivo, "candidatos": candidatos})

    for adaptador in ACTIVAS:
        clave = _clave(adaptador, carta)
        info = {**adaptador.info(), "busqueda": adaptador.enlace_busqueda(carta)}
        motivo = adaptador.modo_manual()
        if motivo:
            # No se consulta: la página muestra el enlace a la tienda y deja ingresar el precio a mano
            tiendas.append({**info, "estado": "manual", "motivo": motivo, "cantidad": 0})
            continue
        tarea = _tareas.get(clave)
        if tarea and not tarea.done():
            # La tienda sigue buscando: se entrega lo que lleva hasta ahora
            parciales = [o.a_dict() for o in list(_parciales.get(clave, [])) if o.precio > 0]
            tiendas.append({**info, "estado": "cargando", "cantidad": len(parciales)})
            agregar(adaptador, parciales)
            continue
        resultado = _resultado_guardado(clave)
        if forzar and resultado and time.time() - resultado.get("fecha", 0) > MINIMO_ENTRE_ACTUALIZACIONES:
            resultado = None
        if resultado is None:
            _errores.pop(clave, None)
            _tareas[clave] = asyncio.create_task(_ejecutar(adaptador, carta, ediciones, clave))
            tiendas.append({**info, "estado": "cargando", "cantidad": 0})
            continue
        tiendas.append({**info, "estado": resultado["estado"], "error": resultado.get("error"),
                        "fecha": resultado.get("fecha"), "cantidad": len(resultado["ofertas"])})
        agregar(adaptador, resultado["ofertas"])
    return {
        "tiendas": tiendas,
        "completo": all(t["estado"] != "cargando" for t in tiendas),
        "ofertas": ofertas,
        "no_incluidas": NO_INCLUIDAS,
    }

"""Tipo de cambio entre CLP, USD, EUR y JPY, desde fuentes gratuitas.

- mindicador.cl: dólar y euro observados en Chile (Banco Central).
- Frankfurter (Banco Central Europeo): cuántos yenes vale un dólar.
- Respaldo si alguna falla: open.er-api.com.
Las tasas se guardan como "cuántos CLP vale 1 unidad de cada moneda".
"""
import logging

from . import db, red
from .config import AJUSTES

HORAS = AJUSTES["cache"]["horas_tipo_cambio"]
CLAVE = "tipo_cambio"
log = logging.getLogger("monedas")


async def _desde_mindicador():
    datos = (await red.obtener("https://mindicador.cl/api", pausa=1)).json()
    usd = (await red.obtener("https://api.frankfurter.dev/v1/latest",
                             pausa=1, params={"base": "USD", "symbols": "JPY"})).json()
    clp_usd = float(datos["dolar"]["valor"])
    return {
        "tasas": {
            "CLP": 1.0,
            "USD": clp_usd,
            "EUR": float(datos["euro"]["valor"]),
            "JPY": clp_usd / float(usd["rates"]["JPY"]),
        },
        "fecha": datos["dolar"]["fecha"][:10],
        "fuente": "mindicador.cl (Banco Central de Chile) + Frankfurter (BCE)",
    }


async def _desde_er_api():
    datos = (await red.obtener("https://open.er-api.com/v6/latest/CLP", pausa=1)).json()
    tasas = datos["rates"]
    return {
        "tasas": {"CLP": 1.0, "USD": 1 / tasas["USD"], "EUR": 1 / tasas["EUR"], "JPY": 1 / tasas["JPY"]},
        "fecha": datos["time_last_update_utc"][5:16],
        "fuente": "open.er-api.com",
    }


async def tipo_cambio():
    guardado = db.cache_leer(CLAVE)
    if guardado:
        return guardado
    for fuente in (_desde_mindicador, _desde_er_api):
        try:
            resultado = await fuente()
            resultado["desactualizado"] = False
            db.cache_guardar(CLAVE, resultado, HORAS)
            return resultado
        except Exception:
            log.warning("Falló la fuente de tipo de cambio %s", fuente.__name__, exc_info=True)
    # Sin internet: usar el último valor conocido, avisando que puede estar viejo
    viejo = db.cache_leer(CLAVE, permitir_vencido=True)
    if viejo:
        viejo["desactualizado"] = True
        return viejo
    return None

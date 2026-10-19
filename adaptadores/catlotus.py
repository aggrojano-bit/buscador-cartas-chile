"""Cat Lotus - https://catlotus.cl

Su página carga las cartas desde /api/, que su robots.txt prohíbe leer de forma
automática. Por eso solo se muestra el enlace a su catálogo y el precio se ingresa a mano.
"""
from .base import TiendaManual


class CatLotus(TiendaManual):
    id = "catlotus"
    nombre = "Cat Lotus"
    url = "https://catlotus.cl"
    busqueda = "/cartas"
    motivo = "Su catálogo se carga desde /api/, que su robots.txt prohíbe leer: se revisa a mano."

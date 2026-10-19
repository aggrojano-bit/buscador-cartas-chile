"""Star City Games (EE.UU.) - https://starcitygames.com

Sus términos prohíben leer el sitio con programas automáticos, incluidos los precios,
sin su permiso por escrito; además su robots.txt prohíbe el buscador.
Por eso solo se muestra el enlace a su buscador y el precio se anota a mano.
"""
from .base import TiendaManual


class StarCityGames(TiendaManual):
    id = "starcitygames"
    nombre = "Star City Games"
    url = "https://starcitygames.com"
    busqueda = "/search/?search_query={q}"
    pais = "US"
    moneda = "USD"
    motivo = "Sus términos prohíben leer sus precios con programas automáticos: se revisa a mano."

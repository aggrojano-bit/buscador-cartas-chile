"""Lista de tiendas activas.

Para QUITAR una tienda: bórrala de ACTIVAS (o ponle un # delante).
Para AGREGAR una: crea su archivo en esta carpeta y súmala a ACTIVAS.
"""
from .cardkingdom import CardKingdom
from .cardnexus import CardNexus
from .cardtrader import CardTrader
from .hareruya import Hareruya
from .ineko import Ineko
from .lacomarca import LaComarca
from .oasisgames import OasisGames
from .paytowin import PayToWin
from .piedrabruja import PiedraBruja
from .zendicard import ZendiCard

ACTIVAS = [
    OasisGames(),
    PayToWin(),
    LaComarca(),
    PiedraBruja(),
    CardNexus(),
    Ineko(),
    ZendiCard(),
    # Internacionales
    CardKingdom(),
    Hareruya(),
    CardTrader(),
]

# Tiendas revisadas que NO se consultan, y por qué (se muestran en la app)
NO_INCLUIDAS = [
    {"nombre": "Cartas Magicsur", "url": "https://www.cartasmagicsur.cl",
     "motivo": "Protegida con un control anti-robots (Vercel Security Checkpoint). Habría que pedir permiso a la tienda."},
    {"nombre": "Magicsur (juegos de mesa)", "url": "https://www.magicsur.cl",
     "motivo": "Su robots.txt prohíbe usar el buscador; sus cartas sueltas están en cartasmagicsur.cl."},
    {"nombre": "Marketplace Scry", "url": "https://marketplace.scry.cl",
     "motivo": "Sus términos prohíben extraer datos sin autorización. Se puede pedir permiso."},
    {"nombre": "Magic4ever", "url": "https://www.magic4ever.cl",
     "motivo": "Su robots.txt prohíbe el buscador (/search). Pendiente: alternativa vía sitemap."},
    {"nombre": "Chronomagic", "url": "https://www.chronomagic.cl",
     "motivo": "Su robots.txt prohíbe el buscador (/search). Pendiente: alternativa vía sitemap."},
    {"nombre": "GameHub", "url": "https://gamehub.cl",
     "motivo": "Pendiente: ni su buscador ni su API devolvieron cartas."},
    {"nombre": "Blood Moon Games", "url": "https://www.bloodmoongames.cl",
     "motivo": "Pendiente: no encontré un buscador público."},
    {"nombre": "TCGmatch", "url": "https://tcgmatch.cl",
     "motivo": "Pendiente: es un marketplace y su robots.txt bloquea /api/."},
    {"nombre": "CardNexus (marketplace internacional)", "url": "https://cardnexus.com",
     "motivo": "No confirma envíos a Chile (opera en Europa y Norteamérica) ni tiene API pública."},
    {"nombre": "TCGplayer y Cardmarket", "url": "https://www.tcgplayer.com",
     "motivo": "No envían de forma práctica a Chile: se usan solo como precio de referencia (vía Scryfall)."},
    {"nombre": "Cartonazo", "url": "https://cartonazo.com", "motivo": "No vende cartas sueltas de Magic (solo productos sellados)."},
    {"nombre": "El Reino de los Duelos", "url": "https://elreinodelosduelos.cl", "motivo": "No vende cartas sueltas de Magic (solo productos sellados)."},
    {"nombre": "Set & Play", "url": "https://www.setandplay.cl", "motivo": "No vende cartas sueltas de Magic (solo productos sellados)."},
    {"nombre": "Shivano", "url": "https://shivano.cl", "motivo": "No vende cartas sueltas de Magic (solo productos sellados)."},
]

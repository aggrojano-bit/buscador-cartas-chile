"""Lista de tiendas activas.

Para QUITAR una tienda: bórrala de ACTIVAS (o ponle un # delante).
Para AGREGAR una: crea su archivo en esta carpeta y súmala a ACTIVAS.
Las tiendas que no se pueden leer automáticamente (TiendaManual) también van aquí:
la página muestra el enlace a su buscador y deja ingresar el precio a mano.
"""
from .afkstore import AFKStore
from .cardkingdom import CardKingdom
from .cardnexus import CardNexus
from .cardsouls import CardSouls
from .catlotus import CatLotus
from .cardtrader import CardTrader
from .chronomagic import Chronomagic
from .frikicards import FrikiCards
from .gameofmagic import GameOfMagic
from .hareruya import Hareruya
from .ineko import Ineko
from .lacomarca import LaComarca
from .lacripta import LaCripta
from .magic4ever import Magic4ever
from .oasisgames import OasisGames
from .paytowin import PayToWin
from .piedrabruja import PiedraBruja
from .rhysticbazaar import RhysticBazaar
from .starcitygames import StarCityGames
from .tcgplayer import TCGplayer
from .zendicard import ZendiCard

ACTIVAS = [
    # Chile
    OasisGames(),
    PayToWin(),
    LaComarca(),
    PiedraBruja(),
    CardNexus(),
    Ineko(),
    ZendiCard(),
    GameOfMagic(),
    AFKStore(),
    LaCripta(),
    Magic4ever(),
    Chronomagic(),
    CardSouls(),
    RhysticBazaar(),
    FrikiCards(),
    CatLotus(),       # solo a mano
    # Internacionales
    CardKingdom(),
    Hareruya(),
    CardTrader(),
    TCGplayer(),      # precios vía Scryfall
    StarCityGames(),  # solo a mano
]

# Tiendas revisadas que NO se consultan, y por qué (se muestran en la app)
NO_INCLUIDAS = [
    {"nombre": "Cartas Magicsur", "url": "https://www.cartasmagicsur.cl",
     "motivo": "Protegida con un control anti-robots (Vercel Security Checkpoint). Habría que pedir permiso a la tienda."},
    {"nombre": "Magicsur (juegos de mesa)", "url": "https://www.magicsur.cl",
     "motivo": "Su robots.txt prohíbe usar el buscador; sus cartas sueltas están en cartasmagicsur.cl."},
    {"nombre": "Marketplace Scry", "url": "https://marketplace.scry.cl",
     "motivo": "Sus términos prohíben extraer datos sin autorización. Se puede pedir permiso."},
    {"nombre": "tcgcards.cl", "url": "https://tcgcards.cl",
     "motivo": "Marketplace cuyo robots.txt bloquea a los asistentes de IA y su API."},
    {"nombre": "Juegomania", "url": "https://www.juegomania.cl",
     "motivo": "Su robots.txt prohíbe la lectura automática de todo el sitio."},
    {"nombre": "TCG Underground", "url": "https://tcgunderground.cl",
     "motivo": "Su catálogo se carga desde /api/, que su robots.txt prohíbe."},
    {"nombre": "Blood Moon Games", "url": "https://www.bloodmoongames.cl",
     "motivo": "Su robots.txt bloquea las fichas de producto (/articulos/ver)."},
    {"nombre": "TCGmatch", "url": "https://tcgmatch.cl",
     "motivo": "Pendiente: es un marketplace y su robots.txt bloquea /api/."},
    {"nombre": "GameHub", "url": "https://gamehub.cl",
     "motivo": "Su buscador y su API no devuelven cartas (productos sin categoría)."},
    {"nombre": "Gaming Place", "url": "https://www.gamingplace.cl",
     "motivo": "El sitio no responde (error de Cloudflare al revisarlo)."},
    {"nombre": "TCG Prime", "url": "https://tcgprime.cl",
     "motivo": "No encontré cartas sueltas de Magic (se enfoca en Pokémon)."},
    {"nombre": "CardNexus (marketplace internacional)", "url": "https://cardnexus.com",
     "motivo": "No confirma envíos a Chile (opera en Europa y Norteamérica) ni tiene API pública."},
    {"nombre": "Cardmarket", "url": "https://www.cardmarket.com",
     "motivo": "No envía de forma práctica a Chile: se usa solo como precio de referencia (vía Scryfall)."},
    {"nombre": "Cartonazo", "url": "https://cartonazo.com", "motivo": "No vende cartas sueltas de Magic (solo productos sellados)."},
    {"nombre": "El Reino de los Duelos", "url": "https://elreinodelosduelos.cl", "motivo": "No vende cartas sueltas de Magic (solo productos sellados)."},
    {"nombre": "Set & Play", "url": "https://www.setandplay.cl", "motivo": "No vende cartas sueltas de Magic (solo productos sellados)."},
    {"nombre": "Shivano", "url": "https://shivano.cl", "motivo": "No vende cartas sueltas de Magic (solo productos sellados)."},
]

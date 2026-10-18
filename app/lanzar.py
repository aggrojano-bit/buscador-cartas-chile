"""Arranca el servidor y muestra las direcciones para el PC y el celular."""
import socket

import uvicorn

from .config import PUERTO


def ip_local():
    # Truco estándar: "conectarse" por UDP no envía nada, pero revela la IP de la red local
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


def puerto_ocupado(puerto):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", puerto)) == 0


if __name__ == "__main__":
    puerto = PUERTO
    if puerto_ocupado(puerto):
        print(f"\n  El puerto {puerto} ya lo está usando otro programa (¿la app ya está abierta?).")
        print("  Cierra ese programa o cambia 'puerto' en ajustes.toml.\n")
        raise SystemExit(1)
    ip = ip_local()
    print()
    print("  ==============================================")
    print("   Buscador de Cartas Chile")
    print(f"   En este PC:   http://localhost:{puerto}")
    if ip:
        print(f"   En el celular (mismo Wi-Fi): http://{ip}:{puerto}")
    print("   Para cerrar la app: cierra esta ventana o presiona Ctrl+C")
    print("  ==============================================")
    print()
    uvicorn.run("app.main:app", host="0.0.0.0", port=puerto, log_level="warning")

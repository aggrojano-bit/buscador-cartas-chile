# Cómo aportar

¡Gracias por querer ayudar! Hay dos formas de aportar.

## 1. Sin programar: reportar o sugerir

- **¿Algo no funciona?** Abre un [reporte de error](../../issues/new?template=reportar-error.yml).
- **¿Tienes una idea o conoces una tienda chilena que falta?** Abre una [sugerencia](../../issues/new?template=sugerir-mejora.yml).

Solo necesitas una cuenta gratis de GitHub.

## 2. Programando: proponer un cambio (Pull Request)

1. Haz un **fork** del repositorio (botón «Fork», arriba a la derecha).
2. Crea una rama con un nombre que describa el cambio, por ejemplo `agregar-tienda-xyz`.
3. Haz tus cambios y pruébalos en tu PC (ver «Instalar en tu PC» en el [README](README.md)).
4. Sube la rama a tu fork y abre un **Pull Request** explicando:
   - qué cambiaste y por qué,
   - cómo lo probaste (por ejemplo, con Sol Ring, Lightning Bolt y Swords to Plowshares).

### Reglas importantes

- **Respeta a las tiendas.** Antes de agregar una tienda, revisa su `robots.txt` y sus términos de uso.
  Si prohíben la lectura automática, no se agrega. Usa siempre pausas entre consultas (ver `app/red.py`).
- **Nada de datos privados.** Tokens, claves y correos van en el archivo `.env`, que nunca se sube.
- **Cada tienda en su archivo.** Las tiendas están en `adaptadores/`; copia una parecida como punto de partida.
- Escribe en español, en un lenguaje simple.

# Seguridad · gh-documentos (web)

Checklist de la skill: `~/.claude/skills/nueva-webapp/references/10-seguridad.md`.

- Login de Google (GIS); el backend valida `iss`, `aud`, `email_verified`, `exp` y la lista blanca `EQUIPO`. Sin tokens en la URL.
- El repo público no contiene datos de clientes (`.gitignore` en modo lista blanca: solo frontend).
- Escritura en Drive solo dentro de `2 GH GESTIÓN`; rutas por nombre de carpeta (no se acepta `..`), firma de archivo (%PDF / PK) verificada, escrituras idempotentes por `requestId`.
- CSP básica en el HTML (`object-src 'none'; base-uri 'self'; form-action 'self'`). GitHub Pages no permite cabeceras (sin `frame-ancestors`).
- Datos de usuario por `esc()` antes de `innerHTML`.

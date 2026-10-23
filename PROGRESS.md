# PROGRESS · gh-documentos (frontend)

Estado al 2026-10-23.

- Publicado: https://infoghconsultora-prog.github.io/gh-documentos/ (repo público `infoghconsultora-prog/gh-documentos`, solo frontend; `.gitignore` en lista blanca).
- `js/backend.js`: login de Google (Client ID compartido con las demás apps GH, origen `infoghconsultora-prog.github.io`) y POST con `idToken` al `/exec`. `API` de `js/app.js` mantiene las rutas del servidor local y las traduce a acciones.
- Logos, membrete de Reciclados Industriales, empresas y carpetas llegan del backend; no hay datos de clientes en el repo.
- No hay Service Worker (no aplica subir `VERSION`).
- La versión local (`server.py`, `iniciar.command`, `datos/`, `cdf.py`, `herramientas/`) sigue en la carpeta pero fuera de git.

- `BACKEND_URL` apunta al /exec de gh-documentos-backend (desplegado v1).

## Qué falta
- Prueba de punta a punta con login real (Felipe).

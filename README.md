# Generador de documentos (GH Consultora)

Notas y certificados con estructura fija -> PDF o Word. Seis tipos: pedido de OT, pedido de manifiestos, ratificación, designación, nota (texto libre) y CDF.

Página: https://infoghconsultora-prog.github.io/gh-documentos/ — se entra con la cuenta de Google del equipo.

## Cómo está armado
- **Frontend** (este repo, público): `index.html`, `js/app.js` (formularios, texto automático, vista previa), `js/pdf.js` y `js/word.js` (diseño de cada documento; el PDF lo arma el navegador con pdf-lib y el Word con docx.js), `js/backend.js` (login de Google + llamadas al backend).
- **Backend** (Apps Script en la cuenta info.ghconsultora, carpeta local `gh-documentos-backend`, privado): valida el token de Google contra la lista del equipo, lee la planilla de habilitaciones, sirve logos/membrete/carpetas y guarda los archivos en `2 GH GESTIÓN` (nunca pisa un archivo: agrega " (2)").
- Este repo **no tiene datos de clientes**: ni logos, ni empresas, ni catálogos, ni el membrete de Reciclados Industriales. Todo llega del backend después del login.

## Nota
Documento genérico: destinatario (lista que se completa sola con cada nota guardada), referencia, expediente de la empresa (el evaluador se completa según el expediente), RCA, apertura, texto libre y cierre. Hay modelos de texto que se repiten (renovación, respuesta a informe, trazabilidad, RAEE, pago de tasas, cambio de rúbrica); lo que va entre `[ ]` se completa a mano y la página avisa si queda alguno. Se puede adjuntar comprobante y anexos.

## CDF
Catálogo de generadores/transportistas/materiales y N° de certificado vienen del backend. Cada CDF guardado se anota en el Google Sheet `MOVIMIENTOS RI <año> (web)` (carpeta `CDF <año>`); el siguiente número es el mayor entre ese Sheet, el Excel `MOVIMIENTOS RI <año>.xlsx` y los nombres de archivo.

## Correr en la compu
Es una página estática: `python3 -m http.server 8791` y abrir http://localhost:8791 (el origen debe estar autorizado en el cliente OAuth para que entre el login).

/* Conexión con el backend (Apps Script) y login de Google.
 * Este archivo es público: no contiene datos de clientes. Todo llega del /exec, que valida el
 * token de Google contra la lista de casillas autorizadas antes de responder. */
(function () {
  'use strict';
  const CLIENT_ID = '585469655594-8aj9hjmf7d4noglr1th673dbiia8ftkv.apps.googleusercontent.com';
  const BACKEND_URL = '__BACKEND_URL__';

  let idToken = null, esperando = null;

  const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');

  async function pedir(action, params, reintentos) {
    const cuerpo = JSON.stringify(Object.assign({}, params, { action, idToken }));
    let ultimo;
    for (let i = 0; i <= reintentos; i++) {
      try {
        const r = await fetch(BACKEND_URL, { method: 'POST', body: cuerpo });
        const t = await r.text();
        let j;
        try { j = JSON.parse(t); } catch (e) { throw new Error('El servidor respondió algo que no es JSON'); }
        return j;
      } catch (e) { ultimo = e; await new Promise(res => setTimeout(res, 600)); }
    }
    throw ultimo;
  }

  async function llamar(action, params, escritura) {
    params = Object.assign({}, params);
    if (escritura) params.requestId = rid();            // los reintentos no duplican archivos
    if (!idToken) await entrar();
    let j = await pedir(action, params, escritura ? 2 : 1);
    if (!j.ok && j.error === 'auth_failed') {             // token vencido (dura ~1 h): volver a entrar
      idToken = null; await entrar();
      j = await pedir(action, params, escritura ? 2 : 1);
    }
    if (!j.ok) throw new Error(j.mensaje || j.error || 'error');
    return j;
  }

  function pantalla() {
    let el = document.getElementById('gh-login');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'gh-login';
    el.setAttribute('style', 'position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--bg,#f7f8f4);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Helvetica,Arial,sans-serif;color:var(--label,#2b2f26)');
    el.innerHTML = '<div style="background:var(--surface,#fff);border-radius:20px;padding:36px 32px;max-width:360px;width:100%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.12)">' +
      '<img src="assets/logo-gh.png" alt="GH Consultora" style="height:56px;width:auto;margin:0 auto 16px;display:block">' +
      '<h1 style="font-size:20px;line-height:26px;margin:0 0 6px;font-weight:600" id="gh-login-t"></h1>' +
      '<p style="margin:0 0 20px;font-size:14px;line-height:20px;opacity:.7">Entrá con tu cuenta de Google del equipo.</p>' +
      '<div id="gh-login-btn" style="display:flex;justify-content:center;min-height:44px"></div>' +
      '<p id="gh-login-err" role="alert" style="margin:14px 0 0;font-size:13px;line-height:18px;color:#b3261e;display:none"></p></div>';
    document.body.appendChild(el);
    el.querySelector('#gh-login-t').textContent = document.title;
    return el;
  }

  function entrar() {
    if (idToken) return Promise.resolve();
    if (esperando) return esperando;
    esperando = new Promise(resolve => {
      const el = pantalla(), err = el.querySelector('#gh-login-err');
      el.style.display = 'flex';
      const iniciar = () => {
        google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: async resp => {
            err.style.display = 'none';
            idToken = resp.credential;
            try {
              await pedir('ping', {}, 1).then(j => { if (!j.ok && j.error === 'auth_failed') throw new Error('auth'); });
            } catch (e) {
              idToken = null;
              err.textContent = e.message === 'auth' ? 'Esta cuenta no está autorizada. Pedile a GH Consultora que agregue tu email a la lista.' : 'No se pudo conectar con el servidor. Probá de nuevo.';
              err.style.display = 'block';
              return;
            }
            el.style.display = 'none';
            esperando = null;
            resolve();
          }
        });
        google.accounts.id.renderButton(el.querySelector('#gh-login-btn'), { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill' });
      };
      if (window.google && google.accounts && google.accounts.id) iniciar();
      else {
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = iniciar;
        s.onerror = () => { err.textContent = 'No se pudo cargar el inicio de sesión de Google. Revisá la conexión.'; err.style.display = 'block'; };
        document.head.appendChild(s);
      }
    });
    return esperando;
  }

  window.GH = { llamar, entrar };
})();

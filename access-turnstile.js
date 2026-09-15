(() => {
  const TEST_SITE_KEY = '1x00000000000000000000AA';
  const ACCESS_HASH = 'eb129f1ab52dffe57e8a7a0cc64ef8895517b4a2058e2e6eab601f6fb4c0f0bf';
  let captchaPassed = false;
  let passwordAccepted = false;

  function loadTurnstile() {
    if (window.turnstile || document.querySelector('script[data-tpl-turnstile]')) return;
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.defer = true;
    s.dataset.tplTurnstile = '1';
    document.head.appendChild(s);
  }

  async function digest(value) {
    const bytes = new TextEncoder().encode(value);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function finishAccess() {
    sessionStorage.setItem('tplPriceAccessV4', 'granted');
    const gate = document.getElementById('accessGate');
    const app = document.getElementById('comparisonApp');
    const input = document.getElementById('accessPassword');
    if (gate) gate.hidden = true;
    if (app) app.classList.remove('app-locked');
    if (input) input.value = '';
  }

  function renderCaptcha() {
    const card = document.getElementById('accessCard');
    if (!card) return;
    card.querySelectorAll('label,input,#accessButton,.access-supplies,#accessError').forEach(el => el.hidden = true);
    let stage = document.getElementById('tplCaptchaStage');
    if (!stage) {
      stage = document.createElement('div');
      stage.id = 'tplCaptchaStage';
      stage.innerHTML = `
        <p style="margin:0 0 10px;color:#647087;line-height:1.5">Password accepted. Complete the human verification to continue.</p>
        <div id="tplCaptchaWidget" style="display:flex;justify-content:center;margin:14px 0"></div>
        <button id="tplCaptchaEnter" type="button" disabled style="width:100%;margin-top:12px;padding:13px;border:0;border-radius:9px;background:#ef6c2f;color:#fff;font-weight:800;cursor:pointer">Enter TPLPrice</button>
        <p id="tplCaptchaError" role="alert" style="min-height:20px;color:#a33;font-weight:700;margin:10px 0 0"></p>`;
      card.appendChild(stage);
      stage.querySelector('#tplCaptchaEnter').addEventListener('click', () => { if (captchaPassed) finishAccess(); });
    }
    const tryRender = () => {
      if (!window.turnstile) return setTimeout(tryRender, 100);
      const target = document.getElementById('tplCaptchaWidget');
      if (!target || target.dataset.rendered) return;
      target.dataset.rendered = '1';
      window.turnstile.render(target, {
        sitekey: TEST_SITE_KEY,
        theme: 'light',
        callback: () => {
          captchaPassed = true;
          document.getElementById('tplCaptchaEnter').disabled = false;
          document.getElementById('tplCaptchaError').textContent = '';
        },
        'expired-callback': () => {
          captchaPassed = false;
          document.getElementById('tplCaptchaEnter').disabled = true;
          document.getElementById('tplCaptchaError').textContent = 'Verification expired. Please verify again.';
        },
        'error-callback': () => {
          captchaPassed = false;
          document.getElementById('tplCaptchaEnter').disabled = true;
          document.getElementById('tplCaptchaError').textContent = 'Verification could not load. Please try again.';
        }
      });
    };
    tryRender();
  }

  document.addEventListener('submit', async (event) => {
    if (event.target?.id !== 'accessCard') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (passwordAccepted) return renderCaptcha();
    const input = document.getElementById('accessPassword');
    const error = document.getElementById('accessError');
    const button = document.getElementById('accessButton');
    if (!input || !button) return;
    if (error) error.textContent = '';
    button.disabled = true;
    const ok = (await digest(input.value)) === ACCESS_HASH;
    button.disabled = false;
    if (!ok) {
      if (error) error.textContent = 'Incorrect password.';
      input.select();
      return;
    }
    passwordAccepted = true;
    renderCaptcha();
  }, true);

  loadTurnstile();
})();

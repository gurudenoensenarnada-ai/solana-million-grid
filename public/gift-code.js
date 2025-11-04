// Simple helper: when a wallet connects, call /api/referrals/gift/latest/:wallet
// and show a toast/modal if there's an unshown gift code.
// Usage: include <script src="/gift-code.js"></script> and call checkGift(walletPublicKey)

async function checkGift(wallet) {
  if (!wallet) return;
  try {
    const res = await fetch(`/api/referrals/gift/latest/${encodeURIComponent(wallet)}`);
    if (!res.ok) return;
    const body = await res.json();
    if (!body || !body.gift) return;
    const gift = body.gift;
    // show modal / toast
    showGiftModal(gift);
  } catch (e) {
    console.error('Gift check failed', e);
  }
}

function showGiftModal(gift) {
  if (!gift) return;
  // avoid duplicate modals
  if (document.getElementById('gift-modal')) return;
  const div = document.createElement('div');
  div.id = 'gift-modal';
  div.style = 'position:fixed;left:0;right:0;top:0;bottom:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999';
  div.innerHTML = `
    <div style="background:white;border-radius:8px;padding:20px;max-width:420px;width:90%;text-align:center;font-family:system-ui;">
      <h2 style="margin-top:0">🎁 ¡Tienes un regalo!</h2>
      <p>Se ha generado un código regalo para tu compra.</p>
      <div style="margin:12px 0;padding:12px;background:#f7f7f7;border-radius:6px;font-weight:600">
        Código: <span id="gift-code-val">${gift.code}</span>
      </div>
      <p>Valor: <strong>${gift.value_sol || gift.valueSol} SOL</strong></p>
      <button id="gift-copy" style="padding:8px 12px;margin-right:8px">Copiar código</button>
      <button id="gift-close" style="padding:8px 12px;background:#eee">Cerrar</button>
    </div>
  `;
  document.body.appendChild(div);
  document.getElementById('gift-copy').onclick = () => {
    navigator.clipboard.writeText(gift.code);
    alert('Código copiado al portapapeles');
  };
  document.getElementById('gift-close').onclick = () => div.remove();
}

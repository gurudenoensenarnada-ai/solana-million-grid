/**
 * 🎨 FRONTEND INTEGRATION EXAMPLES
 * Ejemplos de código para integrar las nuevas funcionalidades en tu frontend
 */

// ==========================================
// 1. RATE LIMITER - MANEJO DE ERRORES 429
// ==========================================

/**
 * Función helper para hacer requests con retry automático en rate limits
 */
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      
      // Si es rate limit, esperar y reintentar
      if (response.status === 429) {
        const data = await response.json();
        const retryAfter = data.retryAfter || 60;
        
        console.warn(`⚠️ Rate limited. Retrying in ${retryAfter} seconds...`);
        
        // Mostrar mensaje al usuario
        showToast(`Demasiadas peticiones. Reintentando en ${retryAfter}s...`, 'warning');
        
        // Esperar
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        continue;
      }
      
      return response;
      
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  
  throw new Error('Max retries exceeded');
}

// Uso:
// const response = await fetchWithRetry('/api/purchase', { method: 'POST', ... });

// ==========================================
// 2. ANALYTICS - AUTO-TRACKING
// ==========================================

/**
 * Sistema de analytics para el frontend
 */
class AnalyticsTracker {
  constructor() {
    this.startTime = Date.now();
    this.setupTracking();
  }
  
  setupTracking() {
    // Trackear tiempo en sitio al salir
    window.addEventListener('beforeunload', () => {
      const duration = Date.now() - this.startTime;
      this.trackTimeOnSite(duration);
    });
    
    // Trackear clicks en bloques del grid
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('grid-block')) {
        const x = parseInt(e.target.dataset.x);
        const y = parseInt(e.target.dataset.y);
        this.trackBlockInteraction(x, y, 'click');
      }
    });
    
    // Trackear hover en bloques (para heatmap)
    let hoverTimeout;
    document.addEventListener('mouseover', (e) => {
      if (e.target.classList.contains('grid-block')) {
        clearTimeout(hoverTimeout);
        hoverTimeout = setTimeout(() => {
          const x = parseInt(e.target.dataset.x);
          const y = parseInt(e.target.dataset.y);
          this.trackBlockInteraction(x, y, 'view');
        }, 1000); // Solo si hover > 1 segundo
      }
    });
  }
  
  // Trackear evento personalizado
  async trackEvent(eventName, data = {}) {
    try {
      await fetch('/api/analytics/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: eventName, data })
      });
    } catch (error) {
      console.error('Analytics tracking error:', error);
    }
  }
  
  // Trackear interacción con bloque
  async trackBlockInteraction(x, y, action = 'view') {
    try {
      await fetch('/api/analytics/block-interaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blockX: x, blockY: y, action })
      });
    } catch (error) {
      console.error('Block tracking error:', error);
    }
  }
  
  // Trackear tiempo en sitio
  trackTimeOnSite(duration) {
    // Usar sendBeacon para que funcione incluso al cerrar
    const blob = new Blob([JSON.stringify({ duration })], {
      type: 'application/json'
    });
    navigator.sendBeacon('/api/analytics/time-on-site', blob);
  }
}

// Inicializar al cargar la página
const analytics = new AnalyticsTracker();

// Trackear eventos custom
analytics.trackEvent('wallet_connected', { wallet: walletAddress });
analytics.trackEvent('block_selected', { count: selectedBlocks.length });
analytics.trackEvent('purchase_initiated', { amount: totalAmount });

// ==========================================
// 3. PREVIEW MODE - IMPLEMENTACIÓN COMPLETA
// ==========================================

class PreviewManager {
  constructor() {
    this.currentPreviewId = null;
    this.loadSavedPreview();
  }
  
  // Cargar preview guardado en localStorage
  loadSavedPreview() {
    this.currentPreviewId = localStorage.getItem('previewId');
    if (this.currentPreviewId) {
      this.checkPreviewStatus(this.currentPreviewId);
    }
  }
  
  // Verificar si preview aún es válido
  async checkPreviewStatus(previewId) {
    try {
      const response = await fetch(`/api/preview/${previewId}`);
      const data = await response.json();
      
      if (data.ok) {
        this.showPreviewBanner(data.preview);
      } else {
        // Preview expiró o no existe
        localStorage.removeItem('previewId');
        this.currentPreviewId = null;
      }
    } catch (error) {
      console.error('Error checking preview:', error);
    }
  }
  
  // Crear nuevo preview
  async createPreview(selection, metadata, wallet) {
    try {
      const response = await fetch('/api/preview/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet,
          selection,
          metadata
        })
      });
      
      const data = await response.json();
      
      if (data.ok) {
        // Guardar ID
        this.currentPreviewId = data.preview.id;
        localStorage.setItem('previewId', data.preview.id);
        
        // Abrir preview en nueva ventana
        window.open(data.preview.url, '_blank', 'width=1200,height=800');
        
        // Mostrar banner con countdown
        this.showPreviewBanner({
          id: data.preview.id,
          timeRemaining: data.preview.expiresIn
        });
        
        // Trackear en analytics
        analytics.trackEvent('preview_created', {
          blocks: selection.blocksX * selection.blocksY
        });
        
        return data.preview;
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error('Error creating preview:', error);
      showToast('Error al crear preview', 'error');
      throw error;
    }
  }
  
  // Mostrar banner de preview activo
  showPreviewBanner(preview) {
    let remaining = preview.timeRemaining;
    
    const banner = document.createElement('div');
    banner.id = 'preview-banner';
    banner.className = 'preview-banner';
    banner.innerHTML = `
      <div class="preview-banner-content">
        <span class="preview-icon">👀</span>
        <span class="preview-text">
          Preview activo - Expira en <strong id="preview-timer">${this.formatTime(remaining)}</strong>
        </span>
        <button onclick="previewManager.viewPreview()" class="btn-view">
          Ver Preview
        </button>
        <button onclick="previewManager.dismissBanner()" class="btn-close">
          ✕
        </button>
      </div>
    `;
    
    document.body.appendChild(banner);
    
    // Countdown
    const interval = setInterval(() => {
      remaining--;
      const timer = document.getElementById('preview-timer');
      
      if (timer) {
        timer.textContent = this.formatTime(remaining);
        
        // Cambiar color cuando quede poco tiempo
        if (remaining < 300) { // < 5 minutos
          timer.style.color = 'red';
        }
      }
      
      if (remaining <= 0) {
        clearInterval(interval);
        this.dismissBanner();
        localStorage.removeItem('previewId');
        this.currentPreviewId = null;
        showToast('Preview expiró', 'info');
      }
    }, 1000);
  }
  
  // Ver preview actual
  viewPreview() {
    if (this.currentPreviewId) {
      window.open(`/preview/${this.currentPreviewId}`, '_blank');
    }
  }
  
  // Cerrar banner
  dismissBanner() {
    const banner = document.getElementById('preview-banner');
    if (banner) {
      banner.remove();
    }
  }
  
  // Convertir preview en compra
  async convertPreview(signature) {
    if (!this.currentPreviewId) return;
    
    try {
      await fetch(`/api/preview/${this.currentPreviewId}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature })
      });
      
      // Limpiar
      localStorage.removeItem('previewId');
      this.currentPreviewId = null;
      this.dismissBanner();
      
      showToast('¡Preview convertido en compra!', 'success');
    } catch (error) {
      console.error('Error converting preview:', error);
    }
  }
  
  // Formatear tiempo
  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
}

// Inicializar
const previewManager = new PreviewManager();

// Usar en el botón "Ver Preview"
document.getElementById('preview-btn').addEventListener('click', async () => {
  const selection = getSelectedBlocks();
  const metadata = getFormData();
  const wallet = getConnectedWallet();
  
  await previewManager.createPreview(selection, metadata, wallet);
});

// Después de comprar
async function afterPurchase(signature) {
  // Convertir preview si existe
  await previewManager.convertPreview(signature);
  
  // Resto del código...
}

// ==========================================
// 4. REFERRAL SYSTEM - IMPLEMENTACIÓN
// ==========================================

class ReferralManager {
  constructor() {
    this.referralCode = null;
    this.loadReferralCode();
  }
  
  // Cargar código de URL
  loadReferralCode() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('ref');
    
    if (code) {
      this.validateAndSaveCode(code);
    } else {
      // Intentar cargar de localStorage
      this.referralCode = localStorage.getItem('referralCode');
    }
  }
  
  // Validar código y guardarlo
  async validateAndSaveCode(code) {
    try {
      const response = await fetch(`/api/referrals/validate/${code}`);
      const data = await response.json();
      
      if (data.ok) {
        this.referralCode = code;
        localStorage.setItem('referralCode', code);
        
        // Mostrar banner de referido
        this.showReferralBanner(data.referrer);
        
        // Trackear
        analytics.trackEvent('referral_link_used', { code });
      } else {
        console.warn('Invalid referral code:', code);
      }
    } catch (error) {
      console.error('Error validating referral code:', error);
    }
  }
  
  // Mostrar banner de referido
  showReferralBanner(referrer) {
    const banner = document.createElement('div');
    banner.className = 'referral-banner';
    banner.innerHTML = `
      <div class="referral-banner-content">
        <span class="referral-icon">🎁</span>
        <span class="referral-text">
          ¡Fuiste referido! Obtén un descuento especial
        </span>
        <button onclick="this.parentElement.parentElement.remove()" class="btn-close">
          ✕
        </button>
      </div>
    `;
    
    document.body.appendChild(banner);
    
    // Auto-cerrar después de 10 segundos
    setTimeout(() => banner.remove(), 10000);
  }
  
  // Generar código propio
  async generateMyCode(wallet, name = '') {
    try {
      const response = await fetch('/api/referrals/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet, name })
      });
      
      const data = await response.json();
      
      if (data.ok) {
        this.showReferralModal(data);
        return data;
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error('Error generating referral code:', error);
      showToast('Error al generar código', 'error');
      throw error;
    }
  }
  
  // Mostrar modal con link de referido
  showReferralModal(data) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content referral-modal">
        <h2>🎁 Tu Link de Referido</h2>
        <p>Comparte este link y gana <strong>10% de comisión</strong> por cada venta</p>
        
        <div class="referral-code-box">
          <code>${data.code}</code>
        </div>
        
        <div class="referral-url-box">
          <input type="text" value="${data.url}" readonly id="referral-url">
          <button onclick="referralManager.copyLink()" class="btn-copy">
            📋 Copiar
          </button>
        </div>
        
        <div class="referral-stats">
          <div class="stat">
            <span class="label">Referidos</span>
            <span class="value">${data.totalReferrals || 0}</span>
          </div>
          <div class="stat">
            <span class="label">Ganado</span>
            <span class="value">${(data.totalCommissions || 0).toFixed(4)} SOL</span>
          </div>
        </div>
        
        <div class="social-share">
          <h3>Compartir en:</h3>
          <button onclick="referralManager.shareTwitter('${data.url}')" class="btn-twitter">
            🐦 Twitter
          </button>
          <button onclick="referralManager.shareTelegram('${data.url}')" class="btn-telegram">
            ✈️ Telegram
          </button>
          <button onclick="referralManager.shareWhatsApp('${data.url}')" class="btn-whatsapp">
            💬 WhatsApp
          </button>
        </div>
        
        <button onclick="this.closest('.modal-overlay').remove()" class="btn-close-modal">
          Cerrar
        </button>
      </div>
    `;
    
    document.body.appendChild(modal);
  }
  
  // Copiar link
  copyLink() {
    const input = document.getElementById('referral-url');
    input.select();
    document.execCommand('copy');
    showToast('Link copiado!', 'success');
    
    analytics.trackEvent('referral_link_copied');
  }
  
  // Compartir en redes
  shareTwitter(url) {
    const text = '¡Compra tu espacio en Solana Million Grid! 🎨';
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`);
    analytics.trackEvent('referral_shared', { platform: 'twitter' });
  }
  
  shareTelegram(url) {
    const text = '¡Compra tu espacio en Solana Million Grid! 🎨';
    window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
    analytics.trackEvent('referral_shared', { platform: 'telegram' });
  }
  
  shareWhatsApp(url) {
    const text = `¡Compra tu espacio en Solana Million Grid! 🎨 ${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`);
    analytics.trackEvent('referral_shared', { platform: 'whatsapp' });
  }
  
  // Obtener código guardado (para incluir en compra)
  getSavedCode() {
    return this.referralCode;
  }
  
  // Ver mis estadísticas
  async getMyStats(wallet) {
    try {
      const response = await fetch(`/api/referrals/stats/${wallet}`);
      const data = await response.json();
      
      if (data.ok) {
        return data;
      }
    } catch (error) {
      console.error('Error getting referral stats:', error);
    }
  }
}

// Inicializar
const referralManager = new ReferralManager();

// Botón "Generar Link"
document.getElementById('generate-referral-btn')?.addEventListener('click', async () => {
  const wallet = getConnectedWallet();
  if (!wallet) {
    showToast('Conecta tu wallet primero', 'warning');
    return;
  }
  
  await referralManager.generateMyCode(wallet, 'Mi Proyecto');
});

// Incluir código en compra
async function purchaseBlocks(signature, buyer, metadata) {
  const referralCode = referralManager.getSavedCode();
  
  const response = await fetchWithRetry('/api/purchase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      signature,
      buyer,
      metadata,
      referralCode // ← Incluir código si existe
    })
  });
  
  return response.json();
}

// ==========================================
// 5. TOAST NOTIFICATIONS
// ==========================================

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  const icons = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
  };
  
  toast.innerHTML = `
    <span class="toast-icon">${icons[type]}</span>
    <span class="toast-message">${message}</span>
  `;
  
  document.body.appendChild(toast);
  
  // Animación de entrada
  setTimeout(() => toast.classList.add('show'), 10);
  
  // Auto-remover
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ==========================================
// 6. CSS NECESARIO
// ==========================================

/*
Agregar estos estilos a tu CSS:

.preview-banner {
  position: fixed;
  top: 20px;
  right: 20px;
  background: white;
  padding: 15px 20px;
  border-radius: 10px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  z-index: 9999;
  animation: slideIn 0.3s;
}

.referral-banner {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 15px 30px;
  border-radius: 10px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  z-index: 9999;
  animation: slideUp 0.3s;
}

.toast {
  position: fixed;
  bottom: 20px;
  right: 20px;
  background: white;
  padding: 15px 20px;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  display: flex;
  align-items: center;
  gap: 10px;
  z-index: 10000;
  opacity: 0;
  transform: translateY(20px);
  transition: all 0.3s;
}

.toast.show {
  opacity: 1;
  transform: translateY(0);
}

.toast-success { border-left: 4px solid #48bb78; }
.toast-error { border-left: 4px solid #f56565; }
.toast-warning { border-left: 4px solid #ed8936; }
.toast-info { border-left: 4px solid #4299e1; }

@keyframes slideIn {
  from { transform: translateX(100%); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}

@keyframes slideUp {
  from { transform: translate(-50%, 100%); opacity: 0; }
  to { transform: translate(-50%, 0); opacity: 1; }
}
*/

// ==========================================
// EJEMPLO DE USO COMPLETO
// ==========================================

// Al cargar la página
document.addEventListener('DOMContentLoaded', () => {
  // Inicializar todos los managers
  const analytics = new AnalyticsTracker();
  const previewManager = new PreviewManager();
  const referralManager = new ReferralManager();
  
  console.log('✅ All systems initialized');
});

// En el flujo de compra
async function handlePurchase() {
  try {
    // 1. Conectar wallet
    const wallet = await connectWallet();
    
    // 2. Obtener selección y metadata
    const selection = getSelectedBlocks();
    const metadata = getFormData();
    
    // 3. Crear preview primero (opcional)
    if (confirm('¿Quieres ver un preview antes de comprar?')) {
      await previewManager.createPreview(selection, metadata, wallet);
      return; // Usuario decide después de ver preview
    }
    
    // 4. Crear transacción Solana
    const transaction = await createTransaction(selection);
    
    // 5. Firmar y enviar
    const signature = await signAndSendTransaction(transaction);
    
    // 6. Registrar compra (incluyendo referral code si existe)
    const referralCode = referralManager.getSavedCode();
    
    const result = await fetchWithRetry('/api/purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signature,
        buyer: wallet,
        metadata,
        referralCode
      })
    });
    
    const data = await result.json();
    
    if (data.ok) {
      // 7. Convertir preview si existe
      await previewManager.convertPreview(signature);
      
      // 8. Trackear en analytics
      analytics.trackEvent('purchase_completed', {
        amount: data.sale.amount,
        blocks: data.sale.blocks
      });
      
      // 9. Mostrar éxito
      showToast('¡Compra exitosa!', 'success');
      
      // 10. Redirigir o actualizar UI
      updateGrid();
    }
    
  } catch (error) {
    console.error('Purchase error:', error);
    showToast('Error en la compra: ' + error.message, 'error');
  }
}

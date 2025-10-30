/**
 * 👀 PREVIEW MODE
 * Permite a los usuarios ver cómo se verá su compra antes de pagar
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class PreviewSystem {
  constructor(dataPath) {
    this.dataPath = dataPath;
    this.previewsFile = path.join(dataPath, 'previews.json');
    this.previewDuration = 30 * 60 * 1000; // 30 minutos
    this.init();
  }
  
  /**
   * Inicializar sistema de previews
   */
  init() {
    if (!fs.existsSync(this.previewsFile)) {
      const initialData = {
        previews: [],
        stats: {
          totalPreviews: 0,
          conversionRate: 0,
          conversions: 0
        }
      };
      fs.writeFileSync(this.previewsFile, JSON.stringify(initialData, null, 2));
      console.log('✅ Preview system initialized');
    }
    
    // Limpiar previews expirados cada 10 minutos
    setInterval(() => this.cleanup(), 10 * 60 * 1000);
  }
  
  /**
   * Leer datos de previews
   */
  readData() {
    try {
      const data = fs.readFileSync(this.previewsFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error reading previews:', error);
      this.init();
      return this.readData();
    }
  }
  
  /**
   * Guardar datos
   */
  saveData(data) {
    fs.writeFileSync(this.previewsFile, JSON.stringify(data, null, 2));
  }
  
  /**
   * Crear nueva preview
   */
  createPreview(previewData) {
    const data = this.readData();
    
    // Generar ID único
    const previewId = crypto.randomBytes(16).toString('hex');
    
    // Validar datos requeridos
    if (!previewData.selection || !previewData.metadata) {
      return {
        ok: false,
        error: 'Missing required preview data'
      };
    }
    
    // Verificar si los bloques están disponibles
    const blocked = this.checkBlockAvailability(previewData.selection);
    if (blocked.length > 0) {
      return {
        ok: false,
        error: 'Some blocks are not available',
        blockedBlocks: blocked
      };
    }
    
    const preview = {
      id: previewId,
      wallet: previewData.wallet || null,
      selection: previewData.selection,
      metadata: {
        name: previewData.metadata.name,
        url: previewData.metadata.url,
        logo: previewData.metadata.logo,
        description: previewData.metadata.description || ''
      },
      createdAt: Date.now(),
      expiresAt: Date.now() + this.previewDuration,
      converted: false,
      viewCount: 0
    };
    
    // Agregar preview
    data.previews.push(preview);
    data.stats.totalPreviews++;
    
    this.saveData(data);
    
    console.log(`✅ Preview created: ${previewId}`);
    
    return {
      ok: true,
      preview: {
        id: previewId,
        expiresIn: this.previewDuration / 1000, // seconds
        expiresAt: preview.expiresAt,
        url: `/preview/${previewId}`
      }
    };
  }
  
  /**
   * Obtener preview por ID
   */
  getPreview(previewId) {
    const data = this.readData();
    
    const preview = data.previews.find(p => p.id === previewId);
    
    if (!preview) {
      return {
        ok: false,
        error: 'Preview not found'
      };
    }
    
    // Verificar si expiró
    if (Date.now() > preview.expiresAt) {
      return {
        ok: false,
        error: 'Preview has expired',
        expired: true
      };
    }
    
    // Incrementar contador de vistas
    preview.viewCount++;
    this.saveData(data);
    
    return {
      ok: true,
      preview: {
        id: preview.id,
        selection: preview.selection,
        metadata: preview.metadata,
        expiresAt: preview.expiresAt,
        timeRemaining: Math.floor((preview.expiresAt - Date.now()) / 1000),
        viewCount: preview.viewCount
      }
    };
  }
  
  /**
   * Marcar preview como convertida (compra realizada)
   */
  convertPreview(previewId, signature) {
    const data = this.readData();
    
    const preview = data.previews.find(p => p.id === previewId);
    
    if (!preview) {
      return { ok: false, error: 'Preview not found' };
    }
    
    if (preview.converted) {
      return { ok: false, error: 'Preview already converted' };
    }
    
    preview.converted = true;
    preview.convertedAt = Date.now();
    preview.signature = signature;
    
    // Actualizar estadísticas
    data.stats.conversions++;
    data.stats.conversionRate = 
      ((data.stats.conversions / data.stats.totalPreviews) * 100).toFixed(2);
    
    this.saveData(data);
    
    console.log(`✅ Preview converted: ${previewId}`);
    
    return { ok: true };
  }
  
  /**
   * Eliminar preview
   */
  deletePreview(previewId) {
    const data = this.readData();
    
    const index = data.previews.findIndex(p => p.id === previewId);
    
    if (index === -1) {
      return { ok: false, error: 'Preview not found' };
    }
    
    data.previews.splice(index, 1);
    this.saveData(data);
    
    return { ok: true };
  }
  
  /**
   * Verificar disponibilidad de bloques
   */
  checkBlockAvailability(selection) {
    // Aquí deberías verificar contra tu base de datos de ventas
    // Por ahora retornamos array vacío (todos disponibles)
    // Implementar según tu lógica de negocio
    
    const blocked = [];
    
    // Ejemplo de verificación:
    // const salesFile = path.join(this.dataPath, 'sales.json');
    // if (fs.existsSync(salesFile)) {
    //   const sales = JSON.parse(fs.readFileSync(salesFile, 'utf8'));
    //   // Verificar cada bloque...
    // }
    
    return blocked;
  }
  
  /**
   * Limpiar previews expirados
   */
  cleanup() {
    const data = this.readData();
    const now = Date.now();
    
    const before = data.previews.length;
    data.previews = data.previews.filter(p => {
      // Mantener previews convertidos por historial
      if (p.converted) return true;
      // Eliminar no convertidos y expirados
      return now < p.expiresAt;
    });
    
    const removed = before - data.previews.length;
    
    if (removed > 0) {
      this.saveData(data);
      console.log(`🧹 Cleaned ${removed} expired previews`);
    }
  }
  
  /**
   * Obtener estadísticas de previews
   */
  getStats() {
    const data = this.readData();
    
    const activePreviews = data.previews.filter(
      p => !p.converted && Date.now() < p.expiresAt
    ).length;
    
    return {
      ...data.stats,
      activePreviews,
      totalViews: data.previews.reduce((sum, p) => sum + p.viewCount, 0)
    };
  }
  
  /**
   * Obtener todas las previews activas
   */
  getActivePreviews() {
    const data = this.readData();
    const now = Date.now();
    
    return data.previews
      .filter(p => !p.converted && now < p.expiresAt)
      .map(p => ({
        id: p.id,
        metadata: p.metadata,
        selection: p.selection,
        expiresAt: p.expiresAt,
        timeRemaining: Math.floor((p.expiresAt - now) / 1000),
        viewCount: p.viewCount
      }));
  }
  
  /**
   * Obtener previews por wallet
   */
  getPreviewsByWallet(wallet) {
    const data = this.readData();
    const now = Date.now();
    
    return data.previews
      .filter(p => p.wallet === wallet && now < p.expiresAt)
      .map(p => ({
        id: p.id,
        metadata: p.metadata,
        selection: p.selection,
        expiresAt: p.expiresAt,
        timeRemaining: Math.floor((p.expiresAt - now) / 1000),
        converted: p.converted,
        viewCount: p.viewCount
      }));
  }
  
  /**
   * Extender tiempo de preview
   */
  extendPreview(previewId, additionalMinutes = 15) {
    const data = this.readData();
    
    const preview = data.previews.find(p => p.id === previewId);
    
    if (!preview) {
      return { ok: false, error: 'Preview not found' };
    }
    
    if (preview.converted) {
      return { ok: false, error: 'Cannot extend converted preview' };
    }
    
    const additionalMs = additionalMinutes * 60 * 1000;
    preview.expiresAt = Math.max(preview.expiresAt, Date.now()) + additionalMs;
    
    this.saveData(data);
    
    return {
      ok: true,
      newExpiresAt: preview.expiresAt,
      timeRemaining: Math.floor((preview.expiresAt - Date.now()) / 1000)
    };
  }
}

module.exports = PreviewSystem;

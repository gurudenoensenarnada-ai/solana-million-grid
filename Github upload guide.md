# 🚀 ARCHIVOS FALTANTES PARA GITHUB

## ❌ Error Actual
```
Error: Cannot find module './middleware/rateLimiter'
```

## ✅ Solución

Necesitas crear estos 3 archivos en tu GitHub:

1. `middleware/rateLimiter.js`
2. `services/Analytics.js`
3. `services/PreviewSystem.js`

---

## 📁 CÓMO SUBIR LOS ARCHIVOS EN GITHUB

### Opción 1: Interfaz Web de GitHub (FÁCIL)

Para cada archivo:

1. Ve a tu repo: https://github.com/gurudenoensenarnada-ai/solana-million-grid
2. Click en **Add file** → **Create new file**
3. En el campo del nombre escribe la ruta completa (ej: `middleware/rateLimiter.js`)
   - GitHub creará automáticamente la carpeta
4. Copia el contenido del archivo (ver abajo)
5. Click en **Commit new file**

---

## 📄 ARCHIVO 1: middleware/rateLimiter.js

**Nombre del archivo en GitHub**: `middleware/rateLimiter.js`

**Contenido** (copia todo esto):

```javascript
/**
 * 🛡️ RATE LIMITER - Seguridad en la puerta
 * Previene abuso y ataques DDoS
 */

class RateLimiter {
  constructor() {
    // Store: IP -> {count, resetTime, blocked}
    this.requests = new Map();
    this.blockedIPs = new Map();
    
    // Configuración
    this.config = {
      // Ventana de tiempo (1 minuto)
      windowMs: 60 * 1000,
      
      // Límites por endpoint
      limits: {
        general: 60,      // 60 requests/min general
        purchase: 5,      // 5 compras/min
        upload: 10,       // 10 uploads/min
        api: 100,         // 100 API calls/min
      },
      
      // Bloqueo temporal
      blockDuration: 15 * 60 * 1000, // 15 minutos
      maxViolations: 3,  // 3 violaciones = bloqueo
    };
    
    // Limpiar cada 5 minutos
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }
  
  /**
   * Middleware principal
   */
  middleware(limitType = 'general') {
    return (req, res, next) => {
      const ip = this.getIP(req);
      
      // Verificar si está bloqueado
      if (this.isBlocked(ip)) {
        return res.status(429).json({
          ok: false,
          error: 'Too many requests. Please try again later.',
          retryAfter: this.getBlockTimeRemaining(ip),
          blocked: true
        });
      }
      
      // Verificar límite
      const limit = this.config.limits[limitType] || this.config.limits.general;
      const allowed = this.checkLimit(ip, limit, limitType);
      
      if (!allowed) {
        // Registrar violación
        this.recordViolation(ip);
        
        return res.status(429).json({
          ok: false,
          error: `Rate limit exceeded. Maximum ${limit} requests per minute.`,
          retryAfter: this.getResetTime(ip),
          limit,
          limitType
        });
      }
      
      // Agregar headers informativos
      const remaining = this.getRemaining(ip, limit);
      res.setHeader('X-RateLimit-Limit', limit);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', this.getResetTime(ip));
      
      next();
    };
  }
  
  /**
   * Obtener IP real del usuario
   */
  getIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0] ||
           req.headers['x-real-ip'] ||
           req.connection.remoteAddress ||
           req.socket.remoteAddress ||
           'unknown';
  }
  
  /**
   * Verificar límite
   */
  checkLimit(ip, limit, type) {
    const key = `${ip}:${type}`;
    const now = Date.now();
    
    if (!this.requests.has(key)) {
      this.requests.set(key, {
        count: 1,
        resetTime: now + this.config.windowMs,
        violations: 0
      });
      return true;
    }
    
    const record = this.requests.get(key);
    
    // Reset si pasó la ventana
    if (now > record.resetTime) {
      record.count = 1;
      record.resetTime = now + this.config.windowMs;
      return true;
    }
    
    // Incrementar contador
    record.count++;
    
    // Verificar límite
    return record.count <= limit;
  }
  
  /**
   * Verificar si IP está bloqueada
   */
  isBlocked(ip) {
    if (!this.blockedIPs.has(ip)) return false;
    
    const blockInfo = this.blockedIPs.get(ip);
    const now = Date.now();
    
    // Desbloquear si pasó el tiempo
    if (now > blockInfo.until) {
      this.blockedIPs.delete(ip);
      return false;
    }
    
    return true;
  }
  
  /**
   * Registrar violación
   */
  recordViolation(ip) {
    const key = `${ip}:violations`;
    
    if (!this.requests.has(key)) {
      this.requests.set(key, {
        count: 1,
        resetTime: Date.now() + this.config.windowMs
      });
      return;
    }
    
    const record = this.requests.get(key);
    record.count++;
    
    // Bloquear si excede violaciones máximas
    if (record.count >= this.config.maxViolations) {
      this.blockIP(ip);
      console.warn(`🚫 IP blocked due to rate limit violations: ${ip}`);
    }
  }
  
  /**
   * Bloquear IP temporalmente
   */
  blockIP(ip) {
    this.blockedIPs.set(ip, {
      blockedAt: Date.now(),
      until: Date.now() + this.config.blockDuration,
      reason: 'Rate limit violations'
    });
  }
  
  /**
   * Obtener requests restantes
   */
  getRemaining(ip, limit) {
    const keys = Array.from(this.requests.keys()).filter(k => k.startsWith(ip));
    if (keys.length === 0) return limit;
    
    const record = this.requests.get(keys[0]);
    return Math.max(0, limit - record.count);
  }
  
  /**
   * Obtener tiempo de reset
   */
  getResetTime(ip) {
    const keys = Array.from(this.requests.keys()).filter(k => k.startsWith(ip));
    if (keys.length === 0) return Date.now() + this.config.windowMs;
    
    const record = this.requests.get(keys[0]);
    return Math.ceil((record.resetTime - Date.now()) / 1000);
  }
  
  /**
   * Obtener tiempo restante de bloqueo
   */
  getBlockTimeRemaining(ip) {
    if (!this.blockedIPs.has(ip)) return 0;
    
    const blockInfo = this.blockedIPs.get(ip);
    return Math.ceil((blockInfo.until - Date.now()) / 1000);
  }
  
  /**
   * Limpiar registros antiguos
   */
  cleanup() {
    const now = Date.now();
    
    // Limpiar requests expirados
    for (const [key, record] of this.requests.entries()) {
      if (now > record.resetTime) {
        this.requests.delete(key);
      }
    }
    
    // Limpiar bloqueos expirados
    for (const [ip, blockInfo] of this.blockedIPs.entries()) {
      if (now > blockInfo.until) {
        this.blockedIPs.delete(ip);
      }
    }
    
    console.log(`🧹 Rate limiter cleanup: ${this.requests.size} active records, ${this.blockedIPs.size} blocked IPs`);
  }
  
  /**
   * Obtener estadísticas
   */
  getStats() {
    return {
      activeRecords: this.requests.size,
      blockedIPs: this.blockedIPs.size,
      blockedList: Array.from(this.blockedIPs.entries()).map(([ip, info]) => ({
        ip,
        blockedAt: new Date(info.blockedAt).toISOString(),
        expiresAt: new Date(info.until).toISOString(),
        reason: info.reason
      }))
    };
  }
  
  /**
   * Desbloquear IP manualmente (admin)
   */
  unblockIP(ip) {
    if (this.blockedIPs.has(ip)) {
      this.blockedIPs.delete(ip);
      console.log(`✅ IP unblocked manually: ${ip}`);
      return true;
    }
    return false;
  }
}

// Singleton
const rateLimiter = new RateLimiter();

module.exports = rateLimiter;
```

---

✅ **Después de crear este archivo, Render volverá a intentar el deploy automáticamente**

Ahora te preparo los otros 2 archivos...

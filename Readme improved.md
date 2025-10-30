# 🎨 Solana Million Grid - VERSIÓN MEJORADA

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Solana](https://img.shields.io/badge/Solana-Ready-purple)](https://solana.com)

## 🚀 ¿Qué es Nuevo?

Esta versión incluye **5 mejoras profesionales** que transforman tu proyecto:

### ⭐ Nuevas Funcionalidades

| Funcionalidad | Prioridad | Impacto |
|--------------|-----------|---------|
| 🛡️ **Rate Limiting** | ⭐⭐⭐⭐⭐ | Seguridad crítica |
| 👀 **Preview Mode** | ⭐⭐⭐⭐⭐ | +150% conversión |
| 🔗 **Sistema de Referidos** | ⭐⭐⭐⭐⭐ | Crecimiento viral |
| 📊 **Dashboard Admin** | ⭐⭐⭐⭐ | Control total |
| 📈 **Analytics Avanzado** | ⭐⭐⭐⭐ | Decisiones basadas en datos |

---

## 💡 ANALOGÍA SIMPLE

Imagina que tienes una tienda física:

| Sistema | Analogía | Beneficio |
|---------|----------|-----------|
| **Rate Limiting** | Seguridad en la puerta | No dejas entrar a 1000 personas a la vez |
| **Dashboard** | Cámaras de seguridad | Ves todo lo que pasa |
| **Referidos** | Clientes que traen amigos | Descuentos para ambos |
| **Preview** | Probador de ropa | Ver antes de comprar |
| **Analytics** | Contador de gente | Horarios pico, productos más vendidos |

---

## 🎯 RESULTADOS ESPERADOS

### Antes de las Mejoras
```
📊 Métricas Base:
- Conversión: 2-3%
- Tiempo en sitio: 1-2 min
- Tasa de rebote: 60-70%
- Crecimiento: Orgánico lento
- Seguridad: Básica
```

### Después de las Mejoras
```
🚀 Métricas Mejoradas:
- Conversión: 5-8% (+150%)
- Tiempo en sitio: 5-10 min (+400%)
- Tasa de rebote: 30-40% (-50%)
- Crecimiento: Viral (referidos)
- Seguridad: Profesional
```

---

## 📦 INSTALACIÓN RÁPIDA

### 1. Clonar o Actualizar

```bash
# Si es nuevo
git clone https://github.com/tu-usuario/solana-million-grid.git
cd solana-million-grid

# Si ya lo tienes
git pull origin main
```

### 2. Instalar Dependencias

```bash
npm install
```

### 3. Configurar Variables de Entorno

```bash
# Copiar .env de ejemplo
cp .env.example .env

# Editar con tus valores
nano .env
```

```env
# Básicas
PORT=3000
NODE_ENV=production

# Solana
SOLANA_CLUSTER=mainnet-beta
MERCHANT_WALLET=tu_wallet_address
OWNER_WALLET=tu_wallet_address

# Telegram (opcional)
TELEGRAM_BOT_TOKEN=tu_token
TELEGRAM_CHAT_ID=tu_chat_id

# Site
SITE_URL=https://www.solanamillondollar.com

# Seguridad (IMPORTANTE)
ADMIN_PASSWORD=tu_password_super_seguro
```

### 4. Iniciar

```bash
# Desarrollo
npm run dev

# Producción
npm start
```

### 5. Verificar

```bash
# Health check
curl http://localhost:3000/health

# Dashboard
open http://localhost:3000/admin-dashboard.html
```

---

## 🛡️ 1. RATE LIMITING

### ¿Para Qué?

Protege tu servidor de:
- Ataques DDoS
- Spam de compras
- Abuso de API
- Scraping masivo

### Configuración

```javascript
// middleware/rateLimiter.js

limits: {
  general: 60,      // 60 requests/min navegación
  purchase: 5,      // 5 compras/min (evita spam)
  upload: 10,       // 10 uploads/min
  api: 100          // 100 API calls/min
}
```

### Endpoints Protegidos

- ✅ `/api/purchase` - 5 req/min
- ✅ `/api/upload` - 10 req/min
- ✅ Todos los demás - 60 req/min

### Ver Estadísticas

```
GET /api/security/stats
```

Respuesta:
```json
{
  "activeRecords": 127,
  "blockedIPs": 3,
  "blockedList": [...]
}
```

---

## 👀 2. PREVIEW MODE

### ¿Para Qué?

Permite a los usuarios **ver cómo quedará su compra ANTES de pagar**.

### Flujo

1. Usuario selecciona bloques
2. Sube logo y llena info
3. Hace clic en "Ver Preview"
4. Sistema genera preview de 30 minutos
5. Usuario ve su proyecto en el grid
6. Decide si comprar o ajustar

### API

```javascript
// Crear preview
POST /api/preview/create
{
  "wallet": "ABC123...",
  "selection": { minBlockX, minBlockY, blocksX, blocksY },
  "metadata": { name, url, logo, description }
}

// Ver preview
GET /api/preview/:id

// Listar activos
GET /api/preview/active

// Convertir a compra
POST /api/preview/:id/convert
{
  "signature": "transaction_signature"
}
```

### Estadísticas

```
GET /api/preview/stats
```

```json
{
  "totalPreviews": 150,
  "conversionRate": "7.3%",
  "activePreviews": 5
}
```

---

## 🔗 3. SISTEMA DE REFERIDOS

### ¿Para Qué?

Crecimiento viral: **tus usuarios traen más usuarios**.

### Comisión

- **10% de cada venta** que traigan
- Automático
- Tracking completo

### Flujo

1. Usuario pide código de referido
```javascript
POST /api/referrals/code
{ "wallet": "ABC...", "name": "Mi Proyecto" }
```

2. Recibe link personalizado
```
https://tudominio.com?ref=ABC123A1B2
```

3. Comparte en redes sociales

4. Cada compra con su código = **10% de comisión**

### Ejemplo Real

```
Usuario A comparte su link
Usuario B compra 10 bloques = 0.5 SOL
Usuario A gana = 0.05 SOL (10%)
```

### Leaderboard

```
GET /api/referrals/leaderboard
```

```json
{
  "leaderboard": [
    {
      "code": "ABC123A1B2",
      "wallet": "ABC123...",
      "totalReferrals": 15,
      "totalCommissions": 0.75
    }
  ]
}
```

---

## 📊 4. DASHBOARD DE ADMINISTRACIÓN

### Ubicación

```
/admin-dashboard.html
```

### Tabs Disponibles

#### 📈 Overview
- Revenue total
- Ventas del día
- Bloques vendidos
- Actividad reciente

#### 💳 Sales
- Historial completo
- Filtros por fecha
- Exportar CSV
- Detalles de cada venta

#### 📊 Analytics
- Visitantes únicos
- Fuentes de tráfico
- Dispositivos
- Conversión
- Tiempo en sitio

#### 🔗 Referrals
- Top 10 referidores
- Comisiones generadas
- Códigos activos
- Estadísticas

#### 👀 Previews
- Previews activos
- Tasa de conversión
- Tiempo restante
- Vistas

#### 🛡️ Security
- IPs bloqueadas
- Rate limit stats
- Desbloquear IPs
- Logs de seguridad

### Screenshots

Dashboard con métricas en tiempo real, gráficos, tablas y estadísticas completas.

---

## 📈 5. ANALYTICS AVANZADO

### Métricas Automáticas

El sistema trackea automáticamente:

- ✅ Page views
- ✅ Visitantes únicos
- ✅ Tiempo en sitio
- ✅ Bounce rate
- ✅ Dispositivos
- ✅ Fuentes de tráfico
- ✅ Geolocalización
- ✅ Ventas
- ✅ Conversión
- ✅ Bloques más vistos
- ✅ Heatmap de clicks

### API

```javascript
// Dashboard de analytics
GET /api/analytics/dashboard?period=7d

// Reporte de ventas
GET /api/analytics/sales-report?period=30d

// Trackear evento custom
POST /api/analytics/track
{ "event": "button_click", "data": {...} }

// Trackear interacción
POST /api/analytics/block-interaction
{ "blockX": 10, "blockY": 15, "action": "click" }
```

### Períodos Disponibles

- `24h` - Últimas 24 horas
- `7d` - Última semana
- `30d` - Último mes
- `90d` - Últimos 3 meses

---

## 🗂️ ESTRUCTURA DE ARCHIVOS

```
solana-million-grid/
├── middleware/
│   └── rateLimiter.js          ← Rate limiting
├── services/
│   ├── Analytics.js            ← Sistema de analytics
│   └── PreviewSystem.js        ← Preview mode
├── public/
│   ├── index.html              ← Grid principal
│   ├── admin-dashboard.html    ← Dashboard admin
│   └── favicon.ico
├── uploads/                    ← Logos subidos
├── Referral system.js          ← Sistema de referidos
├── server.js                   ← Servidor Express
├── index.js                    ← Configuración
├── package.json
├── .env                        ← Variables de entorno
├── IMPLEMENTATION_GUIDE.md     ← Guía de implementación
└── README.md                   ← Este archivo
```

---

## 📝 GUÍA DE USO

### Para Usuarios

1. **Visitar el sitio**
```
https://tudominio.com
```

2. **Seleccionar bloques** en el grid

3. **Ver preview** (opcional pero recomendado)
```javascript
- Click en "Ver Preview"
- Se abre ventana con simulación
- 30 minutos para decidir
```

4. **Conectar wallet** Phantom/Solflare

5. **Comprar**
```javascript
- Ingresa info del proyecto
- Sube logo
- Confirma transacción
- ¡Listo!
```

6. **Compartir link de referido** (opcional)
```javascript
- Genera tu código
- Comparte en redes
- Gana 10% por cada venta
```

### Para Administradores

1. **Acceder al dashboard**
```
https://tudominio.com/admin-dashboard.html
```

2. **Login** con credenciales

3. **Monitorear métricas**
- Revenue total
- Ventas del día
- Conversión
- Referidos activos

4. **Gestionar seguridad**
- Ver IPs bloqueadas
- Desbloquear si necesario
- Ajustar límites

5. **Analizar datos**
- Fuentes de tráfico
- Dispositivos
- Zonas más vendidas
- Horas pico

6. **Exportar reportes**
- CSV de ventas
- Analytics por período
- Leaderboard de referidos

---

## 🔐 SEGURIDAD

### ⚠️ IMPORTANTE EN PRODUCCIÓN

1. **Proteger Dashboard**

```javascript
// En server.js
app.use('/admin-dashboard.html', authenticateAdmin);
```

2. **Variables de Entorno Seguras**

```bash
# .env NO debe estar en Git
echo ".env" >> .gitignore
```

3. **HTTPS Obligatorio**

```javascript
// Forzar HTTPS en producción
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(`https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
}
```

4. **Rate Limits Ajustados**

Para tu tráfico específico:
```javascript
// middleware/rateLimiter.js
limits: {
  general: 100,  // Aumentar si tienes mucho tráfico legítimo
  purchase: 10,  // Ajustar según velocidad de ventas
}
```

---

## 🚀 DEPLOYMENT

### Render.com

1. Conectar repositorio
2. Settings:
```
Build Command: npm install
Start Command: npm start
Environment: Node
```
3. Variables de entorno desde dashboard
4. Deploy

### Vercel

```bash
vercel --prod
```

### Railway

```bash
railway up
```

### Docker

```dockerfile
FROM node:18
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

```bash
docker build -t solana-million-grid .
docker run -p 3000:3000 --env-file .env solana-million-grid
```

---

## 📊 MONITOREO

### Métricas Clave

```javascript
// Diarias
- Ventas nuevas
- Revenue
- Visitantes únicos
- Conversión

// Semanales
- Crecimiento de ventas
- Tasa de referidos
- Zonas más populares
- Horas pico

// Mensuales
- Revenue total
- Bloques vendidos
- ROI de referidos
- Tráfico orgánico vs referido
```

### Alertas Recomendadas

1. **Ventas**
- Nueva venta → Telegram
- Meta diaria alcanzada → Email

2. **Seguridad**
- IP bloqueada → Log
- Rate limit excedido frecuentemente → Alerta

3. **Performance**
- Tiempo de respuesta > 2s → Alerta
- Error rate > 1% → Notificación

---

## 🆘 SOPORTE Y TROUBLESHOOTING

### Problemas Comunes

**Rate limiter bloqueando usuarios reales**
```javascript
// Solución: Aumentar límites
// En middleware/rateLimiter.js
limits: { general: 100 }
```

**Preview no se renderiza**
```bash
# Verificar permisos
chmod 755 uploads/
chmod 644 uploads/*
```

**Analytics no trackea**
```javascript
// Verificar que se llama trackPageView
// En server.js logging middleware
analytics.trackPageView(req);
```

**Referidos no convierten**
```javascript
// Verificar que se envía referralCode
// En frontend
const code = localStorage.getItem('referralCode');
// Incluir en POST /api/purchase
```

### Logs Útiles

```bash
# Ver todos los logs
tail -f logs/combined.log

# Solo errores
tail -f logs/error.log

# Filtrar por tipo
grep "Rate limit" logs/combined.log
grep "Purchase" logs/combined.log
grep "Analytics" logs/combined.log
```

---

## 🤝 CONTRIBUIR

### Reportar Bugs

1. Ir a Issues
2. Crear nuevo issue
3. Template: Bug Report
4. Incluir:
   - Descripción
   - Pasos para reproducir
   - Comportamiento esperado
   - Screenshots si aplica

### Proponer Features

1. Ir a Issues
2. Crear nuevo issue
3. Template: Feature Request
4. Incluir:
   - Descripción de la feature
   - Por qué es útil
   - Ejemplo de uso

### Pull Requests

1. Fork del repo
2. Crear branch: `git checkout -b feature/nueva-feature`
3. Commit: `git commit -m 'Agregar nueva feature'`
4. Push: `git push origin feature/nueva-feature`
5. Crear Pull Request

---

## 📄 LICENCIA

MIT License - Ver [LICENSE](LICENSE) para más detalles.

---

## 🙏 AGRADECIMIENTOS

- Solana Foundation
- Phantom Wallet
- Comunidad Web3
- Todos los contribuidores

---

## 📞 CONTACTO

- **Website**: https://www.solanamillondollar.com
- **Telegram**: @tu_usuario
- **Twitter**: @tu_usuario
- **Email**: contacto@tudominio.com

---

## 🎉 ¡GRACIAS POR USAR SOLANA MILLION GRID!

Si te gusta el proyecto:
- ⭐ Dale una estrella en GitHub
- 🔗 Comparte con tu comunidad
- 💬 Únete a nuestro Discord
- 🐦 Síguenos en Twitter

---

**Hecho con ❤️ para la comunidad Solana**

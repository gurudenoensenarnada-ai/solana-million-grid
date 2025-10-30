/**
 * 📊 ANALYTICS SYSTEM
 * Seguimiento completo de métricas y comportamiento
 */

const fs = require('fs');
const path = require('path');

class Analytics {
  constructor(dataPath) {
    this.dataPath = dataPath;
    this.analyticsFile = path.join(dataPath, 'analytics.json');
    this.init();
  }
  
  /**
   * Inicializar archivo de analytics
   */
  init() {
    if (!fs.existsSync(this.analyticsFile)) {
      const initialData = {
        // Estadísticas generales
        overview: {
          totalVisits: 0,
          uniqueVisitors: 0,
          totalPageViews: 0,
          averageSessionDuration: 0,
          bounceRate: 0,
          conversionRate: 0
        },
        
        // Visitantes únicos por día
        dailyVisitors: {},
        
        // Eventos de usuario
        events: [],
        
        // Métricas de venta
        salesMetrics: {
          totalSales: 0,
          totalRevenue: 0,
          averageOrderValue: 0,
          topSellingZones: { gold: 0, silver: 0, bronze: 0 },
          peakHours: {},
          peakDays: {}
        },
        
        // Comportamiento de usuario
        userBehavior: {
          mostViewedBlocks: [],
          clickHeatmap: {},
          scrollDepth: [],
          timeOnSite: []
        },
        
        // Fuentes de tráfico
        trafficSources: {
          direct: 0,
          referral: 0,
          social: 0,
          search: 0,
          other: 0
        },
        
        // Dispositivos
        devices: {
          mobile: 0,
          tablet: 0,
          desktop: 0
        },
        
        // Geolocalización
        geography: {},
        
        // Rendimiento
        performance: {
          averageLoadTime: 0,
          apiResponseTimes: []
        }
      };
      
      fs.writeFileSync(this.analyticsFile, JSON.stringify(initialData, null, 2));
      console.log('✅ Analytics initialized');
    }
  }
  
  /**
   * Leer datos de analytics
   */
  readData() {
    try {
      const data = fs.readFileSync(this.analyticsFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error reading analytics:', error);
      this.init();
      return this.readData();
    }
  }
  
  /**
   * Guardar datos
   */
  saveData(data) {
    fs.writeFileSync(this.analyticsFile, JSON.stringify(data, null, 2));
  }
  
  /**
   * Registrar visita de página
   */
  trackPageView(req) {
    const data = this.readData();
    const ip = this.getIP(req);
    const today = new Date().toISOString().split('T')[0];
    
    // Incrementar page views
    data.overview.totalPageViews++;
    
    // Registrar visitante único diario
    if (!data.dailyVisitors[today]) {
      data.dailyVisitors[today] = new Set();
    }
    
    const visitors = new Set(data.dailyVisitors[today]);
    const isNew = !visitors.has(ip);
    
    if (isNew) {
      visitors.add(ip);
      data.dailyVisitors[today] = Array.from(visitors);
      data.overview.uniqueVisitors++;
    }
    
    // Detectar dispositivo
    const device = this.detectDevice(req);
    data.devices[device]++;
    
    // Detectar fuente de tráfico
    const source = this.detectTrafficSource(req);
    data.trafficSources[source]++;
    
    this.saveData(data);
  }
  
  /**
   * Registrar evento personalizado
   */
  trackEvent(eventName, eventData = {}, req = null) {
    const data = this.readData();
    
    const event = {
      name: eventName,
      data: eventData,
      timestamp: Date.now(),
      ip: req ? this.getIP(req) : null,
      userAgent: req ? req.headers['user-agent'] : null
    };
    
    data.events.push(event);
    
    // Mantener solo últimos 10000 eventos
    if (data.events.length > 10000) {
      data.events = data.events.slice(-10000);
    }
    
    this.saveData(data);
  }
  
  /**
   * Registrar venta (métricas específicas)
   */
  trackSale(saleData) {
    const data = this.readData();
    
    // Actualizar métricas de venta
    data.salesMetrics.totalSales++;
    data.salesMetrics.totalRevenue += saleData.amount;
    data.salesMetrics.averageOrderValue = 
      data.salesMetrics.totalRevenue / data.salesMetrics.totalSales;
    
    // Zona más vendida
    const zone = this.getZone(saleData.metadata.selection.minBlockY);
    data.salesMetrics.topSellingZones[zone]++;
    
    // Hora pico
    const hour = new Date(saleData.timestamp).getHours();
    data.salesMetrics.peakHours[hour] = (data.salesMetrics.peakHours[hour] || 0) + 1;
    
    // Día pico
    const day = new Date(saleData.timestamp).toLocaleDateString('en-US', { weekday: 'long' });
    data.salesMetrics.peakDays[day] = (data.salesMetrics.peakDays[day] || 0) + 1;
    
    // Calcular conversion rate
    data.overview.conversionRate = 
      (data.salesMetrics.totalSales / data.overview.totalPageViews * 100).toFixed(2);
    
    this.saveData(data);
  }
  
  /**
   * Registrar interacción con el grid
   */
  trackBlockInteraction(blockX, blockY, action = 'view') {
    const data = this.readData();
    const blockKey = `${blockX},${blockY}`;
    
    if (action === 'view') {
      const views = data.userBehavior.mostViewedBlocks;
      const existing = views.find(b => b.block === blockKey);
      
      if (existing) {
        existing.views++;
      } else {
        views.push({ block: blockKey, views: 1, x: blockX, y: blockY });
      }
      
      // Ordenar por más vistas
      data.userBehavior.mostViewedBlocks = views
        .sort((a, b) => b.views - a.views)
        .slice(0, 100); // Top 100
    }
    
    if (action === 'click') {
      if (!data.userBehavior.clickHeatmap[blockKey]) {
        data.userBehavior.clickHeatmap[blockKey] = 0;
      }
      data.userBehavior.clickHeatmap[blockKey]++;
    }
    
    this.saveData(data);
  }
  
  /**
   * Registrar tiempo en sitio
   */
  trackTimeOnSite(duration) {
    const data = this.readData();
    
    data.userBehavior.timeOnSite.push(duration);
    
    // Mantener últimos 1000 registros
    if (data.userBehavior.timeOnSite.length > 1000) {
      data.userBehavior.timeOnSite = data.userBehavior.timeOnSite.slice(-1000);
    }
    
    // Calcular duración promedio de sesión
    const avg = data.userBehavior.timeOnSite.reduce((a, b) => a + b, 0) / 
                data.userBehavior.timeOnSite.length;
    data.overview.averageSessionDuration = Math.round(avg);
    
    this.saveData(data);
  }
  
  /**
   * Registrar tiempo de carga
   */
  trackPerformance(loadTime, endpoint = 'page') {
    const data = this.readData();
    
    if (endpoint === 'page') {
      const times = [data.performance.averageLoadTime, loadTime];
      data.performance.averageLoadTime = 
        times.reduce((a, b) => a + b, 0) / times.length;
    } else {
      data.performance.apiResponseTimes.push({
        endpoint,
        time: loadTime,
        timestamp: Date.now()
      });
      
      // Mantener últimos 500 registros
      if (data.performance.apiResponseTimes.length > 500) {
        data.performance.apiResponseTimes = 
          data.performance.apiResponseTimes.slice(-500);
      }
    }
    
    this.saveData(data);
  }
  
  /**
   * Obtener dashboard de analytics
   */
  getDashboard(period = '7d') {
    const data = this.readData();
    const now = Date.now();
    const periodMs = this.parsePeriod(period);
    const startTime = now - periodMs;
    
    // Filtrar eventos por período
    const periodEvents = data.events.filter(e => e.timestamp >= startTime);
    
    // Calcular métricas del período
    const salesInPeriod = periodEvents.filter(e => e.name === 'purchase').length;
    const uniqueVisitorsInPeriod = new Set(
      periodEvents.filter(e => e.ip).map(e => e.ip)
    ).size;
    
    return {
      period,
      overview: {
        ...data.overview,
        salesInPeriod,
        uniqueVisitorsInPeriod,
        eventsInPeriod: periodEvents.length
      },
      salesMetrics: {
        ...data.salesMetrics,
        peakHoursList: this.getTopN(data.salesMetrics.peakHours, 5),
        peakDaysList: this.getTopN(data.salesMetrics.peakDays, 7)
      },
      userBehavior: {
        topBlocks: data.userBehavior.mostViewedBlocks.slice(0, 10),
        averageTimeOnSite: this.formatDuration(data.overview.averageSessionDuration),
        heatmapTopSpots: this.getTopN(data.userBehavior.clickHeatmap, 20)
      },
      trafficSources: this.calculatePercentages(data.trafficSources),
      devices: this.calculatePercentages(data.devices),
      performance: {
        averageLoadTime: `${data.performance.averageLoadTime.toFixed(2)}ms`,
        slowestEndpoints: this.getSlowestEndpoints(data.performance.apiResponseTimes, 5)
      },
      recentEvents: periodEvents.slice(-50).reverse()
    };
  }
  
  /**
   * Obtener informe de ventas
   */
  getSalesReport(period = '30d') {
    const data = this.readData();
    const now = Date.now();
    const periodMs = this.parsePeriod(period);
    const startTime = now - periodMs;
    
    const salesEvents = data.events.filter(
      e => e.name === 'purchase' && e.timestamp >= startTime
    );
    
    // Agrupar por día
    const salesByDay = {};
    salesEvents.forEach(sale => {
      const day = new Date(sale.timestamp).toISOString().split('T')[0];
      if (!salesByDay[day]) {
        salesByDay[day] = { count: 0, revenue: 0 };
      }
      salesByDay[day].count++;
      salesByDay[day].revenue += sale.data.amount || 0;
    });
    
    return {
      period,
      totalSales: salesEvents.length,
      totalRevenue: salesEvents.reduce((sum, s) => sum + (s.data.amount || 0), 0),
      averageOrderValue: data.salesMetrics.averageOrderValue,
      salesByDay,
      topZone: this.getTopZone(data.salesMetrics.topSellingZones),
      conversionRate: data.overview.conversionRate
    };
  }
  
  /**
   * Utilidades
   */
  
  getIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0] ||
           req.headers['x-real-ip'] ||
           req.connection.remoteAddress ||
           'unknown';
  }
  
  detectDevice(req) {
    const ua = req.headers['user-agent'] || '';
    if (/mobile/i.test(ua)) return 'mobile';
    if (/tablet|ipad/i.test(ua)) return 'tablet';
    return 'desktop';
  }
  
  detectTrafficSource(req) {
    const referer = req.headers['referer'] || req.headers['referrer'] || '';
    
    if (!referer) return 'direct';
    if (/google|bing|yahoo|duckduckgo/i.test(referer)) return 'search';
    if (/facebook|twitter|instagram|linkedin|reddit/i.test(referer)) return 'social';
    if (referer.includes(req.headers.host)) return 'direct';
    
    return 'referral';
  }
  
  getZone(row) {
    if (row <= 24) return 'gold';
    if (row >= 25 && row <= 59) return 'silver';
    return 'bronze';
  }
  
  parsePeriod(period) {
    const match = period.match(/^(\d+)([hdwmy])$/);
    if (!match) return 7 * 24 * 60 * 60 * 1000; // Default 7 days
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    const multipliers = {
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
      w: 7 * 24 * 60 * 60 * 1000,
      m: 30 * 24 * 60 * 60 * 1000,
      y: 365 * 24 * 60 * 60 * 1000
    };
    
    return value * (multipliers[unit] || multipliers.d);
  }
  
  getTopN(obj, n) {
    return Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([key, value]) => ({ key, value }));
  }
  
  calculatePercentages(obj) {
    const total = Object.values(obj).reduce((a, b) => a + b, 0);
    const result = {};
    
    for (const [key, value] of Object.entries(obj)) {
      result[key] = {
        count: value,
        percentage: total > 0 ? ((value / total) * 100).toFixed(1) : 0
      };
    }
    
    return result;
  }
  
  getSlowestEndpoints(times, n) {
    return times
      .sort((a, b) => b.time - a.time)
      .slice(0, n)
      .map(t => ({
        endpoint: t.endpoint,
        time: `${t.time.toFixed(2)}ms`,
        timestamp: new Date(t.timestamp).toISOString()
      }));
  }
  
  getTopZone(zones) {
    return Object.entries(zones)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'none';
  }
  
  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    
    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    }
    return `${seconds}s`;
  }
}

module.exports = Analytics;

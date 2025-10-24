// Nuevo: src/sales-init.js
// Inicializa y cachea sales.json en memoria y exporta getSales/saveSales para integrarlo con server.js

const fs = require('fs');
const path = require('path');
const { downloadSalesJSONObject, uploadSalesJSONObject } = require('../cloudinary-helpers');

const SALES_FILE = path.resolve(__dirname, '..', 'sales.json'); // misma ruta que server.js
const SALES_PUBLIC_ID = process.env.SALES_PUBLIC_ID || 'sales';
let SALES_CACHE = null;

/**
 * Init: intenta cargar desde Cloudinary (public id SALES_PUBLIC_ID).
 * Si no existe, crea un objeto { sales: [] } en Cloudinary y en cache.
 * También escribe una copia local temporal para compatibilidad.
 */
async function initSales() {
  try {
    const res = await downloadSalesJSONObject(SALES_PUBLIC_ID);
    if (res.ok && res.data) {
      SALES_CACHE = res.data;
      try { fs.writeFileSync(SALES_FILE, JSON.stringify(SALES_CACHE, null, 2), 'utf8'); } catch (e) { /* noop */ }
      console.log('sales.json cargado desde Cloudinary y cacheado');
      return;
    }
    // si devuelve ok:false o no existe, inicializamos vacío
    const initial = { sales: [] };
    const up = await uploadSalesJSONObject(initial, SALES_PUBLIC_ID);
    if (!up.ok) console.warn('initSales: no se pudo subir sales inicial a Cloudinary:', up.error);
    SALES_CACHE = initial;
    try { fs.writeFileSync(SALES_FILE, JSON.stringify(initial, null, 2), 'utf8'); } catch (e) { /* noop */ }
    console.log('Inicializado sales.json en Cloudinary y en cache');
  } catch (err) {
    console.warn('No se pudo inicializar sales desde Cloudinary:', err?.message || err);
    // fallback a copia local
    if (fs.existsSync(SALES_FILE)) {
      try {
        const data = JSON.parse(fs.readFileSync(SALES_FILE, 'utf8'));
        SALES_CACHE = data;
        console.log('sales.json cargado desde copia local');
      } catch (e) {
        SALES_CACHE = { sales: [] };
        try { fs.writeFileSync(SALES_FILE, JSON.stringify(SALES_CACHE, null, 2), 'utf8'); } catch(e){}
        console.log('sales.json local inicializado vacío por fallo parseo');
      }
    } else {
      SALES_CACHE = { sales: [] };
      try { fs.writeFileSync(SALES_FILE, JSON.stringify(SALES_CACHE, null, 2), 'utf8'); } catch(e){}
      console.log('sales.json local inicializado vacío (fallback)');
    }
  }
}

function getSales() {
  if (!SALES_CACHE) return { sales: [] };
  return SALES_CACHE;
}

/**
 * Actualiza cache y sube a Cloudinary (overwrite).
 * Además escribe una copia local para compatibilidad.
 */
async function saveSales(newSalesObj) {
  SALES_CACHE = newSalesObj;
  try {
    const up = await uploadSalesJSONObject(newSalesObj, SALES_PUBLIC_ID);
    if (!up.ok) console.warn('saveSales: error subiendo a Cloudinary:', up.error);
  } catch (err) {
    console.warn('saveSales: exception subiendo a Cloudinary:', err?.message || err);
  }
  try {
    fs.writeFileSync(SALES_FILE, JSON.stringify(newSalesObj, null, 2), 'utf8');
  } catch (e) {
    console.warn('saveSales: no se pudo escribir copia local:', e?.message || e);
  }
  return true;
}

module.exports = { initSales, getSales, saveSales };

// Nuevo: src/sales-init.js
// Inicializa y cachea sales.json en memoria y exporta getSales/saveSales para integrarlo con server.js

const fs = require('fs');
const path = require('path');
const { downloadSalesJSONObject, uploadSalesJSONObject, SALES_PUBLIC_ID } = require('../cloudinary-helpers');

const SALES_FILE = path.resolve(__dirname, '..', 'sales.json'); // usar misma ruta que server.js
let SALES_CACHE = null;

/**
 * Init: intenta cargar desde Cloudinary (public id SALES_PUBLIC_ID).
 * Si no existe, crea un array vacío en Cloudinary y en cache.
 * También escribe una copia local temporal (opcional) para compatibilidad.
 */
async function initSales() {
  try {
    const remote = await downloadSalesJSONObject();
    if (remote === null) {
      const initial = { sales: [] };
      await uploadSalesJSONObject(initial, SALES_PUBLIC_ID);
      SALES_CACHE = initial;
      // escribir copia local para compatibilidad con código que usa sales.json localmente
      try { fs.writeFileSync(SALES_FILE, JSON.stringify(initial, null, 2), 'utf8'); } catch (e) { /* noop */ }
      console.log('Inicializado sales.json en Cloudinary y en cache');
    } else {
      SALES_CACHE = remote;
      try { fs.writeFileSync(SALES_FILE, JSON.stringify(remote, null, 2), 'utf8'); } catch (e) { /* noop */ }
      console.log('sales.json cargado desde Cloudinary y cacheado');
    }
  } catch (err) {
    console.warn('No se pudo inicializar sales desde Cloudinary:', err?.message || err);
    // fallback: si hay una copia local úsala, si no crear vacía
    if (fs.existsSync(SALES_FILE)) {
      try {
        const data = JSON.parse(fs.readFileSync(SALES_FILE, 'utf8'));
        SALES_CACHE = data;
        console.log('sales.json cargado desde copia local');
      } catch (e) {
        SALES_CACHE = { sales: [] };
        fs.writeFileSync(SALES_FILE, JSON.stringify(SALES_CACHE, null, 2), 'utf8');
        console.log('sales.json local inicializado vacío');
      }
    } else {
      SALES_CACHE = { sales: [] };
      try { fs.writeFileSync(SALES_FILE, JSON.stringify(SALES_CACHE, null, 2), 'utf8'); } catch (e) { /* noop */ }
    }
  }
}

/**
 * Devuelve la estructura sales desde cache (si no está inicializada, devuelve {sales: []})
 */
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
    await uploadSalesJSONObject(newSalesObj, SALES_PUBLIC_ID);
  } catch (err) {
    console.warn('Error subiendo sales.json a Cloudinary:', err?.message || err);
  }
  try {
    fs.writeFileSync(SALES_FILE, JSON.stringify(newSalesObj, null, 2), 'utf8');
  } catch (e) { /* noop */ }
  return true;
}

module.exports = { initSales, getSales, saveSales };

/**
 * cloudinary-helpers.js
 * Helper to restore/download backups from Cloudinary.
 *
 * export: restoreImagesFromCloudinary(publicId, destPath, cloudName, apiKey, apiSecret, opts)
 *
 * Mejoras añadidas:
 * - Descarga atómica (tmp -> rename) para evitar archivos corruptos.
 * - Reintentos con backoff en descargas y llamadas a Admin API.
 * - Creación automática del directorio destino si no existe.
 * - Mensajes de error más detallados para facilitar debugging.
 * - Limpieza de archivos temporales en caso de fallo.
 * - Corrección de retornos y manejo de errores.
 *
 * Uso:
 * const { restoreImagesFromCloudinary } = require('./cloudinary-helpers');
 * const res = await restoreImagesFromCloudinary('solana_sales_backup', './sales.json', 'mi_cloud', apiKey, apiSecret);
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_DOWNLOAD_RETRIES = 3;
const DEFAULT_ADMIN_RETRIES = 3;
const BACKOFF_BASE_MS = 800; // multiplicador exponencial

function ensureDirExists(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Descarga una URL a un archivo destino de forma atómica:
 * - descarga a tmpPath (destPath + .tmp)
 * - al finalizar, renombra tmpPath -> destPath
 */
async function downloadToFileAtomic(url, destPath, timeout = DEFAULT_TIMEOUT_MS) {
  ensureDirExists(destPath);
  const tmpPath = `${destPath}.tmp`;

  // limpiar tmp si existe de previos intentos
  try {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  } catch (e) {
    // noop
  }

  const resp = await axios.get(url, { responseType: 'stream', timeout });
  const writer = fs.createWriteStream(tmpPath);

  return new Promise((resolve, reject) => {
    let finished = false;
    resp.data.pipe(writer);
    writer.on('finish', () => {
      finished = true;
      try {
        fs.renameSync(tmpPath, destPath);
        resolve({ ok: true, url });
      } catch (err) {
        // cleanup tmp on failure to rename
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (e) { /* ignore */ }
        reject(new Error(`Error renombrando tmp a destino: ${err.message || err}`));
      }
    });
    writer.on('error', (err) => {
      // cleanup tmp on error
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (e) { /* ignore */ }
      if (!finished) reject(err);
    });
  });
}

/**
 * tryDownloadUrl con reintentos/backoff más robusto
 */
async function tryDownloadUrlWithRetries(url, destPath, retries = DEFAULT_DOWNLOAD_RETRIES, timeout = DEFAULT_TIMEOUT_MS) {
  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await downloadToFileAtomic(url, destPath, timeout);
      // res.ok === true and res.url === url
      return { ok: true, url: res.url };
    } catch (err) {
      lastErr = err;
      const waitMs = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
      console.warn(`tryDownloadUrlWithRetries: intento ${attempt} fallo: ${err.message || err}. Reintentando en ${waitMs}ms`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
  return { ok: false, error: lastErr ? (lastErr.message || String(lastErr)) : 'unknown' };
}

/**
 * Llama a la Admin API de Cloudinary para obtener secure_url del recurso raw.
 */
async function getCloudinaryResourceSecureUrl(publicId, cloudName, apiKey, apiSecret, retries = DEFAULT_ADMIN_RETRIES) {
  if (!apiKey || !apiSecret) {
    throw new Error('No API credentials provided');
  }
  const adminUrl = `https://api.cloudinary.com/v1_1/${cloudName}/resources/raw/${encodeURIComponent(publicId)}`;

  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await axios.get(adminUrl, {
        auth: {
          username: apiKey,
          password: apiSecret
        },
        timeout: DEFAULT_TIMEOUT_MS
      });
      if (resp && resp.data && resp.data.secure_url) {
        return resp.data.secure_url;
      } else {
        throw new Error('Admin API no devolvió secure_url');
      }
    } catch (err) {
      lastErr = err;
      const waitMs = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
      console.warn(`getCloudinaryResourceSecureUrl: intento ${attempt} fallo: ${err.message || err}. Reintentando en ${waitMs}ms`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
  throw lastErr || new Error('Failed to fetch resource from Admin API');
}

/**
 * restoreImagesFromCloudinary
 * - publicId: public_id en Cloudinary (string)
 * - destPath: ruta local donde guardar el archivo (string)
 * - cloudName: nombre de cloudinary (string)
 * - apiKey, apiSecret: opcionales, para usar Admin API si la descarga pública falla
 * - opts: { downloadRetries, adminRetries, timeout }
 *
 * Devuelve { ok: true, url } o { ok: false, error }
 */
async function restoreImagesFromCloudinary(publicId, destPath, cloudName, apiKey, apiSecret, opts = {}) {
  const downloadRetries = Number.isFinite(opts.downloadRetries) ? opts.downloadRetries : DEFAULT_DOWNLOAD_RETRIES;
  const adminRetries = Number.isFinite(opts.adminRetries) ? opts.adminRetries : DEFAULT_ADMIN_RETRIES;
  const timeout = opts.timeout || DEFAULT_TIMEOUT_MS;

  if (!publicId || !destPath || !cloudName) {
    return { ok: false, error: 'Faltan parámetros (publicId, destPath, cloudName)' };
  }

  // 1) Intentar delivery público
  const publicUrl = `https://res.cloudinary.com/${cloudName}/raw/upload/${encodeURIComponent(publicId)}`;
  try {
    const dres = await tryDownloadUrlWithRetries(publicUrl, destPath, downloadRetries, timeout);
    if (dres.ok) return { ok: true, url: dres.url };
    console.warn(`restore: descarga pública falló: ${dres.error}`);
  } catch (e) {
    console.warn('restore: error en descarga pública:', e.message || e);
  }

  // 2) Si tenemos API keys, intentar Admin API para obtener secure_url y descargarla
  if (apiKey && apiSecret) {
    try {
      const secureUrl = await getCloudinaryResourceSecureUrl(publicId, cloudName, apiKey, apiSecret, adminRetries);
      if (secureUrl) {
        const dres2 = await tryDownloadUrlWithRetries(secureUrl, destPath, downloadRetries, timeout);
        if (dres2.ok) return { ok: true, url: dres2.url };
        return { ok: false, error: `No se pudo descargar secure_url: ${dres2.error}` };
      }
      return { ok: false, error: 'Admin API no devolvió secure_url' };
    } catch (err) {
      return { ok: false, error: `Admin API error: ${err.message || err}` };
    }
  }

  // 3) Como último recurso, intentar variaciones comunes de publicId
  // (ej: si el publicId fue subido con path/nombre distinto). Probar sufijos simples no invasivos.
  try {
    const altCandidates = [
      `${publicId}.json`,
      `${publicId}-backup`,
      `${publicId}_backup`
    ];
    for (const candidate of altCandidates) {
      const altUrl = `https://res.cloudinary.com/${cloudName}/raw/upload/${encodeURIComponent(candidate)}`;
      const tryAlt = await tryDownloadUrlWithRetries(altUrl, destPath, downloadRetries, timeout);
      if (tryAlt.ok) return { ok: true, url: tryAlt.url };
    }
  } catch (e) {
    // noop
  }

  return { ok: false, error: 'No se pudo restaurar desde Cloudinary (ni pública ni Admin API disponible)' };
}

module.exports = {
  restoreImagesFromCloudinary,
  tryDownloadUrlWithRetries,
  getCloudinaryResourceSecureUrl
};

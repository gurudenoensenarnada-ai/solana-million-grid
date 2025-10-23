// cloudinary-helpers.js
// Helpers para RESTORE de backups RAW en Cloudinary usando axios + Cloudinary Admin API.
// Uso: require y llamar a restoreImagesFromCloudinary(prefix, destPath, cloudName, apiKey, apiSecret)

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { pipeline } = require('stream');
const { promisify } = require('util');
const streamPipeline = promisify(pipeline);

async function tryDownloadToPath(url, destPath, timeout = 120000) {
  try {
    const res = await axios.get(url, { responseType: 'stream', timeout });
    // Ensure directory exists
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    await streamPipeline(res.data, fs.createWriteStream(destPath));
    return { ok: true };
  } catch (err) {
    // return status if available
    return { ok: false, error: err.message, status: err.response && err.response.status };
  }
}

/**
 * Consulta la Cloudinary Admin API para listar resources/raw con un prefijo.
 * Devuelve la URL (secure_url o url) del recurso más reciente encontrado, o null.
 */
async function findLatestRawUrl(cloudName, apiKey, apiSecret, prefix) {
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Faltan credenciales Cloudinary (CLOUD_NAME, API_KEY, API_SECRET)');
  }

  const apiUrl = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/resources/raw`;
  // Consultar por prefijo, traer hasta 50 resultados (ajusta si necesitas más)
  const params = {
    prefix: prefix || '',
    max_results: 50,
    direction: 'desc'
  };

  try {
    const resp = await axios.get(apiUrl, {
      params,
      auth: {
        username: apiKey,
        password: apiSecret
      },
      timeout: 15000
    });

    const resources = (resp.data && resp.data.resources) || [];
    if (!resources.length) return null;

    // Ordenar por created_at (desc) por si acaso
    resources.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const chosen = resources[0];
    // secure_url está disponible en Admin API response
    return chosen.secure_url || chosen.url || null;
  } catch (err) {
    // no usar throw para no romper el flujo, devolver null
    return null;
  }
}

/**
 * Restore flow:
 * 1) Intenta descargar la URL directa: https://res.cloudinary.com/{cloudName}/raw/upload/{prefix}
 * 2) Si falla, consulta la Admin API para buscar el último raw con el prefijo y descargar su secure_url
 *
 * Devuelve objeto: { ok: boolean, url?: string, error?: string }
 */
async function restoreImagesFromCloudinary(prefix, destPath, cloudName, apiKey, apiSecret) {
  if (!prefix) {
    return { ok: false, error: 'No se proporcionó prefijo/public_id para buscar en Cloudinary' };
  }
  if (!cloudName) {
    return { ok: false, error: 'No CLOUDINARY_CLOUD_NAME' };
  }

  // 1) Intento directo (podría fallar si falta versión u otra parte del path)
  const directUrl = `https://res.cloudinary.com/${cloudName}/raw/upload/${prefix}`;
  let res = await tryDownloadToPath(directUrl, destPath);
  if (res.ok) {
    return { ok: true, url: directUrl };
  }

  // 2) Intentar buscar el último recurso con el prefijo via Admin API
  try {
    const latestUrl = await findLatestRawUrl(cloudName, apiKey, apiSecret, prefix);
    if (!latestUrl) {
      return { ok: false, error: `No se encontró ningún recurso RAW con prefijo '${prefix}' en Cloudinary` };
    }
    const res2 = await tryDownloadToPath(latestUrl, destPath);
    if (res2.ok) {
      return { ok: true, url: latestUrl };
    } else {
      return { ok: false, error: `Error descargando desde ${latestUrl}: ${res2.error}` };
    }
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

module.exports = {
  tryDownloadToPath,
  findLatestRawUrl,
  restoreImagesFromCloudinary
};

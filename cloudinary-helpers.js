const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;

if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.warn('Aviso: variables CLOUDINARY_CLOUD_NAME/CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET no definidas.');
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// public id por defecto para el sales.json principal y para backups
const SALES_PUBLIC_ID = process.env.SALES_PUBLIC_ID || 'sales';
const SALES_BACKUP_PUBLIC_ID = process.env.SALES_BACKUP_PUBLIC_ID || 'solana_sales_backup';

/**
 * Subir un objeto JS como sales.json (resource_type raw)
 */
async function uploadSalesJSONObject(obj, publicId = SALES_PUBLIC_ID) {
  const tmpDir = process.env.TMP_DIR || '/tmp';
  const tmpPath = path.join(tmpDir, `${publicId}.json`);
  await fs.promises.mkdir(path.dirname(tmpPath), { recursive: true });
  await fs.promises.writeFile(tmpPath, JSON.stringify(obj, null, 2), 'utf8');

  const res = await cloudinary.uploader.upload(tmpPath, {
    resource_type: 'raw',
    public_id: publicId,
    overwrite: true,
  });

  try { await fs.promises.unlink(tmpPath); } catch (e) { /* noop */ }
  return res;
}

/**
 * Descargar y parsear JSON publicado en Cloudinary (resource_type raw)
 * Devuelve null si no existe.
 */
async function downloadSalesJSONObject(publicId = SALES_PUBLIC_ID) {
  try {
    const info = await cloudinary.api.resource(publicId, { resource_type: 'raw' });
    const url = info.secure_url || info.url;
    const r = await axios.get(url, { responseType: 'json', timeout: 10000 });
    return r.data;
  } catch (err) {
    // Cloudinary admin API devuelve errores con http_code 404 cuando no existe
    if (err && err.http_code === 404) return null;
    // axios error al pedir la URL: intentar parsear cuerpo si existe
    if (err && err.response && typeof err.response.data === 'string') {
      try { return JSON.parse(err.response.data); } catch (e) { /* fallthrough */ }
    }
    throw err;
  }
}

/**
 * Subir archivo local al Cloudinary como raw. publicId fijo para restauración.
 */
async function uploadFileToCloudinary(localPath, publicId) {
  if (!fs.existsSync(localPath)) {
    return { ok: false, error: 'file_not_found', localPath };
  }
  try {
    const res = await cloudinary.uploader.upload(localPath, {
      resource_type: 'raw',
      public_id: publicId,
      overwrite: true,
    });
    return { ok: true, res };
  } catch (err) {
    return { ok: false, error: err.message || err };
  }
}

/**
 * Descargar archivo raw desde Cloudinary a una ruta local (stream).
 * publicId: id en Cloudinary (raw). destPath: ruta local donde escribir.
 */
async function downloadFileFromCloudinary(publicId, destPath) {
  try {
    const info = await cloudinary.api.resource(publicId, { resource_type: 'raw' });
    const url = info.secure_url || info.url;
    const writer = fs.createWriteStream(destPath);
    const response = await axios.get(url, { responseType: 'stream', timeout: 10000 });
    await new Promise((resolve, reject) => {
      response.data.pipe(writer);
      let errored = false;
      writer.on('error', err => { errored = true; reject(err); });
      writer.on('close', () => { if (!errored) resolve(); });
    });
    return { ok: true, url };
  } catch (err) {
    if (err && err.http_code === 404) return { ok: false, error: 'not_found' };
    return { ok: false, error: err.message || err };
  }
}

module.exports = {
  uploadSalesJSONObject,
  downloadSalesJSONObject,
  uploadFileToCloudinary,
  downloadFileFromCloudinary,
  SALES_PUBLIC_ID,
  SALES_BACKUP_PUBLIC_ID
};

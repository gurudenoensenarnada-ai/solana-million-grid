const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;

// Note: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET are read from env at runtime
if (!process.env.CLOUDINARY_CLOUD_NAME) {
  console.warn('cloudinary-helpers: CLOUDINARY_CLOUD_NAME not set');
}

// Configure cloudinary if API keys are present
if (process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
}

const RAW_DELIVER_BASE = process.env.CLOUDINARY_CLOUD_NAME ? `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/raw/upload` : null;

const DEFAULT_SALES_PUBLIC_ID = process.env.SALES_PUBLIC_ID || 'sales';

async function uploadFileToCloudinary(localPath, publicId) {
  if (!fs.existsSync(localPath)) {
    return { ok: false, error: 'file_not_found', localPath };
  }
  try {
    const res = await cloudinary.uploader.upload(localPath, {
      resource_type: 'raw',
      public_id: publicId,
      overwrite: true
    });
    return { ok: true, res };
  } catch (err) {
    return { ok: false, error: err.message || err };
  }
}

async function downloadFileFromCloudinary(publicId, destPath) {
  // Try public delivery URL first
  if (RAW_DELIVER_BASE) {
    const url = `${RAW_DELIVER_BASE}/${encodeURIComponent(publicId)}`;
    try {
      const resp = await axios.get(url, { responseType: 'stream', timeout: 120000 });
      await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
      const writer = fs.createWriteStream(destPath);
      resp.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
      return { ok: true, url };
    } catch (err) {
      // continue to admin API fallback if possible
    }
  }

  // If admin API credentials are available, try admin API to get resource URL
  try {
    const info = await cloudinary.api.resource(publicId, { resource_type: 'raw' });
    const url = info.secure_url || info.url;
    const resp = await axios.get(url, { responseType: 'stream', timeout: 120000 });
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    const writer = fs.createWriteStream(destPath);
    resp.data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    return { ok: true, url };
  } catch (err) {
    return { ok: false, error: err.message || err };
  }
}

/**
 * restoreImagesFromCloudinary(publicId, destPath, cloudName, apiKey, apiSecret)
 * Attempts to fetch a raw resource from Cloudinary and save it to destPath.
 * Tries public delivery first, then Admin API if apiKey/apiSecret are provided.
 */
async function restoreImagesFromCloudinary(publicId, destPath, cloudName, apiKey, apiSecret) {
  // If cloudName is provided but differs from env, we can still try public URL
  const deliverBase = cloudName ? `https://res.cloudinary.com/${cloudName}/raw/upload` : RAW_DELIVER_BASE;
  if (deliverBase) {
    const url = `${deliverBase}/${encodeURIComponent(publicId)}`;
    try {
      const resp = await axios.get(url, { responseType: 'stream', timeout: 120000 });
      await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
      const writer = fs.createWriteStream(destPath);
      resp.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
      return { ok: true, url };
    } catch (err) {
      // continue to admin API fallback
    }
  }

  // Admin API fallback: configure temporary cloudinary client if apiKey/apiSecret provided
  if (apiKey && apiSecret && cloudName) {
    try {
      const temp = require('cloudinary').v2;
      temp.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
      const info = await temp.api.resource(publicId, { resource_type: 'raw' });
      const url = info.secure_url || info.url;
      const resp = await axios.get(url, { responseType: 'stream', timeout: 120000 });
      await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
      const writer = fs.createWriteStream(destPath);
      resp.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
      return { ok: true, url };
    } catch (err) {
      return { ok: false, error: err.message || err };
    }
  }

  return { ok: false, error: 'not_found_or_no_admin_credentials' };
}

/**
 * Upload a JS object as sales JSON to Cloudinary (raw)
 */
async function uploadSalesJSONObject(obj, publicId = DEFAULT_SALES_PUBLIC_ID) {
  const tmpDir = process.env.TMP_DIR || '/tmp';
  const tmpPath = path.join(tmpDir, `${publicId}.json`);
  await fs.promises.mkdir(path.dirname(tmpPath), { recursive: true });
  await fs.promises.writeFile(tmpPath, JSON.stringify(obj, null, 2), 'utf8');
  try {
    const res = await cloudinary.uploader.upload(tmpPath, { resource_type: 'raw', public_id: publicId, overwrite: true });
    try { await fs.promises.unlink(tmpPath); } catch(e){}
    return { ok: true, res };
  } catch (err) {
    return { ok: false, error: err.message || err };
  }
}

async function downloadSalesJSONObject(publicId = DEFAULT_SALES_PUBLIC_ID) {
  // Try admin API first if configured
  try {
    const info = await cloudinary.api.resource(publicId, { resource_type: 'raw' });
    const url = info.secure_url || info.url;
    const r = await axios.get(url, { responseType: 'json', timeout: 10000 });
    return { ok: true, data: r.data };
  } catch (err) {
    // try public delivery
    if (RAW_DELIVER_BASE) {
      const url = `${RAW_DELIVER_BASE}/${encodeURIComponent(publicId)}`;
      try {
        const r = await axios.get(url, { responseType: 'json', timeout: 10000 });
        return { ok: true, data: r.data };
      } catch (e) {
        return { ok: false, error: e.message || e };
      }
    }
    return { ok: false, error: err.message || err };
  }
}

module.exports = {
  uploadFileToCloudinary,
  downloadFileFromCloudinary,
  restoreImagesFromCloudinary,
  uploadSalesJSONObject,
  downloadSalesJSONObject
};

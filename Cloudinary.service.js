/**
 * Cloudinary Service
 * Handles image and JSON backup operations
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_RETRIES = 3;
const BACKOFF_BASE_MS = 800;

class CloudinaryService {
  constructor() {
    this.enabled = config.cloudinary.enabled;
    this.cloudName = config.cloudinary.cloudName;
    this.apiKey = config.cloudinary.apiKey;
    this.apiSecret = config.cloudinary.apiSecret;
    this.uploadPreset = config.cloudinary.uploadPreset;
  }

  /**
   * Ensure directory exists
   * @param {string} filePath - File path
   */
  ensureDirExists(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Download file atomically (tmp -> rename)
   * @param {string} url - URL to download
   * @param {string} destPath - Destination path
   * @param {number} timeout - Timeout in ms
   * @returns {Promise<Object>}
   */
  async downloadToFileAtomic(url, destPath, timeout = DEFAULT_TIMEOUT_MS) {
    this.ensureDirExists(destPath);
    const tmpPath = `${destPath}.tmp`;

    // Clean up any existing tmp file
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch (e) {
      // ignore
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
          try { 
            if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); 
          } catch (e) { /* ignore */ }
          reject(new Error(`Error renaming tmp file: ${err.message || err}`));
        }
      });
      
      writer.on('error', (err) => {
        try { 
          if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); 
        } catch (e) { /* ignore */ }
        if (!finished) reject(err);
      });
    });
  }

  /**
   * Download with retries and exponential backoff
   * @param {string} url - URL to download
   * @param {string} destPath - Destination path
   * @param {number} retries - Number of retries
   * @param {number} timeout - Timeout in ms
   * @returns {Promise<Object>}
   */
  async downloadWithRetries(url, destPath, retries = DEFAULT_RETRIES, timeout = DEFAULT_TIMEOUT_MS) {
    let lastErr = null;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await this.downloadToFileAtomic(url, destPath, timeout);
        return { ok: true, url: res.url };
      } catch (err) {
        lastErr = err;
        const waitMs = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
        console.warn(`Download attempt ${attempt} failed: ${err.message}. Retrying in ${waitMs}ms`);
        await new Promise(r => setTimeout(r, waitMs));
      }
    }
    
    return { 
      ok: false, 
      error: lastErr ? (lastErr.message || String(lastErr)) : 'unknown' 
    };
  }

  /**
   * Get resource secure URL from Admin API
   * @param {string} publicId - Public ID
   * @param {number} retries - Number of retries
   * @returns {Promise<string>}
   */
  async getResourceSecureUrl(publicId, retries = DEFAULT_RETRIES) {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error('No API credentials provided');
    }

    const adminUrl = `https://api.cloudinary.com/v1_1/${this.cloudName}/resources/raw/${encodeURIComponent(publicId)}`;

    let lastErr = null;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const resp = await axios.get(adminUrl, {
          auth: {
            username: this.apiKey,
            password: this.apiSecret
          },
          timeout: DEFAULT_TIMEOUT_MS
        });
        
        if (resp && resp.data && resp.data.secure_url) {
          return resp.data.secure_url;
        } else {
          throw new Error('Admin API did not return secure_url');
        }
      } catch (err) {
        lastErr = err;
        const waitMs = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
        console.warn(`Admin API attempt ${attempt} failed: ${err.message}. Retrying in ${waitMs}ms`);
        await new Promise(r => setTimeout(r, waitMs));
      }
    }
    
    throw lastErr || new Error('Failed to fetch resource from Admin API');
  }

  /**
   * Restore file from Cloudinary
   * @param {string} publicId - Public ID
   * @param {string} destPath - Destination path
   * @returns {Promise<Object>}
   */
  async restoreFile(publicId, destPath) {
    if (!this.enabled) {
      return { ok: false, error: 'Cloudinary not configured' };
    }

    // Try public URL first
    const publicUrl = `https://res.cloudinary.com/${this.cloudName}/raw/upload/${encodeURIComponent(publicId)}`;
    
    try {
      const result = await this.downloadWithRetries(publicUrl, destPath);
      if (result.ok) return result;
      console.warn('Public download failed:', result.error);
    } catch (e) {
      console.warn('Public download error:', e.message);
    }

    // Try Admin API if credentials available
    if (this.apiKey && this.apiSecret) {
      try {
        const secureUrl = await this.getResourceSecureUrl(publicId);
        if (secureUrl) {
          const result = await this.downloadWithRetries(secureUrl, destPath);
          if (result.ok) return result;
          return { ok: false, error: `Could not download secure_url: ${result.error}` };
        }
        return { ok: false, error: 'Admin API did not return secure_url' };
      } catch (err) {
        return { ok: false, error: `Admin API error: ${err.message || err}` };
      }
    }

    return { ok: false, error: 'Could not restore from Cloudinary' };
  }

  /**
   * Upload JSON object to Cloudinary
   * @param {Object} data - Data to upload
   * @param {string} publicId - Public ID for the file
   * @returns {Promise<Object>}
   */
  async uploadJSONObject(data, publicId) {
    if (!this.enabled) {
      return { ok: false, error: 'Cloudinary not configured' };
    }

    try {
      // Convert object to JSON string
      const jsonString = JSON.stringify(data, null, 2);
      const buffer = Buffer.from(jsonString, 'utf8');
      const base64Data = buffer.toString('base64');

      const uploadUrl = `https://api.cloudinary.com/v1_1/${this.cloudName}/raw/upload`;
      
      const formData = new URLSearchParams();
      formData.append('file', `data:application/json;base64,${base64Data}`);
      formData.append('public_id', publicId);
      formData.append('api_key', this.apiKey);
      
      // Generate signature
      const timestamp = Math.floor(Date.now() / 1000);
      const crypto = require('crypto');
      const stringToSign = `public_id=${publicId}&timestamp=${timestamp}${this.apiSecret}`;
      const signature = crypto.createHash('sha1').update(stringToSign).digest('hex');
      
      formData.append('timestamp', timestamp.toString());
      formData.append('signature', signature);

      const response = await axios.post(uploadUrl, formData, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: DEFAULT_TIMEOUT_MS
      });

      if (response.data && response.data.secure_url) {
        console.log('✅ Uploaded to Cloudinary:', publicId);
        return { 
          ok: true, 
          url: response.data.secure_url,
          publicId: response.data.public_id
        };
      }

      return { ok: false, error: 'Upload failed - no secure_url returned' };
    } catch (error) {
      console.error('❌ Cloudinary upload error:', error.message);
      return { ok: false, error: error.message };
    }
  }

  /**
   * Download JSON object from Cloudinary
   * @param {string} publicId - Public ID
   * @returns {Promise<Object>}
   */
  async downloadJSONObject(publicId) {
    if (!this.enabled) {
      return { ok: false, error: 'Cloudinary not configured' };
    }

    try {
      const publicUrl = `https://res.cloudinary.com/${this.cloudName}/raw/upload/${encodeURIComponent(publicId)}`;
      
      const response = await axios.get(publicUrl, {
        timeout: DEFAULT_TIMEOUT_MS,
        responseType: 'json'
      });

      if (response.data) {
        console.log('✅ Downloaded JSON from Cloudinary:', publicId);
        return { ok: true, data: response.data };
      }

      return { ok: false, error: 'No data returned' };
    } catch (error) {
      console.error('❌ Cloudinary download error:', error.message);
      return { ok: false, error: error.message };
    }
  }

  /**
   * Upload image file
   * @param {string} filePath - Path to image file
   * @param {string} publicId - Public ID for the image
   * @returns {Promise<Object>}
   */
  async uploadImage(filePath, publicId = null) {
    if (!this.enabled) {
      return { ok: false, error: 'Cloudinary not configured' };
    }

    try {
      const fileBuffer = fs.readFileSync(filePath);
      const base64Data = fileBuffer.toString('base64');
      const ext = path.extname(filePath).toLowerCase();
      
      let mimeType = 'image/jpeg';
      if (ext === '.png') mimeType = 'image/png';
      else if (ext === '.gif') mimeType = 'image/gif';
      else if (ext === '.webp') mimeType = 'image/webp';

      const uploadUrl = `https://api.cloudinary.com/v1_1/${this.cloudName}/image/upload`;
      
      const formData = new URLSearchParams();
      formData.append('file', `data:${mimeType};base64,${base64Data}`);
      if (publicId) formData.append('public_id', publicId);
      formData.append('upload_preset', this.uploadPreset);

      const response = await axios.post(uploadUrl, formData, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: DEFAULT_TIMEOUT_MS
      });

      if (response.data && response.data.secure_url) {
        console.log('✅ Image uploaded to Cloudinary');
        return {
          ok: true,
          url: response.data.secure_url,
          publicId: response.data.public_id
        };
      }

      return { ok: false, error: 'Upload failed' };
    } catch (error) {
      console.error('❌ Image upload error:', error.message);
      return { ok: false, error: error.message };
    }
  }
}

// Export singleton instance
module.exports = new CloudinaryService();

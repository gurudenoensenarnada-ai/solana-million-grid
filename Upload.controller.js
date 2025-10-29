/**
 * Upload Controller
 * Handles file uploads
 */

const fs = require('fs');
const path = require('path');
const cloudinaryService = require('../services/cloudinary.service');
const config = require('../config');

const UPLOADS_DIR = path.resolve(__dirname, '../../../uploads');

/**
 * Ensure uploads directory exists
 */
function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

/**
 * Validate image file
 * @param {Object} file - Multer file object
 */
function validateImage(file) {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const maxSize = 5 * 1024 * 1024; // 5MB

  if (!file) {
    return { valid: false, error: 'No file provided' };
  }

  if (!allowedTypes.includes(file.mimetype)) {
    return {
      valid: false,
      error: 'Invalid file type. Allowed: JPEG, PNG, GIF, WEBP'
    };
  }

  if (file.size > maxSize) {
    return {
      valid: false,
      error: 'File too large. Maximum size: 5MB'
    };
  }

  return { valid: true };
}

/**
 * Process uploaded image
 * @param {Object} file - Multer file object
 */
async function processUpload(file) {
  ensureUploadsDir();

  // Validate file
  const validation = validateImage(file);
  if (!validation.valid) {
    return {
      ok: false,
      error: validation.error
    };
  }

  const filename = file.filename;
  const localPath = path.join(UPLOADS_DIR, filename);

  // If Cloudinary is enabled, upload there
  if (cloudinaryService.enabled) {
    try {
      const publicId = `solana-grid/${Date.now()}_${path.parse(filename).name}`;
      const result = await cloudinaryService.uploadImage(localPath, publicId);

      if (result.ok) {
        console.log('✅ Image uploaded to Cloudinary:', result.url);

        // Delete local file if configured
        if (config.storage.removeLocalAfterUpload) {
          try {
            fs.unlinkSync(localPath);
            console.log('🗑️ Local file deleted');
          } catch (e) {
            console.warn('Could not delete local file:', e.message);
          }
        }

        return {
          ok: true,
          url: result.url,
          publicId: result.publicId,
          filename,
          cloudinary: true
        };
      } else {
        console.warn('⚠️ Cloudinary upload failed:', result.error);
        // Fallback to local storage
      }
    } catch (err) {
      console.error('❌ Cloudinary upload error:', err.message);
      // Fallback to local storage
    }
  }

  // Use local storage
  const localUrl = `/uploads/${filename}`;
  console.log('✅ Image saved locally:', localUrl);

  return {
    ok: true,
    url: localUrl,
    filename,
    cloudinary: false
  };
}

/**
 * Delete uploaded file
 * @param {string} filename - Filename to delete
 */
async function deleteUpload(filename) {
  try {
    const filePath = path.join(UPLOADS_DIR, filename);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log('🗑️ File deleted:', filename);
      return { ok: true };
    }

    return { ok: false, error: 'File not found' };
  } catch (err) {
    console.error('❌ Error deleting file:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Get list of uploaded files
 */
function listUploads() {
  ensureUploadsDir();
  
  try {
    const files = fs.readdirSync(UPLOADS_DIR)
      .filter(file => !file.startsWith('.'))
      .map(file => {
        const filePath = path.join(UPLOADS_DIR, file);
        const stats = fs.statSync(filePath);
        
        return {
          filename: file,
          size: stats.size,
          created: stats.birthtime,
          url: `/uploads/${file}`
        };
      });

    return {
      ok: true,
      files,
      count: files.length
    };
  } catch (err) {
    console.error('❌ Error listing uploads:', err.message);
    return {
      ok: false,
      error: err.message
    };
  }
}

module.exports = {
  processUpload,
  deleteUpload,
  listUploads,
  validateImage
};

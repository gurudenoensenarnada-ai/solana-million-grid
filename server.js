// En server.js, encuentra la sección de upload-logo (alrededor de línea 140)
// REEMPLAZA esto:

app.post('/api/upload-logo', diskUpload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'No se recibió ningún archivo' });
    }
    
    const originalName = req.file.originalname;
    const tmpPath = req.file.path;
    
    const timestamp = Date.now();
    const ext = path.extname(originalName);
    const safeName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const finalName = `${timestamp}_${safeName}`;
    const targetPath = path.join(UPLOADS_DIR, finalName);
    
    fs.renameSync(tmpPath, targetPath);
    
    // 🔧 FIX: Usar URL completa en producción
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const url = `${baseUrl}/uploads/${encodeURIComponent(finalName)}`;
    
    console.log(`📤 Logo subido: ${finalName}`);
    
    return res.json({ 
      ok: true, 
      url, 
      name: finalName 
    });
  } catch (err) {
    console.error('❌ Error subiendo logo:', err);
    return res.status(500).json({ 
      ok: false, 
      error: err.message || 'Error al subir el archivo' 
    });
  }
});

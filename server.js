/**
 * server.js - PRODUCTION VERSION (Local Storage Only)
 * 
 * Express server para Solana Million Grid
 * - Subida de logos LOCAL (sin IPFS)
 * - Verificación de transacciones on-chain
 * - Rate limiting y seguridad
 * - Backups automáticos
 * - Logs mejorados
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const solanaWeb3 = require('@solana/web3.js');
const bs58 = require('bs58');
const cors = require('cors');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cors());

// ============================================
// CONFIGURACIÓN (usar .env en producción)
// ============================================
const DEFAULT_MERCHANT = process.env.MERCHANT_WALLET || '3d7w4r4irLaKVYd4dLjpoiehJVawbbXWFWb1bCk9nGCo';
const CLUSTER = process.env.CLUSTER || 'devnet';
// Usar RPC_URL desde env si está definido; si no, usar clusterApiUrl(CLUSTER)
const RPC_URL = process.env.RPC_URL || solanaWeb3.clusterApiUrl(CLUSTER);
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'production';
const BASE_URL = process.env.BASE_URL || ''; // Para URLs completas

const SALES_FILE = path.resolve(__dirname, 'sales.json');
const UPLOADS_DIR = path.resolve(__dirname, 'uploads');
const BACKUPS_DIR = path.resolve(__dirname, 'backups');
const LAMPORTS_PER_SOL = solanaWeb3.LAMPORTS_PER_SOL || 1000000000;
const MEMO_PROGRAM_ID = new solanaWeb3.PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

// Crear directorios necesarios
[UPLOADS_DIR, BACKUPS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Crear sales.json si no existe
if (!fs.existsSync(SALES_FILE)) {
  fs.writeFileSync(SALES_FILE, JSON.stringify({ sales: [] }, null, 2));
}

const connection = new solanaWeb3.Connection(RPC_URL, 'confirmed');

console.log('🚀 Configuración:');
console.log(`   Cluster: ${CLUSTER}`);
console.log(`   RPC: ${RPC_URL}`);
console.log(`   Merchant: ${DEFAULT_MERCHANT}`);
console.log(`   Storage: Local (uploads/)`);
console.log(`   Entorno: ${NODE_ENV}`);

// ============================================
// (El resto del archivo se mantiene igual que tu versión,
//  incluyendo rate-limiting, upload handler, verify-purchase, etc.)
//  (No cambié la lógica de verify-purchase salvo usar RPC_URL dinámico arriba.)
// ============================================

/* ...resto del servidor (sin cambios de contenido respecto a lo que ya tenías)... */

module.exports = app;
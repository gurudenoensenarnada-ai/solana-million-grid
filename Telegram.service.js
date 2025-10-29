/**
 * Telegram Service
 * Handles Telegram bot notifications
 */

const config = require('../config');

class TelegramService {
  constructor() {
    this.enabled = config.telegram.enabled;
    this.botToken = config.telegram.botToken;
    this.chatId = config.telegram.chatId;
    this.baseUrl = this.botToken 
      ? `https://api.telegram.org/bot${this.botToken}`
      : null;
  }

  /**
   * Escape special characters for Telegram MarkdownV2
   * @param {string} text - Text to escape
   * @returns {string}
   */
  escapeMarkdownV2(text) {
    return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
  }

  /**
   * Send purchase notification
   * @param {Object} saleData - Sale information
   * @returns {Promise<Object>}
   */
  async sendPurchaseNotification(saleData) {
    if (!this.enabled) {
      console.log('📱 Telegram notifications disabled');
      return { ok: true, skipped: true };
    }

    try {
      console.log('📱 Preparing Telegram notification...');

      const meta = saleData.metadata;
      const sel = meta.selection;
      
      // Determine zone
      let zone = '🥉 BRONZE';
      let zoneEmoji = '🥉';
      if (sel.minBlockY <= 24) {
        zone = '🥇 GOLD';
        zoneEmoji = '🥇';
      } else if (sel.minBlockY >= 25 && sel.minBlockY <= 59) {
        zone = '🥈 SILVER';
        zoneEmoji = '🥈';
      }
      
      const blocksTotal = sel.blocksX * sel.blocksY;
      const amount = saleData.amount.toFixed(4);
      const isOwnerWallet = saleData.isOwner || false;
      
      // Escape all data for MarkdownV2
      const safeName = this.escapeMarkdownV2(meta.name);
      const safeUrl = this.escapeMarkdownV2(meta.url);
      const safeAmount = this.escapeMarkdownV2(amount);
      const safeBlocksTotal = this.escapeMarkdownV2(blocksTotal);
      const safeBlocksX = this.escapeMarkdownV2(sel.blocksX);
      const safeBlocksY = this.escapeMarkdownV2(sel.blocksY);
      const safeRow = this.escapeMarkdownV2(sel.minBlockY + 1);
      const safeCol = this.escapeMarkdownV2(sel.minBlockX + 1);
      const safeBuyerStart = this.escapeMarkdownV2(saleData.buyer.substring(0, 8));
      const safeBuyerEnd = this.escapeMarkdownV2(saleData.buyer.substring(saleData.buyer.length - 8));
      const safeDate = this.escapeMarkdownV2(
        new Date(saleData.timestamp).toLocaleString('en-US', { 
          timeZone: 'Europe/Madrid' 
        })
      );
      
      // Build message
      let message;
      if (isOwnerWallet) {
        message = `🎉 *NEW PURCHASE ON SOLANA MILLION GRID\\!*

${zoneEmoji} *Zone:* ${zone}
⭐ *OWNER PURCHASE \\- SPECIAL PRICE*

📊 *Purchase details:*
• Project: *${safeName}*
• URL: ${safeUrl}
• Blocks: *${safeBlocksTotal}* \\(${safeBlocksX}×${safeBlocksY}\\)
• Position: Row ${safeRow}, Column ${safeCol}

💰 *Payment:*
• Amount: *${safeAmount} SOL*
• Price/block: *0\\.0001 SOL* 🌟
• Buyer: \`${safeBuyerStart}\\.\\.\\.${safeBuyerEnd}\`

🔗 *Transaction:*
[View on Solscan](https://solscan\\.io/tx/${this.escapeMarkdownV2(saleData.signature)})

⏰ ${safeDate}`;
      } else {
        message = `🎉 *NEW PURCHASE ON SOLANA MILLION GRID\\!*

${zoneEmoji} *Zone:* ${zone}

📊 *Purchase details:*
• Project: *${safeName}*
• URL: ${safeUrl}
• Blocks: *${safeBlocksTotal}* \\(${safeBlocksX}×${safeBlocksY}\\)
• Position: Row ${safeRow}, Column ${safeCol}

💰 *Payment:*
• Amount: *${safeAmount} SOL*
• Buyer: \`${safeBuyerStart}\\.\\.\\.${safeBuyerEnd}\`

🔗 *Transaction:*
[View on Solscan](https://solscan\\.io/tx/${this.escapeMarkdownV2(saleData.signature)})

⏰ ${safeDate}`;
      }

      // Build logo URL
      let logoUrl = meta.logo;
      if (!logoUrl.startsWith('http')) {
        const host = config.isProduction 
          ? 'https://www.solanamillondollar.com' 
          : `http://localhost:${config.port}`;
        logoUrl = `${host}${meta.logo}`;
      }

      console.log('📷 Logo URL:', logoUrl);

      // Send photo with caption
      const formData = new URLSearchParams();
      formData.append('chat_id', this.chatId);
      formData.append('photo', logoUrl);
      formData.append('caption', message);
      formData.append('parse_mode', 'MarkdownV2');

      const response = await fetch(`${this.baseUrl}/sendPhoto`, {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const result = await response.json();
      
      if (result.ok) {
        console.log('✅ Telegram notification sent successfully!');
        return { ok: true, sent: true };
      } else {
        console.error('❌ Telegram error:', result.description);
        return { ok: false, error: result.description };
      }
    } catch (error) {
      console.error('❌ Exception in Telegram service:', error.message);
      return { ok: false, error: error.message };
    }
  }

  /**
   * Send simple text message
   * @param {string} text - Message text
   * @returns {Promise<Object>}
   */
  async sendMessage(text) {
    if (!this.enabled) {
      return { ok: true, skipped: true };
    }

    try {
      const response = await fetch(`${this.baseUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: text,
        }),
      });

      const result = await response.json();
      return result;
    } catch (error) {
      console.error('Error sending Telegram message:', error);
      return { ok: false, error: error.message };
    }
  }

  /**
   * Test bot connection
   * @returns {Promise<Object>}
   */
  async testConnection() {
    if (!this.enabled) {
      return { ok: false, error: 'Telegram not configured' };
    }

    try {
      const response = await fetch(`${this.baseUrl}/getMe`);
      const result = await response.json();
      
      if (result.ok) {
        console.log('✅ Telegram bot connected:', result.result.username);
      }
      
      return result;
    } catch (error) {
      console.error('Error testing Telegram connection:', error);
      return { ok: false, error: error.message };
    }
  }
}

// Export singleton instance
module.exports = new TelegramService();

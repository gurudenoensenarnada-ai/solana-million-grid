// ===== FUNCIONES DE TELEGRAM (ENGLISH VERSION) =====
function escapeMarkdownV2(text) {
  // Escape ALL special characters for MarkdownV2
  return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

async function sendTelegramNotification(saleData) {
  console.log('\n🔍 === DEBUG TELEGRAM ===');
  console.log('TELEGRAM_BOT_TOKEN exists?', !!TELEGRAM_BOT_TOKEN);
  console.log('TELEGRAM_CHAT_ID exists?', !!TELEGRAM_CHAT_ID);
  
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('⚠️ Telegram NOT configured');
    return { ok: true, skipped: true };
  }

  try {
    console.log('📱 Preparing notification...');
    
    const meta = saleData.metadata;
    const sel = meta.selection;
    
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
    const isOwnerWallet = saleData.buyer === OWNER_WALLET;
    
    // 🔧 Escape ALL data
    const safeName = escapeMarkdownV2(meta.name);
    const safeUrl = escapeMarkdownV2(meta.url);
    const safeAmount = escapeMarkdownV2(amount);
    const safeBlocksTotal = escapeMarkdownV2(blocksTotal);
    const safeBlocksX = escapeMarkdownV2(sel.blocksX);
    const safeBlocksY = escapeMarkdownV2(sel.blocksY);
    const safeRow = escapeMarkdownV2(sel.minBlockY + 1);
    const safeCol = escapeMarkdownV2(sel.minBlockX + 1);
    const safeBuyerStart = escapeMarkdownV2(saleData.buyer.substring(0, 8));
    const safeBuyerEnd = escapeMarkdownV2(saleData.buyer.substring(saleData.buyer.length - 8));
    const safeDate = escapeMarkdownV2(new Date(saleData.timestamp).toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
    
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
[View on Solscan](https://solscan\\.io/tx/${saleData.signature})

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
[View on Solscan](https://solscan\\.io/tx/${saleData.signature})

⏰ ${safeDate}`;
    }

    console.log('📝 Message prepared (length:', message.length, 'chars)');

    // Build logo URL
    let logoUrl = meta.logo;
    if (!logoUrl.startsWith('http')) {
      const host = process.env.RENDER ? 'https://www.solanamillondollar.com' : 'http://localhost:3000';
      logoUrl = `${host}${meta.logo}`;
    }

    console.log('📷 Logo URL:', logoUrl);

    const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
    
    const formData = new URLSearchParams();
    formData.append('chat_id', TELEGRAM_CHAT_ID);
    formData.append('photo', logoUrl);
    formData.append('caption', message);
    formData.append('parse_mode', 'MarkdownV2');

    console.log('🚀 Sending request to Telegram API...');
    console.log('   Chat ID:', TELEGRAM_CHAT_ID);
    
    const response = await fetch(telegramApiUrl, {
      method: 'POST',
      body: formData,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    console.log('📥 Response received - Status:', response.status);

    const result = await response.json();
    console.log('📦 Result OK:', result.ok);
    
    if (result.ok) {
      console.log('✅ TELEGRAM SENT SUCCESSFULLY!');
      if (isOwnerWallet) {
        console.log('⭐ Was OWNER purchase');
      }
      return { ok: true, sent: true };
    } else {
      console.error('❌ ERROR IN TELEGRAM RESPONSE');
      console.error('   error_code:', result.error_code);
      console.error('   description:', result.description);
      return { ok: false, error: result.description };
    }
  } catch (err) {
    console.error('❌ EXCEPTION IN sendTelegramNotification');
    console.error('   Error:', err.message);
    return { ok: false, error: err.message };
  } finally {
    console.log('=== END DEBUG TELEGRAM ===\n');
  }
}

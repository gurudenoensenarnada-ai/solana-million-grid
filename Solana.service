/**
 * Solana Service
 * Handles all Solana blockchain interactions
 */

const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const config = require('../config');

class SolanaService {
  constructor() {
    this.connection = new Connection(
      config.solana.rpcUrl,
      'confirmed'
    );
    this.merchantWallet = new PublicKey(config.solana.merchantWallet);
    this.ownerWallet = config.solana.ownerWallet 
      ? new PublicKey(config.solana.ownerWallet) 
      : this.merchantWallet;
  }

  /**
   * Verify a transaction was successfully completed
   * @param {string} signature - Transaction signature
   * @returns {Promise<Object>} Transaction details or error
   */
  async verifyTransaction(signature) {
    try {
      console.log(`🔍 Verifying transaction: ${signature}`);

      // Get transaction details
      const transaction = await this.connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0
      });

      if (!transaction) {
        return {
          ok: false,
          error: 'Transaction not found',
        };
      }

      // Check if transaction was successful
      if (transaction.meta.err) {
        return {
          ok: false,
          error: 'Transaction failed',
          details: transaction.meta.err,
        };
      }

      // Verify it was sent to merchant wallet
      const accountKeys = transaction.transaction.message.getAccountKeys();
      const merchantIndex = accountKeys.keySegments().findIndex(
        key => key && key.equals(this.merchantWallet)
      );

      if (merchantIndex === -1) {
        return {
          ok: false,
          error: 'Transaction not sent to merchant wallet',
        };
      }

      // Calculate transferred amount
      const preBalance = transaction.meta.preBalances[merchantIndex];
      const postBalance = transaction.meta.postBalances[merchantIndex];
      const amountLamports = postBalance - preBalance;
      const amountSOL = amountLamports / LAMPORTS_PER_SOL;

      console.log(`✅ Transaction verified: ${amountSOL} SOL`);

      return {
        ok: true,
        signature,
        amount: amountSOL,
        timestamp: transaction.blockTime,
        slot: transaction.slot,
      };
    } catch (error) {
      console.error('❌ Error verifying transaction:', error);
      return {
        ok: false,
        error: error.message || 'Unknown error',
      };
    }
  }

  /**
   * Get wallet balance
   * @param {string} walletAddress - Wallet address
   * @returns {Promise<number>} Balance in SOL
   */
  async getBalance(walletAddress) {
    try {
      const pubkey = new PublicKey(walletAddress);
      const balance = await this.connection.getBalance(pubkey);
      return balance / LAMPORTS_PER_SOL;
    } catch (error) {
      console.error('Error getting balance:', error);
      return 0;
    }
  }

  /**
   * Check if address is valid Solana address
   * @param {string} address - Address to validate
   * @returns {boolean}
   */
  isValidAddress(address) {
    try {
      new PublicKey(address);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if wallet is the owner wallet
   * @param {string} walletAddress - Wallet address to check
   * @returns {boolean}
   */
  isOwnerWallet(walletAddress) {
    try {
      const pubkey = new PublicKey(walletAddress);
      return pubkey.equals(this.ownerWallet);
    } catch {
      return false;
    }
  }

  /**
   * Get recent transactions for merchant wallet
   * @param {number} limit - Number of transactions to fetch
   * @returns {Promise<Array>}
   */
  async getRecentTransactions(limit = 10) {
    try {
      const signatures = await this.connection.getSignaturesForAddress(
        this.merchantWallet,
        { limit }
      );

      const transactions = [];
      for (const sig of signatures) {
        const tx = await this.connection.getTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0
        });
        if (tx) {
          transactions.push({
            signature: sig.signature,
            timestamp: tx.blockTime,
            slot: tx.slot,
            success: !tx.meta.err,
          });
        }
      }

      return transactions;
    } catch (error) {
      console.error('Error fetching recent transactions:', error);
      return [];
    }
  }

  /**
   * Get current cluster info
   * @returns {Promise<Object>}
   */
  async getClusterInfo() {
    try {
      const version = await this.connection.getVersion();
      const slot = await this.connection.getSlot();
      
      return {
        ok: true,
        cluster: config.solana.cluster,
        version: version['solana-core'],
        slot,
      };
    } catch (error) {
      return {
        ok: false,
        error: error.message,
      };
    }
  }
}

// Export singleton instance
module.exports = new SolanaService();

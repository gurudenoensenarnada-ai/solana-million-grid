/**
 * 🎁 REFERRAL DASHBOARD - Complete Implementation
 * Integrates with existing ReferralSystem.js backend
 * 
 * Features:
 * - Real-time stats
 * - Tier system (Bronze/Silver/Gold)
 * - Leaderboard
 * - One-click link copy
 * - Referral history
 * - Visual progress tracking
 */

// ==========================================
// TIER SYSTEM CONFIGURATION
// ==========================================

const REFERRAL_TIERS = {
  BRONZE: {
    minReferrals: 0,
    commission: 0.08,  // 8% - Cambia aquí
    nextThreshold: 50  // 50 referrals para siguiente tier
  },
  SILVER: {
    minReferrals: 50,
    commission: 0.12,  // 12% - Cambia aquí
    nextThreshold: 150
  },
  GOLD: {
    minReferrals: 150,
    commission: 0.15,  // 15% - Cambia aquí
    nextThreshold: null
  }
};

// ==========================================
// REFERRAL DASHBOARD CLASS
// ==========================================

class ReferralDashboard {
  constructor() {
    this.wallet = null;
    this.referralData = null;
    this.leaderboardData = null;
    this.isVisible = false;
    this.initializeEventListeners();
  }

  // Initialize event listeners
  initializeEventListeners() {
    // Close button
    const closeBtn = document.getElementById('closeReferralDashboard');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.hide());
    }

    // Copy link button
    const copyBtn = document.getElementById('copyReferralLink');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => this.copyReferralLink());
    }

    // Refresh button
    const refreshBtn = document.getElementById('refreshReferralStats');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.refresh());
    }
  }

  // Show dashboard
  async show(wallet) {
    this.wallet = wallet;
    const dashboard = document.getElementById('referralDashboard');
    
    if (!dashboard) {
      console.error('❌ Referral dashboard element not found');
      return;
    }

    dashboard.style.display = 'flex';
    this.isVisible = true;

    // Load data
    await this.loadReferralData();
    await this.loadLeaderboard();
    this.render();
  }

  // Hide dashboard
  hide() {
    const dashboard = document.getElementById('referralDashboard');
    if (dashboard) {
      dashboard.style.display = 'none';
    }
    this.isVisible = false;
  }

  // Load referral data from API
  async loadReferralData() {
    try {
      const response = await fetch(`/api/referrals/stats/${this.wallet}`);
      const data = await response.json();

      if (data.ok) {
        this.referralData = data;
      } else {
        // Create new referral code if doesn't exist
        await this.createReferralCode();
      }
    } catch (error) {
      console.error('Error loading referral data:', error);
      await this.createReferralCode();
    }
  }

  // Create new referral code
  async createReferralCode() {
    try {
      const response = await fetch('/api/referrals/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          wallet: this.wallet,
          name: 'Anonymous User'
        })
      });

      const data = await response.json();
      
      if (data.ok) {
        this.referralData = data;
        console.log('✅ Created referral code:', data.code);
      }
    } catch (error) {
      console.error('Error creating referral code:', error);
    }
  }

  // Load leaderboard
  async loadLeaderboard() {
    try {
      const response = await fetch('/api/referrals/leaderboard');
      const data = await response.json();

      if (data.ok) {
        this.leaderboardData = data;
      }
    } catch (error) {
      console.error('Error loading leaderboard:', error);
    }
  }

  // Refresh all data
  async refresh() {
    const refreshBtn = document.getElementById('refreshReferralStats');
    if (refreshBtn) {
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = '🔄 Refreshing...';
    }

    await this.loadReferralData();
    await this.loadLeaderboard();
    this.render();

    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = '🔄 Refresh';
    }
  }

  // Get current tier
  getCurrentTier() {
    const referrals = this.referralData?.totalReferrals || 0;

    if (referrals >= REFERRAL_TIERS.GOLD.minReferrals) {
      return REFERRAL_TIERS.GOLD;
    } else if (referrals >= REFERRAL_TIERS.SILVER.minReferrals) {
      return REFERRAL_TIERS.SILVER;
    } else {
      return REFERRAL_TIERS.BRONZE;
    }
  }

  // Calculate progress to next tier
  getTierProgress() {
    const referrals = this.referralData?.totalReferrals || 0;
    const tier = this.getCurrentTier();

    if (!tier.nextTier) {
      return { percentage: 100, remaining: 0 };
    }

    const progress = referrals - tier.minReferrals;
    const total = tier.nextThreshold - tier.minReferrals;
    const percentage = Math.min((progress / total) * 100, 100);
    const remaining = Math.max(tier.nextThreshold - referrals, 0);

    return { percentage, remaining };
  }

  // Copy referral link
  async copyReferralLink() {
    const link = this.referralData?.url;
    
    if (!link) {
      alert('❌ No referral link available');
      return;
    }

    try {
      await navigator.clipboard.writeText(link);
      
      // Visual feedback
      const copyBtn = document.getElementById('copyReferralLink');
      const originalHTML = copyBtn.innerHTML;
      copyBtn.innerHTML = '✅ Copied!';
      copyBtn.style.background = '#10b981';
      
      setTimeout(() => {
        copyBtn.innerHTML = originalHTML;
        copyBtn.style.background = '';
      }, 2000);

      console.log('✅ Referral link copied to clipboard');
    } catch (error) {
      console.error('Error copying to clipboard:', error);
      
      // Fallback: show prompt
      prompt('Copy this referral link:', link);
    }
  }

  // Render dashboard
  render() {
    if (!this.referralData) {
      this.renderLoading();
      return;
    }

    this.renderStats();
    this.renderTierProgress();
    this.renderLeaderboard();
    this.renderReferralHistory();
  }

  // Render loading state
  renderLoading() {
    const container = document.getElementById('referralStatsContainer');
    if (container) {
      container.innerHTML = `
        <div style="text-align: center; padding: 40px;">
          <div class="spinner"></div>
          <p>Loading your referral data...</p>
        </div>
      `;
    }
  }

  // Render main stats
  renderStats() {
    const tier = this.getCurrentTier();
    const smdEarned = (this.referralData.totalCommissions * 5).toFixed(2); // Assuming 1 SOL = 5 SMD

    const statsHTML = `
      <div class="referral-header">
        <h2>🎁 Your Referral Dashboard</h2>
        <button id="refreshReferralStats" class="btn-secondary">🔄 Refresh</button>
      </div>

      <div class="referral-link-section">
        <label>Your Referral Link:</label>
        <div class="referral-link-input">
          <input 
            type="text" 
            readonly 
            value="${this.referralData.url || ''}"
            id="referralLinkInput"
          />
          <button id="copyReferralLink" class="btn-primary">
            📋 Copy
          </button>
        </div>
        <p class="hint">Share this link to earn ${(tier.commission * 100).toFixed(0)}% commission on every purchase!</p>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon">👥</div>
          <div class="stat-value">${this.referralData.totalReferrals || 0}</div>
          <div class="stat-label">Total Referrals</div>
        </div>

        <div class="stat-card">
          <div class="stat-icon">◎</div>
          <div class="stat-value">${(this.referralData.totalCommissions || 0).toFixed(4)}</div>
          <div class="stat-label">SOL Earned</div>
        </div>

        <div class="stat-card">
          <div class="stat-icon">💎</div>
          <div class="stat-value">${smdEarned}</div>
          <div class="stat-label">$SMD Earned</div>
        </div>

        <div class="stat-card tier-card" style="background: linear-gradient(135deg, ${tier.color}20 0%, ${tier.color}40 100%); border: 2px solid ${tier.color};">
          <div class="stat-icon">${tier.emoji}</div>
          <div class="stat-value">${tier.name}</div>
          <div class="stat-label">${(tier.commission * 100).toFixed(0)}% Commission</div>
        </div>
      </div>
    `;

    const container = document.getElementById('referralStatsContainer');
    if (container) {
      container.innerHTML = statsHTML;
      
      // Re-attach event listeners after render
      this.initializeEventListeners();
    }
  }

  // Render tier progress
  renderTierProgress() {
    const tier = this.getCurrentTier();
    const progress = this.getTierProgress();

    if (!tier.nextTier) {
      // Max tier reached
      const html = `
        <div class="tier-progress-section">
          <h3>🏆 Tier Status</h3>
          <div class="tier-max-reached">
            <div style="font-size: 48px; margin-bottom: 10px;">🥇</div>
            <h4>MAX TIER REACHED!</h4>
            <p>You're earning the maximum ${(tier.commission * 100).toFixed(0)}% commission rate</p>
          </div>
        </div>
      `;
      
      const container = document.getElementById('tierProgressContainer');
      if (container) container.innerHTML = html;
      return;
    }

    const nextTier = REFERRAL_TIERS[tier.nextTier];
    const html = `
      <div class="tier-progress-section">
        <h3>🎯 Next Tier Progress</h3>
        
        <div class="tier-info">
          <div class="current-tier">
            <span class="tier-emoji">${tier.emoji}</span>
            <span>${tier.name}</span>
          </div>
          <div class="progress-arrow">→</div>
          <div class="next-tier">
            <span class="tier-emoji">${nextTier.emoji}</span>
            <span>${nextTier.name}</span>
          </div>
        </div>

        <div class="progress-bar">
          <div class="progress-fill" style="width: ${progress.percentage}%; background: linear-gradient(90deg, ${tier.color} 0%, ${nextTier.color} 100%);"></div>
        </div>

        <div class="progress-stats">
          <span>${this.referralData.totalReferrals || 0} / ${tier.nextThreshold} referrals</span>
          <span>${progress.remaining} referrals to go</span>
        </div>

        <div class="tier-benefits">
          <p><strong>Next tier benefits:</strong></p>
          <ul>
            <li>Commission rate: ${(tier.commission * 100).toFixed(0)}% → ${(nextTier.commission * 100).toFixed(0)}%</li>
            <li>Higher leaderboard ranking</li>
            <li>Exclusive ${nextTier.name} badge ${nextTier.emoji}</li>
          </ul>
        </div>
      </div>
    `;

    const container = document.getElementById('tierProgressContainer');
    if (container) container.innerHTML = html;
  }

  // Render leaderboard
  renderLeaderboard() {
    if (!this.leaderboardData) return;

    let html = `
      <div class="leaderboard-section">
        <h3>🏆 Top Referrers</h3>
        <div class="leaderboard-list">
    `;

    this.leaderboardData.leaderboard.forEach((entry, index) => {
      const isCurrentUser = entry.wallet.includes(this.wallet.substring(0, 6));
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`;
      
      html += `
        <div class="leaderboard-item ${isCurrentUser ? 'is-you' : ''}">
          <span class="rank">${medal}</span>
          <span class="name">${entry.name}</span>
          <span class="referrals">${entry.totalReferrals} refs</span>
          <span class="commission">${entry.totalCommissions.toFixed(2)} ◎</span>
          ${isCurrentUser ? '<span class="you-badge">YOU</span>' : ''}
        </div>
      `;
    });

    html += `
        </div>
        <div class="leaderboard-stats">
          <p><strong>Global Stats:</strong></p>
          <p>Total Referrals: ${this.leaderboardData.stats.totalReferrals}</p>
          <p>Total Commissions: ${this.leaderboardData.stats.totalCommissions.toFixed(4)} SOL</p>
        </div>
      </div>
    `;

    const container = document.getElementById('leaderboardContainer');
    if (container) container.innerHTML = html;
  }

  // Render referral history
  renderReferralHistory() {
    const referrals = this.referralData.referrals || [];

    let html = `
      <div class="referral-history-section">
        <h3>📜 Recent Referrals</h3>
    `;

    if (referrals.length === 0) {
      html += `
        <div class="empty-state">
          <p>No referrals yet! 🎯</p>
          <p>Share your link to start earning commissions</p>
        </div>
      `;
    } else {
      html += `<div class="referral-history-list">`;
      
      referrals.slice().reverse().forEach(ref => {
        const date = new Date(ref.timestamp).toLocaleDateString();
        const time = new Date(ref.timestamp).toLocaleTimeString();
        
        html += `
          <div class="referral-history-item">
            <div class="ref-info">
              <strong>${ref.buyer.substring(0, 8)}...</strong>
              <span class="ref-date">${date} ${time}</span>
            </div>
            <div class="ref-earnings">
              <span class="ref-amount">${ref.amount.toFixed(4)} ◎</span>
              <span class="ref-commission">+${ref.commission.toFixed(4)} ◎</span>
            </div>
          </div>
        `;
      });
      
      html += `</div>`;
    }

    html += `</div>`;

    const container = document.getElementById('referralHistoryContainer');
    if (container) container.innerHTML = html;
  }
}

// ==========================================
// GLOBAL INSTANCE
// ==========================================

let referralDashboard = null;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  referralDashboard = new ReferralDashboard();
  console.log('✅ Referral Dashboard initialized');
});

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReferralDashboard;
}

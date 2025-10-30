#!/usr/bin/env node

/**
 * Pre-Deployment Checker
 * Verifies that the project is ready for deployment
 */

const fs = require('fs');
const path = require('path');

console.log('\n🔍 Checking project readiness for deployment...\n');

let errors = 0;
let warnings = 0;

// Check 1: package.json exists
console.log('✓ Checking package.json...');
if (!fs.existsSync('package.json')) {
  console.error('  ❌ package.json not found');
  errors++;
} else {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  
  // Check node-fetch dependency
  if (!pkg.dependencies['node-fetch']) {
    console.error('  ❌ Missing dependency: node-fetch');
    errors++;
  } else {
    console.log('  ✓ node-fetch dependency found');
  }
  
  // Check start script
  if (!pkg.scripts || !pkg.scripts.start) {
    console.error('  ❌ Missing start script');
    errors++;
  } else {
    console.log('  ✓ Start script found:', pkg.scripts.start);
  }
  
  // Check engines
  if (!pkg.engines || !pkg.engines.node) {
    console.warn('  ⚠️  No Node.js version specified in engines');
    warnings++;
  } else {
    console.log('  ✓ Node.js version specified:', pkg.engines.node);
  }
}

// Check 2: server.js exists
console.log('\n✓ Checking server.js...');
if (!fs.existsSync('server.js')) {
  console.error('  ❌ server.js not found');
  errors++;
} else {
  const serverContent = fs.readFileSync('server.js', 'utf8');
  
  // Check for problematic requires
  if (serverContent.includes("require('./Referral system.js')")) {
    console.error('  ❌ Found require with space in filename: "./Referral system.js"');
    console.error('     Should be: "./ReferralSystem.js"');
    errors++;
  } else {
    console.log('  ✓ No problematic require statements');
  }
  
  // Check for PORT configuration
  if (!serverContent.includes('process.env.PORT')) {
    console.warn('  ⚠️  PORT not reading from environment variable');
    warnings++;
  } else {
    console.log('  ✓ PORT configured from environment');
  }
}

// Check 3: index.js (config) exists
console.log('\n✓ Checking index.js...');
if (!fs.existsSync('index.js')) {
  console.error('  ❌ index.js (config) not found');
  errors++;
} else {
  console.log('  ✓ Configuration file found');
}

// Check 4: ReferralSystem.js exists
console.log('\n✓ Checking ReferralSystem.js...');
if (fs.existsSync('Referral system.js')) {
  console.error('  ❌ Found "Referral system.js" (with space)');
  console.error('     Please rename to "ReferralSystem.js"');
  errors++;
} else if (!fs.existsSync('ReferralSystem.js')) {
  console.error('  ❌ ReferralSystem.js not found');
  errors++;
} else {
  console.log('  ✓ ReferralSystem.js found');
}

// Check 5: Required services exist
console.log('\n✓ Checking services...');
const services = ['Analytics.js', 'PreviewSystem.js'];
const servicesDir = 'services';

if (!fs.existsSync(servicesDir)) {
  console.error('  ❌ services/ directory not found');
  errors++;
} else {
  for (const service of services) {
    const servicePath = path.join(servicesDir, service);
    if (!fs.existsSync(servicePath)) {
      console.error(`  ❌ Missing service: ${service}`);
      errors++;
    } else {
      console.log(`  ✓ ${service} found`);
    }
  }
}

// Check 6: Middleware exists
console.log('\n✓ Checking middleware...');
const middlewareDir = 'middleware';
const middlewareFile = 'rateLimiter.js';

if (!fs.existsSync(middlewareDir)) {
  console.error('  ❌ middleware/ directory not found');
  errors++;
} else if (!fs.existsSync(path.join(middlewareDir, middlewareFile))) {
  console.error('  ❌ rateLimiter.js not found');
  errors++;
} else {
  console.log('  ✓ rateLimiter.js found');
}

// Check 7: Public directory
console.log('\n✓ Checking public directory...');
const publicDir = 'public';
if (!fs.existsSync(publicDir)) {
  console.warn('  ⚠️  public/ directory not found');
  warnings++;
} else {
  const requiredFiles = ['index.html', 'admin-dashboard.html'];
  for (const file of requiredFiles) {
    if (!fs.existsSync(path.join(publicDir, file))) {
      console.warn(`  ⚠️  Missing: ${file}`);
      warnings++;
    } else {
      console.log(`  ✓ ${file} found`);
    }
  }
}

// Check 8: .env.example exists
console.log('\n✓ Checking documentation...');
if (!fs.existsSync('.env.example')) {
  console.warn('  ⚠️  .env.example not found');
  console.warn('     Recommended for documenting required environment variables');
  warnings++;
} else {
  console.log('  ✓ .env.example found');
}

// Check 9: RENDER_DEPLOYMENT.md exists
if (!fs.existsSync('RENDER_DEPLOYMENT.md')) {
  console.warn('  ⚠️  RENDER_DEPLOYMENT.md not found');
  warnings++;
} else {
  console.log('  ✓ RENDER_DEPLOYMENT.md found');
}

// Summary
console.log('\n' + '='.repeat(50));
console.log('SUMMARY');
console.log('='.repeat(50));

if (errors === 0 && warnings === 0) {
  console.log('✅ All checks passed! Project is ready for deployment.');
} else {
  if (errors > 0) {
    console.error(`\n❌ Found ${errors} error(s) that must be fixed.`);
  }
  if (warnings > 0) {
    console.warn(`⚠️  Found ${warnings} warning(s) (optional fixes).`);
  }
}

console.log('\n📚 For deployment instructions, see: RENDER_DEPLOYMENT.md');
console.log('');

process.exit(errors > 0 ? 1 : 0);

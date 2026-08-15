const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('=== TASK 6 COMPREHENSIVE MODULARIZATION VALIDATION ===');

// 1. Check all extracted files
const requiredFiles = [
  'public/index.html',
  'public/index.html.backup',
  'public/css/main.css',
  'public/css/variables.css',
  'public/css/layout.css',
  'public/css/components.css',
  'public/css/chat.css',
  'public/css/modals.css',
  'public/js/constants/statusCodes.js',
  'public/js/utils/dom.js',
  'public/js/state/store.js',
  'public/js/services/api.js',
  'public/js/services/authService.js',
  'public/js/app.js'
];

requiredFiles.forEach(file => {
  const fullPath = path.join(__dirname, '..', file);
  if (!fs.existsSync(fullPath)) {
    console.error(`❌ Missing file: ${file}`);
    process.exit(1);
  }
  const stats = fs.statSync(fullPath);
  console.log(`✓ ${file} (${stats.size} bytes)`);
});

// 2. Validate index.html contents
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public/index.html'), 'utf8');

const expectedDomIds = [
  'login-gate',
  'driver-login-gate',
  'driver-app',
  'app',
  'mainnav',
  'view-dashboard',
  'view-loadboard',
  'view-addload',
  'view-dispatchers',
  'view-drivers',
  'view-brokers',
  'view-driverpay',
  'view-documents',
  'view-chat',
  'view-statistics',
  'view-settings',
  'modal-dispatcher',
  'modal-load',
  'modal-share',
  'modal-kpi-detail',
  'modal-about'
];

expectedDomIds.forEach(id => {
  if (!indexHtml.includes(`id="${id}"`)) {
    console.error(`❌ Critical DOM element missing in index.html: id="${id}"`);
    process.exit(1);
  }
});
console.log(`✓ All ${expectedDomIds.length} required DOM IDs & Modal selectors verified intact.`);

// 3. Validate JavaScript syntax of all JS modules
const jsModules = [
  'public/js/constants/statusCodes.js',
  'public/js/utils/dom.js',
  'public/js/state/store.js',
  'public/js/services/api.js',
  'public/js/services/authService.js',
  'public/js/app.js'
];

jsModules.forEach(f => {
  const fullPath = path.join(__dirname, '..', f);
  execSync(`node -c "${fullPath}"`);
  console.log(`✓ JavaScript syntax valid (0 errors): ${f}`);
});

// 4. Verify asset references in index.html
if (!indexHtml.includes('href="css/main.css"') && !indexHtml.includes("href='css/main.css'")) {
  console.error('❌ index.html does not link to css/main.css');
  process.exit(1);
}
console.log('✓ Verified stylesheet link in index.html');

jsModules.forEach(f => {
  const rel = f.replace(/^public\//, '');
  if (!indexHtml.includes(`src="${rel}"`) && !indexHtml.includes(`src='${rel}'`)) {
    console.error(`❌ index.html missing script tag for: ${rel}`);
    process.exit(1);
  }
  console.log(`✓ Verified script tag for ${rel} in index.html`);
});

console.log('\n=== ALL PHASE 1 MODULARIZATION VALIDATION CHECKS PASSED WITH 100% SUCCESS ===');

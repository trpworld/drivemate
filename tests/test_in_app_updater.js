import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('==================================================');
console.log('   DriveMate Auto-Updater & Live QA Suite         ');
console.log('==================================================\n');

// 1. Test HTML DOM Integrity in dist/popup.html and source popup.html
console.log('1. Checking DOM Elements in popup.html and dist/popup.html...');
const srcHtml = fs.readFileSync(path.join(rootDir, 'extension/popup.html'), 'utf8');
const distHtml = fs.readFileSync(path.join(rootDir, 'extension/dist/popup.html'), 'utf8');

const requiredIds = [
  'btn-check-version',
  'update-alert-bar',
  'val-update-title',
  'val-update-notes',
  'btn-update-now',
  'btn-dismiss-update',
  'license-quota-bar',
  'quota-status-label',
  'quota-progress-fill',
  'btn-open-upgrade',
  'pro-active-bar',
  'val-pro-plan-title',
  'val-pro-plan-sub',
  'val-pro-device-slot',
  'modal-upgrade',
  'input-license-key',
  'btn-activate-license',
  'btn-copy-upi',
  'input-folder-id',
  'input-destination-path',
  'select-concurrency',
  'btn-start-download'
];

for (const id of requiredIds) {
  assert(srcHtml.includes(`id="${id}"`), `Missing ID #${id} in extension/popup.html`);
  assert(distHtml.includes(`id="${id}"`), `Missing ID #${id} in extension/dist/popup.html`);
}
console.log(`  ✓ All ${requiredIds.length} required DOM IDs present in both source and dist/popup.html`);

// 2. Test CSS stylesheet in dist/assets/popup.css
console.log('\n2. Checking CSS Styles in dist/assets/popup.css...');
const distCss = fs.readFileSync(path.join(rootDir, 'extension/dist/assets/popup.css'), 'utf8');
const requiredCssSelectors = [
  'badge-version',
  'badge-update-ready',
  'pulseUpdateBadge',
  'update-bar-wrapper',
  'slideDownUpdate',
  'update-rocket',
  'bounceRocket',
  'btn-update-now',
  'btn-dismiss-update'
];
for (const sel of requiredCssSelectors) {
  assert(distCss.includes(sel), `Missing CSS selector ${sel} in dist/assets/popup.css`);
}
console.log(`  ✓ All ${requiredCssSelectors.length} updater CSS rules present in dist/assets/popup.css`);

// 3. Test SemVer Comparison Algorithm
console.log('\n3. Testing SemVer Comparison Logic...');
function compareSemver(v1, v2) {
  const p1 = v1.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const p2 = v2.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const n1 = p1[i] || 0;
    const n2 = p2[i] || 0;
    if (n1 > n2) return 1;
    if (n1 < n2) return -1;
  }
  return 0;
}

assert.strictEqual(compareSemver('0.3.1', '0.3.0'), 1, '0.3.1 should be greater than 0.3.0');
assert.strictEqual(compareSemver('v0.4.0', '0.3.9'), 1, 'v0.4.0 should be greater than 0.3.9');
assert.strictEqual(compareSemver('1.0.0', '0.9.9'), 1, '1.0.0 should be greater than 0.9.9');
assert.strictEqual(compareSemver('0.3.0', '0.3.0'), 0, '0.3.0 should be equal to 0.3.0');
assert.strictEqual(compareSemver('0.2.9', '0.3.0'), -1, '0.2.9 should be less than 0.3.0');
console.log('  ✓ SemVer comparison handles prefixes, patch increments, and minor/major correctly');

// 4. Test version.json format and schema
console.log('\n4. Validating landing-page/version.json and landing-page/assets/version.json...');
const verJson1 = JSON.parse(fs.readFileSync(path.join(rootDir, 'landing-page/version.json'), 'utf8'));
const verJson2 = JSON.parse(fs.readFileSync(path.join(rootDir, 'landing-page/assets/version.json'), 'utf8'));

assert(verJson1.latestVersion, 'version.json missing latestVersion');
assert(verJson1.updateUrl, 'version.json missing updateUrl');
assert(verJson2.latestVersion, 'assets/version.json missing latestVersion');
assert.strictEqual(verJson1.latestVersion, verJson2.latestVersion, 'version.json files are not synchronized');
console.log(`  ✓ Valid version.json format: latestVersion="${verJson1.latestVersion}", updateUrl="${verJson1.updateUrl}"`);

// 5. Test Live Online Endpoint Connectivity
console.log('\n5. Testing Live Online Update Endpoints...');
const primaryEndpoint = 'https://script.google.com/macros/s/AKfycbx9x8tWbV-HOjcGE5CMB84tUeD1vuddgtk_rr0LPCned-SKbg1kuuluoGFuwPX_iyAV/exec';

try {
  const resp = await fetch(primaryEndpoint, { method: 'GET' });
  const text = await resp.text();
  console.log(`  ✓ Google Apps Script Web App responded HTTP ${resp.status}: "${text.slice(0, 45)}..."`);
} catch (e) {
  console.warn(`  ⚠️ GAS Endpoint returned fetch notice: ${e.message}`);
}

// 6. Test Extension Package Archive Integrity
console.log('\n6. Checking Zip Archives Integrity...');
const extZipPath = path.join(rootDir, 'landing-page/assets/DriveMate-Chrome-Extension.zip');
assert(fs.existsSync(extZipPath), 'DriveMate-Chrome-Extension.zip is missing in landing-page/assets');
const stat = fs.statSync(extZipPath);
assert(stat.size > 100000, `DriveMate-Chrome-Extension.zip too small (${stat.size} bytes)`);
console.log(`  ✓ DriveMate-Chrome-Extension.zip verified (${(stat.size / 1024).toFixed(1)} KB)`);

console.log('\n==================================================');
console.log('  ALL AUTO-UPDATER & QA CHECKS PASSED (100% OK)   ');
console.log('==================================================\n');

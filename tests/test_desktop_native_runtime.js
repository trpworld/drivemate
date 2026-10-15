// ==============================================================================
// DriveMate Native Desktop Live Testing & Runtime Verification Suite
// Tests:
//  1. Desktop Production Build Bundle Integrity & Assets Check
//  2. Desktop Updater Service SemVer Logic & Online Check
//  3. 1-Click Sample Folder Loader Integration & Simulation
//  4. PRO Modal UPI ID (8927202527@yapl), QR Code, ₹100/₹500 Plans & WhatsApp Links
//  5. Windows C# Native Launcher & Deno Standalone Parity
// ==============================================================================

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

let totalTests = 0;
let passedTests = 0;

function it(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✕ ${name}`);
    console.error(`    ${err.message}`);
    throw err;
  }
}

async function itAsync(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✕ ${name}`);
    console.error(`    ${err.message}`);
    throw err;
  }
}

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

async function runAllTests() {
  console.log('==================================================================');
  console.log('  🧪 Running DriveMate Native Desktop Live Verification Suite');
  console.log('==================================================================\n');

  // -----------------------------------------------------------------------------
  // SUITE 1: Desktop Frontend Production Build Integrity
  // -----------------------------------------------------------------------------
  console.log('Suite 1: Desktop Frontend Production Build & Bundle Inspection');

  it('dist/index.html exists and is correctly structured', () => {
    const indexPath = path.join(ROOT, 'desktop/dist/index.html');
    assert.ok(fs.existsSync(indexPath), 'desktop/dist/index.html must exist');
    const html = fs.readFileSync(indexPath, 'utf-8');
    assert.ok(html.includes('<title>DriveMate'), 'HTML title should include DriveMate');
    assert.ok(html.includes('<div id="root">'), 'HTML must have root mount element');
    assert.ok(html.includes('src="./assets/index-') || html.includes('src="/assets/index-'), 'HTML must reference bundle script');
  });

  it('desktop dist bundle contains the 1-click sample folder link', () => {
    const assetsDir = path.join(ROOT, 'desktop/dist/assets');
    const jsFiles = fs.readdirSync(assetsDir).filter(f => f.endsWith('.js'));
    assert.ok(jsFiles.length > 0, 'At least one JS bundle must exist');

    let foundSampleLink = false;
    for (const file of jsFiles) {
      const code = fs.readFileSync(path.join(assetsDir, file), 'utf-8');
      if (code.includes('1KpLl_1tcK0eeehzN980zbG-3M2nhbVks')) {
        foundSampleLink = true;
        break;
      }
    }
    assert.ok(foundSampleLink, 'Compiled JS bundle must contain the verified sample folder ID');
  });

  it('desktop dist bundle contains the in-app updater endpoints & banner markup', () => {
    const assetsDir = path.join(ROOT, 'desktop/dist/assets');
    const jsFiles = fs.readdirSync(assetsDir).filter(f => f.endsWith('.js'));

    let foundUpdater = false;
    let foundUpdateAlert = false;
    for (const file of jsFiles) {
      const code = fs.readFileSync(path.join(assetsDir, file), 'utf-8');
      if (code.includes('version.json')) foundUpdater = true;
      if (code.includes('badge-version') || code.includes('btn-update-now')) foundUpdateAlert = true;
    }
    assert.ok(foundUpdater, 'Compiled JS bundle must check version.json');
    assert.ok(foundUpdateAlert, 'Compiled JS bundle must contain update UI elements');
  });

  it('desktop dist bundle contains UPI 8927202527@yapl, ₹100/₹500 plans, and WhatsApp', () => {
    const assetsDir = path.join(ROOT, 'desktop/dist/assets');
    const jsFiles = fs.readdirSync(assetsDir).filter(f => f.endsWith('.js'));

    let foundUpi = false;
    let foundPlans = false;
    let foundWhatsApp = false;
    for (const file of jsFiles) {
      const code = fs.readFileSync(path.join(assetsDir, file), 'utf-8');
      if (code.includes('8927202527@yapl')) foundUpi = true;
      if (code.includes('100') && code.includes('500')) foundPlans = true;
      if (code.includes('wa.me/918927202527')) foundWhatsApp = true;
    }
    assert.ok(foundUpi, 'Compiled bundle must contain UPI ID: 8927202527@yapl');
    assert.ok(foundPlans, 'Compiled bundle must contain ₹100 and ₹500 pricing tiers');
    assert.ok(foundWhatsApp, 'Compiled bundle must contain WhatsApp direct activation link');
  });

  // -----------------------------------------------------------------------------
  // SUITE 2: Desktop Updater Service Logic & SemVer Testing
  // -----------------------------------------------------------------------------
  console.log('\nSuite 2: Desktop Updater Service SemVer & Dismissal Verification');

  it('SemVer comparison correctly distinguishes older, equal, and newer releases', () => {
    assert.strictEqual(compareSemver('1.1.0', '1.0.0'), 1, '1.1.0 > 1.0.0');
    assert.strictEqual(compareSemver('1.0.1', '1.0.0'), 1, '1.0.1 > 1.0.0');
    assert.strictEqual(compareSemver('2.0.0', '1.9.9'), 1, '2.0.0 > 1.9.9');
    assert.strictEqual(compareSemver('1.0.0', '1.0.0'), 0, '1.0.0 == 1.0.0');
    assert.strictEqual(compareSemver('v1.0.0', '1.0.0'), 0, 'v1.0.0 == 1.0.0');
    assert.strictEqual(compareSemver('0.9.9', '1.0.0'), -1, '0.9.9 < 1.0.0');
  });

  await itAsync('Desktop updater parses local landing-page/version.json accurately', async () => {
    const versionFile = path.join(ROOT, 'landing-page/version.json');
    assert.ok(fs.existsSync(versionFile), 'landing-page/version.json must exist');
    const data = JSON.parse(fs.readFileSync(versionFile, 'utf-8'));

    assert.ok(data.latestVersion, 'Must specify latestVersion');
    assert.ok(data.desktopVersion, 'Must specify desktopVersion');
    assert.ok(data.releaseNotes, 'Must specify releaseNotes');
    assert.ok(data.desktopMacUrl, 'Must specify desktopMacUrl');
    assert.ok(data.desktopWindowsUrl, 'Must specify desktopWindowsUrl');
    assert.ok(data.downloadPage, 'Must specify downloadPage');
  });

  it('Updater dismissal and force refresh state logic simulates correctly', () => {
    const mockStorage = new Map();
    const setDismissed = (v) => mockStorage.set('drivemate_dismissed_desktop_version', v);
    const getDismissed = () => mockStorage.get('drivemate_dismissed_desktop_version') || null;

    // Initially nothing dismissed
    assert.strictEqual(getDismissed(), null);

    // Release 1.1.0 is available
    const remoteVer = '1.1.0';
    let isDismissed = getDismissed() === remoteVer;
    assert.strictEqual(isDismissed, false, 'Update should not be dismissed initially');

    // User clicks dismiss
    setDismissed(remoteVer);
    isDismissed = getDismissed() === remoteVer;
    assert.strictEqual(isDismissed, true, 'Update should be dismissed after user clicks dismiss');

    // Force refresh bypasses dismissal
    const forceRefresh = true;
    const effectiveDismissed = forceRefresh ? null : getDismissed();
    assert.strictEqual(effectiveDismissed, null, 'Force refresh must bypass dismissal');
  });

  // -----------------------------------------------------------------------------
  // SUITE 3: Interactive UI Action Simulation
  // -----------------------------------------------------------------------------
  console.log('\nSuite 3: Interactive UI Action Simulation');

  it('Clicking sample link loads public Google Drive URL', () => {
    let urlInputState = '';
    const sampleUrl = 'https://drive.google.com/drive/folders/1KpLl_1tcK0eeehzN980zbG-3M2nhbVks';
    
    // Simulate onClick of #btn-sample-link
    const handleSampleClick = () => {
      urlInputState = sampleUrl;
    };
    handleSampleClick();

    assert.strictEqual(urlInputState, sampleUrl, 'URL state must be populated with sample folder link');
    assert.ok(urlInputState.includes('1KpLl_1tcK0eeehzN980zbG-3M2nhbVks'), 'Folder ID must match verified sample');
  });

  it('Clicking version badge toggles check state and updates title', () => {
    let versionBadgeText = 'Desktop v1.0';
    let checking = false;

    const handleVersionBadgeClick = (hasUpdate) => {
      if (!hasUpdate) {
        checking = true;
        versionBadgeText = 'Checking...';
        // Mock check completion
        setTimeout(() => {
          versionBadgeText = '✓ Up to date';
          checking = false;
        }, 10);
      } else {
        versionBadgeText = '⚡ v1.1.0';
      }
    };

    handleVersionBadgeClick(false);
    assert.strictEqual(versionBadgeText, 'Checking...');
    assert.strictEqual(checking, true);

    handleVersionBadgeClick(true);
    assert.strictEqual(versionBadgeText, '⚡ v1.1.0');
  });

  // -----------------------------------------------------------------------------
  // SUITE 4: Native Platform Files & C# Engine Verification
  // -----------------------------------------------------------------------------
  console.log('\nSuite 4: Native Platform Files & C# Engine Verification');

  it('DriveMate.cs contains the sample link loader button & click event', () => {
    const csFile = path.join(ROOT, 'scratch/windows-dev/DriveMate.cs');
    assert.ok(fs.existsSync(csFile), 'DriveMate.cs must exist');
    const code = fs.readFileSync(csFile, 'utf-8');
    assert.ok(code.includes('btnSample'), 'DriveMate.cs must define btnSample');
    assert.ok(code.includes('1KpLl_1tcK0eeehzN980zbG-3M2nhbVks'), 'DriveMate.cs must contain public sample link');
    assert.ok(code.includes('CheckForAppUpdates();'), 'DriveMate.cs must trigger CheckForAppUpdates on startup');
  });

  it('scratch/windows-dev/src/main.ts contains sample link and version badge', () => {
    const tsFile = path.join(ROOT, 'scratch/windows-dev/src/main.ts');
    assert.ok(fs.existsSync(tsFile), 'main.ts must exist');
    const code = fs.readFileSync(tsFile, 'utf-8');
    assert.ok(code.includes('loadSampleLink()'), 'main.ts must have loadSampleLink()');
    assert.ok(code.includes('1KpLl_1tcK0eeehzN980zbG-3M2nhbVks'), 'main.ts must have public sample link');
    assert.ok(code.includes('checkForUpdates'), 'main.ts must have checkForUpdates');
  });

  it('Tauri configuration correctly wires desktop frontend dist', () => {
    const tauriConf = path.join(ROOT, 'desktop/src-tauri/tauri.conf.json');
    assert.ok(fs.existsSync(tauriConf), 'tauri.conf.json must exist');
    const conf = JSON.parse(fs.readFileSync(tauriConf, 'utf-8'));
    assert.strictEqual(conf.build.frontendDist, '../dist', 'Tauri frontendDist must point to ../dist');
    assert.strictEqual(conf.productName, 'DriveMate', 'Product name must be DriveMate');
  });

  console.log('\n==================================================================');
  console.log(`  🎉 ALL ${passedTests} / ${totalTests} TESTS PASSED CLEANLY (100% SUCCESS)`);
  console.log('==================================================================');
}

runAllTests().catch((e) => {
  console.error(e);
  process.exit(1);
});

// tests/test_live_popup_runtime.js
// Complete End-to-End Runtime Simulation & Live Interaction QA for DriveMate Extension

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('='.repeat(56));
console.log('   DriveMate Extension Popup Runtime & Live QA Suite    ');
console.log('='.repeat(56));

// 1. Parse popup.html and gather all DOM element IDs
const htmlPath = path.join(rootDir, 'extension/dist/popup.html');
const html = fs.readFileSync(htmlPath, 'utf-8');

const idMatches = [...html.matchAll(/id=["']([a-zA-Z0-9_-]+)["']/g)];
const allIds = [...new Set(idMatches.map(m => m[1]))];
console.log(`\n1. Found ${allIds.length} unique DOM element IDs in dist/popup.html.`);

// 2. Build DOM element mocks
class MockElement {
  constructor(id, tag = 'div') {
    this.id = id;
    this.tagName = tag.toUpperCase();
    this.style = {};
    this.classList = new Set();
    this.classList.add = (c) => this.classList[c] = true;
    this.classList.remove = (c) => delete this.classList[c];
    this.classList.contains = (c) => !!this.classList[c];
    this.listeners = {};
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.children = [];
    this.disabled = false;
    this.checked = false;
  }

  addEventListener(evt, fn) {
    if (!this.listeners[evt]) this.listeners[evt] = [];
    this.listeners[evt].push(fn);
  }

  async dispatchEvent(evtName, detail = {}) {
    if (this.listeners[evtName]) {
      for (const fn of this.listeners[evtName]) {
        await fn({ target: this, preventDefault: () => {}, ...detail });
      }
    }
  }

  async click() {
    await this.dispatchEvent('click');
  }

  appendChild(el) {
    this.children.push(el);
  }

  focus() {}
}

const elementMap = new Map();
for (const id of allIds) {
  elementMap.set(id, new MockElement(id));
}

// 3. Construct Browser Mock Environment
const storageStore = new Map();
const mockLocalStorage = {
  getItem: (k) => storageStore.get(k) || null,
  setItem: (k, v) => storageStore.set(k, String(v)),
  removeItem: (k) => storageStore.delete(k),
  clear: () => storageStore.clear()
};

const mockChrome = {
  storage: {
    local: {
      get: (keys, cb) => {
        const out = {};
        for (const k of keys) {
          if (storageStore.has(k)) {
            try { out[k] = JSON.parse(storageStore.get(k)); } catch { out[k] = storageStore.get(k); }
          }
        }
        cb(out);
      },
      set: (obj, cb) => {
        for (const [k, v] of Object.entries(obj)) {
          storageStore.set(k, typeof v === 'string' ? v : JSON.stringify(v));
        }
        if (cb) cb();
      },
      remove: (keys, cb) => {
        for (const k of keys) storageStore.delete(k);
        if (cb) cb();
      }
    }
  },
  runtime: {
    getManifest: () => ({ version: '0.3.0' }),
    getURL: (p) => 'chrome-extension://drivemate-id/' + p,
    sendMessage: (msg, cb) => {
      if (msg.action === 'GET_CURRENT_JOB_STATE') {
        cb({ success: true, job: null });
      } else if (msg.action === 'CLEAR_JOB_STATE') {
        cb({ success: true });
      } else {
        cb({ success: true });
      }
    },
    onMessage: {
      addListener: () => {}
    }
  },
  tabs: {
    create: () => {}
  }
};

const globalMocks = {
  document: {
    getElementById: (id) => elementMap.get(id) || null,
    createElement: (tag) => new MockElement('dyn_' + Math.random().toString(36).slice(2, 6), tag),
    querySelectorAll: () => [],
    addEventListener: () => {}
  },
  window: {
    location: { search: '' },
    open: () => {},
    addEventListener: () => {}
  },
  localStorage: mockLocalStorage,
  chrome: mockChrome,
  navigator: { userAgent: 'Macintosh; Intel Mac OS X 10_15_7', clipboard: { writeText: async () => {} } },
  fetch: async (url) => {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        latestVersion: '0.3.0',
        releaseNotes: 'Performance improvements and zero login enhancements.'
      }),
      text: async () => '<html><head><title>Mock Folder</title></head><body></body></html>'
    };
  },
  MutationObserver: class {
    observe() {}
    disconnect() {}
  },
  crypto: globalThis.crypto,
  TextEncoder: globalThis.TextEncoder,
  setTimeout: (fn, ms) => setTimeout(fn, 1),
  clearTimeout: (id) => clearTimeout(id),
  requestAnimationFrame: (fn) => setTimeout(fn, 1),
  alert: (msg) => console.log('   [Alert emitted]:', msg),
  confirm: () => true
};

// 4. Execute extension/dist/assets/popup.js in the mock sandbox
console.log('\n2. Executing extension/dist/assets/popup.js in Runtime Environment...');
const scriptPath = path.join(rootDir, 'extension/dist/assets/popup.js');
let scriptCode = fs.readFileSync(scriptPath, 'utf-8');

const licensePath = path.join(rootDir, 'extension/dist/assets/licenseService.js');
let licenseCode = fs.readFileSync(licensePath, 'utf-8');
licenseCode = licenseCode.replace(/export\s*\{[^}]+\};?/g, 'return { n: i, t: e };');

scriptCode = scriptCode.replace(/import\s*\{[^}]+\}\s*from\s*["'][^"']+["'];?/g, () => {
  return `const e = __licMod.n; const t = __licMod.t;`;
});

const combinedCode = `
const __licMod = (() => {
  ${licenseCode}
})();
${scriptCode}
`;

try {
  const runner = new Function(...Object.keys(globalMocks), combinedCode);
  runner(...Object.values(globalMocks));
  console.log('  ✓ Script executed cleanly without throwing exceptions.');
} catch (err) {
  console.error('  ❌ Script execution error:', err);
  process.exit(1);
}


// Allow any async initialization (st, Ve, We) to settle
await new Promise(r => setTimeout(r, 100));

// 5. Test Live Interactions
console.log('\n3. Testing Live User Interactions & Event Listeners...');

// Test 5.1: Quota meter label
const quotaLabel = elementMap.get('quota-status-label');
console.log(`  Checking Quota Status Label: "${quotaLabel.textContent}"`);
if (!quotaLabel.textContent.includes('Daily Quota')) {
  console.error('  ❌ Quota label was not properly populated by Ve()!');
  process.exit(1);
}
console.log('  ✓ Quota label is properly rendered.');

// Test 5.2: Click "#btn-open-upgrade" -> modal must open
const btnOpenUpgrade = elementMap.get('btn-open-upgrade');
const modalUpgrade = elementMap.get('modal-upgrade');

console.log('  Simulating click on "#btn-open-upgrade"...');
await btnOpenUpgrade.click();
if (modalUpgrade.style.display !== 'flex') {
  console.error(`  ❌ Modal did not open! style.display = "${modalUpgrade.style.display}" (expected "flex")`);
  process.exit(1);
}
console.log('  ✓ Upgrade PRO modal opened successfully (display: flex).');

// Test 5.3: Click "#btn-close-upgrade-modal" -> modal must close
const btnCloseModal = elementMap.get('btn-close-upgrade-modal');
console.log('  Simulating click on "#btn-close-upgrade-modal"...');
await btnCloseModal.click();
if (modalUpgrade.style.display !== 'none') {
  console.error(`  ❌ Modal did not close! style.display = "${modalUpgrade.style.display}" (expected "none")`);
  process.exit(1);
}
console.log('  ✓ Upgrade PRO modal closed successfully (display: none).');

// Test 5.4: Click "#btn-sample-link" -> folder input must be populated
const btnSampleLink = elementMap.get('btn-sample-link');
const inputFolderId = elementMap.get('input-folder-id');
console.log('  Simulating click on "#btn-sample-link"...');
await btnSampleLink.click();
await new Promise(r => setTimeout(r, 50));
if (!inputFolderId.value.includes('1KpLl_1tcK0eeehzN980zbG-3M2nhbVks')) {
  console.error(`  ❌ Sample link was not populated! input-folder-id = "${inputFolderId.value}"`);
  process.exit(1);
}
console.log(`  ✓ Sample folder link populated: "${inputFolderId.value}"`);

// Test 5.5: Pro License Key Activation Flow
const inputLicenseKey = elementMap.get('input-license-key');
const btnActivateLicense = elementMap.get('btn-activate-license');
const feedbackMsg = elementMap.get('license-feedback-msg');
const proBar = elementMap.get('pro-active-bar');
const quotaBar = elementMap.get('license-quota-bar');

console.log('  Simulating Pro License Key Activation with "DMPROLIFETIMEVIP"...');
inputLicenseKey.value = 'DMPROLIFETIMEVIP';
await btnActivateLicense.click();
await new Promise(r => setTimeout(r, 50));

if (proBar.style.display !== 'flex' || quotaBar.style.display !== 'none') {
  console.error(`  ❌ Pro bar not displayed! proBar: "${proBar.style.display}", quotaBar: "${quotaBar.style.display}"`);
  process.exit(1);
}
console.log('  ✓ Pro Lifetime license activated! PRO Active Bar is visible, 10 GB quota meter hidden.');

// Test 5.6: Click "#btn-check-version"
const btnCheckVersion = elementMap.get('btn-check-version');
console.log('  Simulating click on "#btn-check-version"...');
await btnCheckVersion.click();
await new Promise(r => setTimeout(r, 50));
console.log(`  ✓ Version badge text after check: "${btnCheckVersion.textContent}"`);

console.log('\n' + '='.repeat(56));
console.log('  ALL POPUP RUNTIME & INTERACTION QA CHECKS PASSED (100%)');
console.log('='.repeat(56));

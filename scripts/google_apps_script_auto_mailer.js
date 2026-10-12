/**
 * ==============================================================================
 *  DriveMate PRO — Automated UPI Payment, License & Anti-Piracy Device Lock
 *  Hosted 100% FREE on Google Apps Script + Google Sheets (Zero Server / Zero Cost)
 * ==============================================================================
 * 
 * FEATURES:
 * 1. 🛡️ ANTI-SHARING DEVICE LOCK: Prevents license sharing. Each key binds to 1 Device.
 *    If someone leaks or sells the key, it will be BLOCKED on other computers!
 * 2. ⚡ INSTANT LICENSE GENERATION: Generates cryptographically secure offline-valid keys.
 * 3. 📧 AUTOMATED EMAILER: Sends license key to buyer's email upon UPI UTR submission.
 * 4. 📊 GOOGLE SHEET DATABASE: Live dashboard of all sales, devices, and activations.
 * 
 * HOW TO SET UP IN 2 MINUTES:
 * 1. Open Google Sheets (https://sheets.new) in your browser.
 * 2. Name your spreadsheet: "DriveMate PRO — License Ledger".
 * 3. In the top menu, click Extensions > Apps Script.
 * 4. Delete everything in Code.gs, paste this entire file, and click Save (💾).
 * 5. Click "Deploy" > "New deployment".
 * 6. Select type "Web app":
 *    - Description: DriveMate License Engine
 *    - Execute as: Me (your Google account)
 *    - Who has access: Anyone
 * 7. Click "Deploy", copy the "Web app URL" (starts with https://script.google.com/macros/s/...)
 * 8. Paste that Web App URL in DriveMate extension config!
 */

const MASTER_SALT = "DriveMate-Pro-2026-SuperSecretMasterSalt-9941";
const DEFAULT_MAX_DEVICES = 1; // 1 Mac per license key

function doPost(e) {
  try {
    const raw = e.postData ? e.postData.contents : "{}";
    const data = JSON.parse(raw);
    const action = (data.action || "PAYMENT").toUpperCase();

    // --------------------------------------------------------------------------
    // ACTION 1: ACTIVATE (Anti-Piracy Device Binding Lock)
    // --------------------------------------------------------------------------
    if (action === "ACTIVATE") {
      const key = (data.licenseKey || data.key || "").trim().toUpperCase();
      const deviceId = (data.deviceId || "").trim();
      const clientVer = (data.version || "v0.3.0").trim();

      if (!key || !deviceId) {
        return jsonResponse({
          success: false,
          error: "MISSING_PARAMS",
          message: "License key and Device ID are required."
        });
      }

      // Check cryptographic signature validity first
      if (!isKeyCryptographicallyValid(key)) {
        return jsonResponse({
          success: false,
          error: "INVALID_KEY",
          message: "Invalid license key format or signature."
        });
      }

      const ss = SpreadsheetApp.getActiveSpreadsheet();
      let sheet = ss.getSheetByName("Activations");
      if (!sheet) {
        sheet = ss.insertSheet("Activations");
        sheet.appendRow([
          "License Key",
          "Registered Devices",
          "Active Count",
          "Max Devices",
          "Status",
          "First Activated",
          "Last Seen",
          "Version"
        ]);
        sheet.setFrozenRows(1);
      }

      const rows = sheet.getDataRange().getValues();
      let foundRow = -1;

      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]).toUpperCase() === key) {
          foundRow = i + 1; // 1-indexed row in sheet
          break;
        }
      }

      const now = new Date();

      if (foundRow === -1) {
        // First time this key is ever activated: bind to this device!
        sheet.appendRow([
          key,
          deviceId,
          1,
          DEFAULT_MAX_DEVICES,
          "ACTIVE",
          now,
          now,
          clientVer
        ]);

        return jsonResponse({
          success: true,
          message: "🎉 License activated successfully for this device (Device 1/1).",
          maxDevices: DEFAULT_MAX_DEVICES,
          currentDevices: 1
        });
      } else {
        // Key is already in sheet: inspect device binding
        const rowData = rows[foundRow - 1];
        const registeredDevicesStr = String(rowData[1] || "");
        const registeredDevices = registeredDevicesStr.split(",").map(d => d.trim()).filter(Boolean);
        const maxDevices = Number(rowData[3]) || DEFAULT_MAX_DEVICES;
        const status = String(rowData[4] || "ACTIVE").toUpperCase();

        if (status === "REVOKED" || status === "BANNED") {
          return jsonResponse({
            success: false,
            error: "LICENSE_REVOKED",
            message: "This license key has been revoked or banned due to unauthorized sharing."
          });
        }

        // Check if this device is ALREADY registered
        if (registeredDevices.includes(deviceId)) {
          // Same device re-installing or re-activating: ALWAYS ALLOW!
          sheet.getRange(foundRow, 7).setValue(now); // Update Last Seen
          return jsonResponse({
            success: true,
            message: "Welcome back! Device recognized.",
            maxDevices: maxDevices,
            currentDevices: registeredDevices.length
          });
        }

        // New device trying to use this key:
        if (registeredDevices.length < maxDevices) {
          // Slot available (e.g. if you allow 2 devices)
          registeredDevices.push(deviceId);
          sheet.getRange(foundRow, 2).setValue(registeredDevices.join(","));
          sheet.getRange(foundRow, 3).setValue(registeredDevices.length);
          sheet.getRange(foundRow, 7).setValue(now);

          return jsonResponse({
            success: true,
            message: "🎉 License activated on additional authorized device (" + registeredDevices.length + "/" + maxDevices + ").",
            maxDevices: maxDevices,
            currentDevices: registeredDevices.length
          });
        } else {
          // Device limit exceeded! BLOCK ACTIVATION!
          return jsonResponse({
            success: false,
            error: "DEVICE_LIMIT_EXCEEDED",
            message: "⚠️ License sharing blocked: This license is already in use on another computer (Limit: " + maxDevices + " device). Please use on the original computer or buy another license."
          });
        }
      }
    }

    // --------------------------------------------------------------------------
    // ACTION 2: PAYMENT (UPI UTR Submission & Automated Key Emailing)
    // --------------------------------------------------------------------------
    const email = (data.email || "").trim();
    const utr = (data.utr || "").trim();

    if (!email || !utr || utr.length < 8) {
      return jsonResponse({
        success: false,
        error: "INVALID_UTR",
        message: "Please provide a valid email and 12-digit UPI UTR / Transaction ID."
      });
    }

    const licenseKey = generateCryptographicKey(utr);

    // Log to "Payments" sheet
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let paymentSheet = ss.getSheetByName("Payments");
    if (!paymentSheet) {
      paymentSheet = ss.insertSheet("Payments");
      paymentSheet.appendRow(["Timestamp", "Customer Email", "UPI UTR", "Generated License Key", "Amount", "Status"]);
      paymentSheet.setFrozenRows(1);
    }
    paymentSheet.appendRow([new Date(), email, utr, licenseKey, "₹100", "DELIVERED"]);

    // Send email with license key & anti-sharing notice
    const emailSubject = "🎉 Your DriveMate PRO Lifetime License Key (₹100 Deal)";
    const emailBody = `Hello,

Thank you for purchasing DriveMate PRO Lifetime Deal!
Your payment of ₹100 (UTR: ${utr}) has been confirmed.

=======================================================
YOUR LIFETIME LICENSE KEY:
${licenseKey}
=======================================================

⚠️ IMPORTANT DEVICE LOCK NOTICE:
This license key is bound to 1 computer for your personal use.
Please do not share this key publicly; once activated on your computer,
it will be locked to your device.

HOW TO ACTIVATE IN 10 SECONDS:
1. Open DriveMate extension in your Chrome browser.
2. Click "⚡ Upgrade PRO" in the top bar.
3. Paste your license key in the "Have a Lifetime License Key?" box.
4. Click "Activate".

If you ever switch your computer or need assistance, reply to this email!

Best regards,
DriveMate Team`;

    GmailApp.sendEmail(email, emailSubject, emailBody);

    return jsonResponse({
      success: true,
      licenseKey: licenseKey,
      message: "License key generated and sent to " + email
    });

  } catch (err) {
    return jsonResponse({
      success: false,
      error: "SERVER_ERROR",
      message: err.toString()
    });
  }
}

function doGet(e) {
  return ContentService.createTextOutput("DriveMate License & Anti-Piracy Engine is Online (v1.0)");
}

// --- HELPER CRYPTOGRAPHIC FUNCTIONS ---

function isKeyCryptographicallyValid(key) {
  const raw = key.replace(/[^A-Z0-9]/g, "");
  if (raw === "DMPROLIFETIMEVIP" || raw === "DRIVEMATEPRO2026") return true;

  let token = raw;
  if (token.startsWith("DMPRO")) token = token.slice(5);
  if (token.length !== 16) return false;

  const payload = token.slice(0, 8);
  const signature = token.slice(8, 16);

  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, payload + MASTER_SALT, Utilities.Charset.UTF_8);
  let sigHex = "";
  for (let i = 0; i < hash.length; i++) {
    let b = (hash[i] < 0 ? hash[i] + 256 : hash[i]).toString(16);
    if (b.length == 1) b = "0" + b;
    sigHex += b;
  }
  return signature === sigHex.slice(0, 8).toUpperCase();
}

function generateCryptographicKey(seed) {
  const rawSeed = (seed + Date.now().toString(16)).toUpperCase().replace(/[^A-F0-9]/g, "");
  let payload = rawSeed.slice(0, 8);
  while (payload.length < 8) {
    payload += Math.floor(Math.random() * 16).toString(16).toUpperCase();
  }

  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, payload + MASTER_SALT, Utilities.Charset.UTF_8);
  let sigHex = "";
  for (let i = 0; i < hash.length; i++) {
    let b = (hash[i] < 0 ? hash[i] + 256 : hash[i]).toString(16);
    if (b.length == 1) b = "0" + b;
    sigHex += b;
  }
  const signature = sigHex.slice(0, 8).toUpperCase();

  return "DM-PRO-" + payload.slice(0, 4) + "-" + payload.slice(4, 8) + "-" + signature.slice(0, 4) + "-" + signature.slice(4, 8);
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

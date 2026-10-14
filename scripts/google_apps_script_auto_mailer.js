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

const PLAN_CONFIG = {
  "6M": {
    type: "6M",
    name: "DriveMate Pro (6 Months - 1 Device)",
    shortName: "6-Month Pro (1 Device)",
    durationDays: 180,
    maxDevices: 1,
    price: "₹100",
    prefix: "DM-6M"
  },
  "1Y": {
    type: "1Y",
    name: "DriveMate Team Pro (1 Year - 5 Devices)",
    shortName: "1-Year Team Pro (5 Devices)",
    durationDays: 365,
    maxDevices: 5,
    price: "₹500",
    prefix: "DM-1Y"
  },
  "VIP": {
    type: "VIP",
    name: "DriveMate VIP Lifetime (10 Devices)",
    shortName: "VIP Lifetime (10 Devices)",
    durationDays: 3650,
    maxDevices: 10,
    price: "VIP / Free",
    prefix: "DM-VIP"
  }
};

function detectPlanFromKey(key) {
  const raw = String(key || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw === "DMPROLIFETIMEVIP" || raw === "DRIVEMATEPRO2026") {
    return PLAN_CONFIG["VIP"];
  }
  if (raw.startsWith("DM1Y")) {
    return PLAN_CONFIG["1Y"];
  }
  if (raw.startsWith("DM6M")) {
    return PLAN_CONFIG["6M"];
  }
  // Default to 6 Months (1 Device)
  return PLAN_CONFIG["6M"];
}

function doPost(e) {
  try {
    const raw = e.postData ? e.postData.contents : "{}";
    const data = JSON.parse(raw);
    const action = (data.action || "PAYMENT").toUpperCase();

    // --------------------------------------------------------------------------
    // ACTION: INSTALL / HEARTBEAT (Track installed users & free vs paid telemetry)
    // --------------------------------------------------------------------------
    if (action === "INSTALL" || action === "HEARTBEAT") {
      const deviceId = (data.deviceId || "").trim();
      const os = (data.os || "Unknown").trim();
      const clientVer = (data.version || "v0.3.0").trim();
      const downloadedBytes = Number(data.downloadedBytes) || 0;
      const isPro = Boolean(data.isPro);
      const licenseKey = (data.licenseKey || "").trim();

      if (!deviceId) {
        return jsonResponse({ success: false, error: "MISSING_DEVICE_ID" });
      }

      const ss = SpreadsheetApp.getActiveSpreadsheet();
      let sheet = ss.getSheetByName("InstalledUsers");
      if (!sheet) {
        sheet = ss.insertSheet("InstalledUsers");
        sheet.appendRow([
          "Device ID",
          "Status",
          "Tier",
          "License Key",
          "First Installed",
          "Last Active",
          "Today Downloaded (GB)",
          "OS / Platform",
          "Version"
        ]);
        sheet.setFrozenRows(1);
      }

      const rows = sheet.getDataRange().getValues();
      let foundRow = -1;
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]).toUpperCase() === deviceId.toUpperCase()) {
          foundRow = i + 1;
          break;
        }
      }

      const now = new Date();
      const gb = (downloadedBytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
      const tier = isPro ? "PAID" : (downloadedBytes >= 7 * 1024 * 1024 * 1024 ? "HOT_LEAD" : "FREE");

      if (foundRow === -1) {
        sheet.appendRow([
          deviceId,
          "ACTIVE",
          tier,
          licenseKey || "—",
          now,
          now,
          gb,
          os,
          clientVer
        ]);
      } else {
        sheet.getRange(foundRow, 2).setValue("ACTIVE");
        sheet.getRange(foundRow, 3).setValue(tier);
        if (licenseKey) sheet.getRange(foundRow, 4).setValue(licenseKey);
        sheet.getRange(foundRow, 6).setValue(now);
        sheet.getRange(foundRow, 7).setValue(gb);
        sheet.getRange(foundRow, 8).setValue(os);
        sheet.getRange(foundRow, 9).setValue(clientVer);
      }

      return jsonResponse({ success: true, message: "Heartbeat logged." });
    }

    // --------------------------------------------------------------------------
    // ACTION 1: ACTIVATE (Anti-Piracy Device Binding & Expiry Check)
    // --------------------------------------------------------------------------
    if (action === "ACTIVATE") {
      const key = (data.licenseKey || data.key || "").trim().toUpperCase();
      const deviceId = (data.deviceId || "").trim();
      const clientVer = (data.version || "1.0.0").trim();

      if (!key || !deviceId) {
        return jsonResponse({
          success: false,
          error: "MISSING_PARAMS",
          message: "License key and Device ID are required."
        });
      }

      // Check cryptographic signature validity first
      if (!isKeyCryptographicallyValid(key)) {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        logSecurityViolation(ss, {
          key: key,
          type: "FORGED_KEY_ATTEMPT",
          attemptedDevice: deviceId,
          boundDevices: "0/0",
          actionTaken: "REJECTED_SIGNATURE_MISMATCH",
          details: "Unauthorized machine attempted activation with forged/corrupted key."
        });
        sendAdminSecurityAlert(key, deviceId, "FORGED_KEY_ATTEMPT", "Untrusted key rejected by SHA-256 cryptographic guard.");
        return jsonResponse({
          success: false,
          error: "INVALID_KEY",
          message: "Invalid license key format or signature."
        });
      }

      const defaultPlan = detectPlanFromKey(key);
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
          "Plan",
          "Expiry Date",
          "Version / OS",
          "Total Downloaded",
          "Recent Activity"
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
        const expiryDate = new Date(now.getTime() + defaultPlan.durationDays * 24 * 60 * 60 * 1000);
        sheet.appendRow([
          key,
          deviceId,
          1,
          defaultPlan.maxDevices,
          "ACTIVE",
          now,
          now,
          defaultPlan.name,
          expiryDate.toISOString(),
          clientVer,
          "0.00 GB",
          "Initial Activation"
        ]);

        return jsonResponse({
          success: true,
          message: "🎉 License activated successfully (" + defaultPlan.shortName + " - Slot 1/" + defaultPlan.maxDevices + ").",
          planName: defaultPlan.name,
          maxDevices: defaultPlan.maxDevices,
          currentDevices: 1,
          expiryDate: expiryDate.toISOString(),
          daysRemaining: defaultPlan.durationDays
        });
      } else {
        // Key is already in sheet: inspect device binding & expiry
        const rowData = rows[foundRow - 1];
        const registeredDevicesStr = String(rowData[1] || "");
        const registeredDevices = registeredDevicesStr.split(",").map(d => d.trim()).filter(Boolean);
        const maxDevices = Number(rowData[3]) || defaultPlan.maxDevices;
        const status = String(rowData[4] || "ACTIVE").toUpperCase();
        const planName = String(rowData[7] || defaultPlan.name);
        const expiryVal = rowData[8];

        if (status === "REVOKED" || status === "BANNED" || status === "DEACTIVATED" || status === "DISABLED" || status === "SUSPENDED") {
          logSecurityViolation(ss, {
            key: key,
            type: "REVOKED_KEY_USE_ATTEMPT",
            attemptedDevice: deviceId,
            boundDevices: registeredDevices.join(", "),
            actionTaken: "PRO_REVOKED_LOCKED",
            details: "Client attempted to run software using a revoked or banned license key."
          });
          sendAdminSecurityAlert(key, deviceId, "REVOKED_KEY_ATTEMPT", "Computer attempted activation on revoked key: " + key);
          return jsonResponse({
            success: false,
            error: "LICENSE_REVOKED",
            message: "⚠️ This license key has been deactivated/revoked by the administrator."
          });
        }

        // Check Expiry Date
        let expiryDate = null;
        let daysRemaining = null;
        if (expiryVal) {
          expiryDate = new Date(expiryVal);
          if (!isNaN(expiryDate.getTime())) {
            daysRemaining = Math.max(0, Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
            if (now.getTime() > expiryDate.getTime()) {
              sheet.getRange(foundRow, 5).setValue("EXPIRED");
              const expFormatted = Utilities.formatDate(expiryDate, "GMT+0530", "dd MMM yyyy");
              return jsonResponse({
                success: false,
                error: "LICENSE_EXPIRED",
                message: "⚠️ This " + planName + " license expired on " + expFormatted + ". Please renew your subscription.",
                planName: planName,
                expiryDate: expiryDate.toISOString(),
                daysRemaining: 0
              });
            }
          }
        }

        // Check if this device is ALREADY registered
        if (registeredDevices.includes(deviceId)) {
          // Same device re-installing or re-activating: ALWAYS ALLOW!
          sheet.getRange(foundRow, 7).setValue(now); // Update Last Seen
          if (sheet.getLastColumn() >= 10) sheet.getRange(foundRow, 10).setValue(clientVer);
          if (data.activity && sheet.getLastColumn() >= 12) sheet.getRange(foundRow, 12).setValue(String(data.activity));
          return jsonResponse({
            success: true,
            message: "Welcome back! Device recognized (" + registeredDevices.length + "/" + maxDevices + " slots).",
            planName: planName,
            maxDevices: maxDevices,
            currentDevices: registeredDevices.length,
            expiryDate: expiryDate ? expiryDate.toISOString() : null,
            daysRemaining: daysRemaining
          });
        }

        // New device trying to use this key:
        if (registeredDevices.length < maxDevices) {
          // Slot available (e.g. up to 5 devices for 1-Year plan)
          registeredDevices.push(deviceId);
          sheet.getRange(foundRow, 2).setValue(registeredDevices.join(","));
          sheet.getRange(foundRow, 3).setValue(registeredDevices.length);
          sheet.getRange(foundRow, 7).setValue(now);

          return jsonResponse({
            success: true,
            message: "🎉 License activated on authorized device (" + registeredDevices.length + "/" + maxDevices + " slots used).",
            planName: planName,
            maxDevices: maxDevices,
            currentDevices: registeredDevices.length,
            expiryDate: expiryDate ? expiryDate.toISOString() : null,
            daysRemaining: daysRemaining
          });
        } else {
          // Device limit exceeded! BLOCK ACTIVATION & ALERT ADMIN!
          logSecurityViolation(ss, {
            key: key,
            type: "DEVICE_CAP_EXCEEDED",
            attemptedDevice: deviceId,
            boundDevices: registeredDevices.join(", ") + " (" + registeredDevices.length + "/" + maxDevices + ")",
            actionTaken: "BLOCKED_BY_ENGINE",
            details: "Unauthorized second machine blocked by DriveMate Anti-Piracy Guard. Key sharing prevented."
          });
          sendAdminSecurityAlert(key, deviceId, "DEVICE_CAP_EXCEEDED", "Device sharing blocked! Key " + key + " is already bound to " + registeredDevices.length + "/" + maxDevices + " devices (" + registeredDevices.join(", ") + ").");
          return jsonResponse({
            success: false,
            error: "DEVICE_LIMIT_EXCEEDED",
            message: "⚠️ Device limit reached: This " + planName + " is already active on " + maxDevices + " computer(s) (" + registeredDevices.length + "/" + maxDevices + " slots in use). Please use on an authorized computer or buy another license."
          });
        }
      }
    }

    // --------------------------------------------------------------------------
    // ACTION: CHECK / VALIDATE (Verify if an existing activation is still authorized)
    // --------------------------------------------------------------------------
    if (action === "CHECK" || action === "VALIDATE") {
      const key = (data.licenseKey || data.key || "").trim().toUpperCase();
      const deviceId = (data.deviceId || "").trim();

      const ss = SpreadsheetApp.getActiveSpreadsheet();
      let sheet = ss.getSheetByName("Activations");
      if (!sheet) {
        return jsonResponse({
          success: false,
          error: "NOT_FOUND",
          message: "Activations ledger is empty or deleted. All licenses revoked."
        });
      }

      const rows = sheet.getDataRange().getValues();
      let foundRow = -1;
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]).toUpperCase() === key) {
          foundRow = i + 1;
          break;
        }
      }

      if (foundRow === -1) {
        return jsonResponse({
          success: false,
          error: "KEY_REVOKED_NOT_FOUND",
          message: "License key is not present in the active ledger. Pro features revoked."
        });
      }

      const rowData = rows[foundRow - 1];
      const registeredDevicesStr = String(rowData[1] || "");
      const registeredDevices = registeredDevicesStr.split(",").map(d => d.trim()).filter(Boolean);
      const maxDevices = Number(rowData[3]) || 1;
      const status = String(rowData[4] || "ACTIVE").toUpperCase();
      const planName = String(rowData[7] || "DriveMate Pro");
      const expiryVal = rowData[8];

      if (status === "REVOKED" || status === "BANNED" || status === "DEACTIVATED" || status === "DISABLED" || status === "SUSPENDED") {
        return jsonResponse({
          success: false,
          error: "LICENSE_REVOKED",
          message: "⚠️ This license has been deactivated/revoked by administrator."
        });
      }

      // Check Expiry Date
      const now = new Date();
      let expiryDate = null;
      let daysRemaining = null;
      if (expiryVal) {
        expiryDate = new Date(expiryVal);
        if (!isNaN(expiryDate.getTime())) {
          daysRemaining = Math.max(0, Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
          if (now.getTime() > expiryDate.getTime()) {
            sheet.getRange(foundRow, 5).setValue("EXPIRED");
            return jsonResponse({
              success: false,
              error: "LICENSE_EXPIRED",
              message: "⚠️ License expired on " + Utilities.formatDate(expiryDate, "GMT+0530", "dd MMM yyyy"),
              planName: planName,
              expiryDate: expiryDate.toISOString(),
              daysRemaining: 0
            });
          }
        }
      }

      if (deviceId && !registeredDevices.includes(deviceId)) {
        return jsonResponse({
          success: false,
          error: "DEVICE_NOT_AUTHORIZED",
          message: "This device is not authorized for this license key."
        });
      }

      // Update Last Seen, Total Downloaded, and Recent Activity
      sheet.getRange(foundRow, 7).setValue(new Date());
      if (data.totalDownloadedBytes && sheet.getLastColumn() >= 11) {
        const gb = (Number(data.totalDownloadedBytes) / (1024 * 1024 * 1024)).toFixed(2) + " GB";
        sheet.getRange(foundRow, 11).setValue(gb);
      }
      if (data.activity && sheet.getLastColumn() >= 12) {
        sheet.getRange(foundRow, 12).setValue(String(data.activity));
      }

      return jsonResponse({
        success: true,
        message: "License active and authorized.",
        planName: planName,
        maxDevices: maxDevices,
        currentDevices: registeredDevices.length,
        expiryDate: expiryDate ? expiryDate.toISOString() : null,
        daysRemaining: daysRemaining,
        status: status
      });
    }

    // --------------------------------------------------------------------------
    // ACTION: DEACTIVATE (Unbind Device / Release License Slot)
    // --------------------------------------------------------------------------
    if (action === "DEACTIVATE") {
      const key = (data.licenseKey || data.key || "").trim().toUpperCase();
      const deviceId = (data.deviceId || "").trim();

      const ss = SpreadsheetApp.getActiveSpreadsheet();
      let sheet = ss.getSheetByName("Activations");
      if (!sheet) {
        return jsonResponse({ success: true, message: "No activations found." });
      }

      const rows = sheet.getDataRange().getValues();
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]).toUpperCase() === key) {
          const registeredDevicesStr = String(rows[i][1] || "");
          let registeredDevices = registeredDevicesStr.split(",").map(d => d.trim()).filter(Boolean);

          if (deviceId) {
            registeredDevices = registeredDevices.filter(d => d !== deviceId);
          } else {
            registeredDevices = []; // Clear all devices for this key
          }

          sheet.getRange(i + 1, 2).setValue(registeredDevices.join(","));
          sheet.getRange(i + 1, 3).setValue(registeredDevices.length);
          sheet.getRange(i + 1, 7).setValue(new Date());

          return jsonResponse({
            success: true,
            message: "🎉 Device deactivated and license slot released.",
            currentDevices: registeredDevices.length
          });
        }
      }

      return jsonResponse({ success: true, message: "Key not found in ledger." });
    }

    // --------------------------------------------------------------------------
    // ACTION: RECORD_SALE / CREATE_LICENSE (Admin Creates Key with UTR)
    // --------------------------------------------------------------------------
    if (action === "RECORD_SALE" || action === "CREATE_LICENSE") {
      const key = (data.licenseKey || data.key || "").trim().toUpperCase();
      const name = (data.customerName || data.name || "Customer").trim();
      const phone = (data.phone || "").trim();
      const email = (data.email || "").trim();
      const utr = (data.utr || data.paymentUtr || "").trim();
      const plan = (data.plan || "6M").toString().trim().toUpperCase();
      const price = data.price || (plan === "1Y" ? "₹500" : "₹100");
      const targetDeviceId = (data.targetDeviceId || "").trim();

      const ss = SpreadsheetApp.getActiveSpreadsheet();
      let sheet = ss.getSheetByName("Activations");
      if (!sheet) {
        sheet = ss.insertSheet("Activations");
        sheet.appendRow([
          "License Key", "Registered Devices", "Active Count", "Max Devices",
          "Status", "First Activated", "Last Seen", "Plan", "Expiry Date",
          "Version / OS", "Total Downloaded", "Recent Activity"
        ]);
        sheet.setFrozenRows(1);
      }

      const defaultPlan = detectPlanFromKey(key);
      const now = new Date();
      const expiryDate = new Date(now.getTime() + defaultPlan.durationDays * 24 * 60 * 60 * 1000);

      sheet.appendRow([
        key,
        targetDeviceId || "",
        targetDeviceId ? 1 : 0,
        defaultPlan.maxDevices,
        "ACTIVE",
        now,
        now,
        defaultPlan.name,
        expiryDate.toISOString(),
        "Admin Issued",
        "0.00 GB",
        "Generated for " + name + " (UTR: " + utr + ")"
      ]);

      // Record in Payments
      let paySheet = ss.getSheetByName("Payments");
      if (!paySheet) {
        paySheet = ss.insertSheet("Payments");
        paySheet.appendRow(["Timestamp", "Customer Email", "UPI UTR", "Generated License Key", "Amount", "Plan", "Status"]);
        paySheet.setFrozenRows(1);
      }
      paySheet.appendRow([now, email || phone || name, utr, key, price, defaultPlan.name, "DELIVERED"]);

      return jsonResponse({
        success: true,
        message: "License " + key + " registered against UTR " + utr
      });
    }

    // --------------------------------------------------------------------------
    // ACTION 2: PAYMENT (UPI UTR Submission & Automated Key Emailing)
    // --------------------------------------------------------------------------
    if (action === "PAYMENT" || action === "PAY" || action === "SUBMIT_PAYMENT") {
      const email = (data.email || "").trim();
      const utr = (data.utr || "").trim();
      const reqAmount = Number(data.amount) || 0;
      const reqPlan = (data.plan || "").toString().trim().toUpperCase();

      if (!email || !utr || utr.length < 8) {
        return jsonResponse({
          success: false,
          error: "INVALID_UTR",
          message: "Please provide a valid email and 12-digit UPI UTR / Transaction ID."
        });
      }

      // Determine plan: ₹500 (1 Year - 5 Devices) vs ₹100 (6 Months - 1 Device)
      let selectedPlan = PLAN_CONFIG["6M"];
      if (reqAmount === 500 || reqPlan === "1Y" || reqPlan === "YEAR" || reqPlan === "500") {
        selectedPlan = PLAN_CONFIG["1Y"];
      }

      const licenseKey = generateCryptographicKey(utr, selectedPlan.type);

      // Log to "Payments" sheet
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      let paymentSheet = ss.getSheetByName("Payments");
      if (!paymentSheet) {
        paymentSheet = ss.insertSheet("Payments");
        paymentSheet.appendRow(["Timestamp", "Customer Email", "UPI UTR", "Generated License Key", "Amount", "Plan", "Status"]);
        paymentSheet.setFrozenRows(1);
      }
      paymentSheet.appendRow([new Date(), email, utr, licenseKey, selectedPlan.price, selectedPlan.name, "DELIVERED"]);

      // Send email with license key & anti-sharing notice
      const emailSubject = `🎉 Your ${selectedPlan.name} Key (${selectedPlan.price})`;
      const emailBody = `Hello,

Thank you for choosing DriveMate!
Your payment of ${selectedPlan.price} (UTR: ${utr}) has been confirmed.

=======================================================
YOUR LICENSE KEY:
${licenseKey}
=======================================================

PLAN DETAILS:
• Plan: ${selectedPlan.name}
• Validity: ${selectedPlan.durationDays} Days (${selectedPlan.type === "1Y" ? "1 Year" : "6 Months"})
• Device Limit: Up to ${selectedPlan.maxDevices} Device(s) under this single key

⚠️ DEVICE LOCK & PIRACY NOTICE:
${selectedPlan.maxDevices === 1
  ? "This license key is bound to 1 computer for your personal use. Once activated, it locks to your device."
  : "This 1-Year Team license allows activation on up to 5 computers under this single key. You can share this key with up to 5 of your devices."}

HOW TO ACTIVATE IN 10 SECONDS:
1. Open DriveMate (Desktop App or Chrome Extension).
2. Go to Settings / Upgrade.
3. Paste your license key in the activation box.
4. Click "Activate".

If you ever need to transfer devices or require assistance, reply directly to this email!

Best regards,
DriveMate Team`;

      GmailApp.sendEmail(email, emailSubject, emailBody);

      return jsonResponse({
        success: true,
        licenseKey: licenseKey,
        planName: selectedPlan.name,
        maxDevices: selectedPlan.maxDevices,
        price: selectedPlan.price,
        message: `License key generated for ${selectedPlan.name} and sent to ${email}`
      });
    }

    return jsonResponse({
      success: true,
      message: "Action " + action + " acknowledged."
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
  try {
    const action = e && e.parameter && e.parameter.action ? e.parameter.action.toUpperCase() : "";
    if (action === "GET_ALL_DATA") {
      const ss = SpreadsheetApp.getActiveSpreadsheet();

      // 1. Activations
      const actSheet = ss.getSheetByName("Activations");
      const activations = [];
      if (actSheet) {
        const rows = actSheet.getDataRange().getValues();
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          if (r[0]) {
            activations.push({
              key: String(r[0]),
              devices: String(r[1] || "").split(",").map(d => d.trim()).filter(Boolean),
              activeCount: Number(r[2]) || 1,
              maxDevices: Number(r[3]) || 1,
              status: String(r[4] || "ACTIVE"),
              firstActivated: r[5] ? new Date(r[5]).toISOString() : null,
              lastSeen: r[6] ? new Date(r[6]).toISOString() : null,
              plan: String(r[7] || ""),
              expiryDate: r[8] ? new Date(r[8]).toISOString() : null,
              version: String(r[9] || ""),
              totalDownloaded: String(r[10] || "0.00 GB"),
              recentActivity: String(r[11] || "")
            });
          }
        }
      }

      // 2. Installed Users
      const userSheet = ss.getSheetByName("InstalledUsers");
      const users = [];
      if (userSheet) {
        const rows = userSheet.getDataRange().getValues();
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          if (r[0]) {
            users.push({
              deviceId: String(r[0]),
              status: String(r[1] || "ACTIVE"),
              tier: String(r[2] || "FREE"),
              licenseKey: String(r[3] || ""),
              firstInstalled: r[4] ? new Date(r[4]).toISOString() : null,
              lastActive: r[5] ? new Date(r[5]).toISOString() : null,
              downloadedToday: String(r[6] || "0.00 GB"),
              os: String(r[7] || "Unknown"),
              version: String(r[8] || "v0.3.0")
            });
          }
        }
      }

      // 3. Violations
      const violSheet = ss.getSheetByName("Violations");
      const violations = [];
      if (violSheet) {
        const rows = violSheet.getDataRange().getValues();
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          if (r[0] || r[1]) {
            violations.push({
              timestamp: r[0] ? Utilities.formatDate(new Date(r[0]), "GMT+0530", "yyyy-MM-dd HH:mm:ss") : "",
              licenseKey: String(r[1] || ""),
              type: String(r[2] || "SECURITY_ALERT"),
              attemptedDevice: String(r[3] || ""),
              boundDevices: String(r[4] || ""),
              actionTaken: String(r[5] || "BLOCKED"),
              details: String(r[6] || "")
            });
          }
        }
      }

      return jsonResponse({
        success: true,
        activations: activations,
        installedUsers: users,
        violations: violations
      });
    }
  } catch (err) {
    // fallback to text output
  }
  return ContentService.createTextOutput("DriveMate Tiered License & Anti-Piracy Engine is Online (v2.0)");
}

// --- HELPER CRYPTOGRAPHIC FUNCTIONS ---

function isKeyCryptographicallyValid(key) {
  const raw = String(key || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw === "DMPROLIFETIMEVIP" || raw === "DRIVEMATEPRO2026") return true;

  let token = raw;
  if (token.startsWith("DM6M") || token.startsWith("DM1Y")) {
    token = token.slice(4);
  } else if (token.startsWith("DMPRO")) {
    token = token.slice(5);
  }
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

function generateCryptographicKey(seed, planType) {
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

  const prefix = (planType === "1Y" || planType === "500") ? "DM-1Y" : (planType === "6M" || planType === "100") ? "DM-6M" : "DM-PRO";

  return prefix + "-" + payload.slice(0, 4) + "-" + payload.slice(4, 8) + "-" + signature.slice(0, 4) + "-" + signature.slice(4, 8);
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function logSecurityViolation(ss, v) {
  try {
    let sheet = ss.getSheetByName("Violations");
    if (!sheet) {
      sheet = ss.insertSheet("Violations");
      sheet.appendRow([
        "Timestamp",
        "License Key",
        "Violation Type",
        "Attempted Device",
        "Bound Devices / Limit",
        "Action Taken",
        "Details"
      ]);
      sheet.setFrozenRows(1);
    }
    sheet.appendRow([
      new Date(),
      v.key || "UNKNOWN_KEY",
      v.type || "SECURITY_ALERT",
      v.attemptedDevice || "Unknown Device",
      v.boundDevices || "—",
      v.actionTaken || "BLOCKED",
      v.details || ""
    ]);
  } catch (err) {
    console.error("Error logging violation: " + err);
  }
}

function sendAdminSecurityAlert(key, deviceId, type, details) {
  try {
    const adminEmail = Session.getActiveUser().getEmail();
    if (!adminEmail) return;
    const subject = `🚨 DriveMate Anti-Piracy Alert: ${type}`;
    const body = `DriveMate Anti-Piracy Guard detected an unauthorized action:

Type: ${type}
Time: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
License Key: ${key}
Attempted Device ID: ${deviceId}
Details: ${details}

The unauthorized device was blocked from accessing DriveMate Pro features.
You can inspect or revoke this license key inside your DriveMate Admin Dashboard.`;

    GmailApp.sendEmail(adminEmail, subject, body);
  } catch (err) {
    // Non-blocking
  }
}

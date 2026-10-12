# Privacy Policy for DriveMate

*Last updated: October 12, 2026*

This Privacy Policy explains how **DriveMate** ("we", "our", or "the extension") handles user information and data.

---

### 1. Summary

DriveMate is designed with a **privacy-first, zero-login architecture**:
- **No Google Account Login Required**: DriveMate does not ask for, collect, store, or transmit your Google account credentials, passwords, OAuth tokens, or session cookies.
- **No Personal Data Collection**: We do not collect names, email addresses, phone numbers, IP addresses, or device identifiers.
- **No Analytics or Tracking**: DriveMate contains zero advertising trackers, analytics SDKs, telemetry beacons, or third-party cookies.
- **Local Device Storage Only**: Downloaded files and user preferences (such as your chosen destination path and concurrency settings) remain strictly on your local machine.

---

### 2. Information Handled by the Extension

#### A. Public Google Drive URLs
When you paste or enter a public Google Drive folder link, the extension inspects the directory metadata (file names, media categories, and file sizes) solely to display the folder preview and initiate your requested downloads. This data is processed locally in your browser and is never uploaded or transmitted to any external server.

#### B. Local Configuration & Job State
The extension uses Chrome's local storage API (`chrome.storage.local`) exclusively to:
- Remember your preferred download folder path.
- Remember your selected multi-stream concurrency setting.
- Track active download job progress so you can monitor downloads across browser popup reloads.

This data never leaves your device.

#### C. Local Native Helper Companion
If you use the optional local companion helper (`DriveMateHelper`), communication between the browser extension and the local helper occurs strictly over your machine's standard input/output (`stdio`) native messaging channel. The helper does not run any remote web servers, external APIs, or cloud sync services.

---

### 3. Third-Party Services & Data Sharing

DriveMate does not sell, rent, monetize, or share any user data with third parties.
- We do not partner with data brokers.
- We do not serve advertisements.
- We do not use third-party analytics platforms (such as Google Analytics or Mixpanel).

---

### 4. Permissions Used & Justification

- **`nativeMessaging`**: Used solely to communicate with your local machine's native helper application for high-speed multi-stream disk writing.
- **`activeTab`**: Used only when you interact with the extension to read the URL of an active public Google Drive tab.
- **`storage` & `unlimitedStorage`**: Used to save your local preferences and manage in-memory job queues for large file batches.
- **`alarms`**: Used to maintain periodic progress checks during active background downloads.
- **Host Permissions (`drive.google.com`, `googleusercontent.com`, `docs.google.com`)**: Used exclusively to query public folder contents and stream file data directly from Google's servers to your local computer.

---

### 5. Children's Privacy

DriveMate does not knowingly collect or solicit any personal information from children under the age of 13.

---

### 6. Changes to This Policy

If we update DriveMate's features or data practices, we will update the date at the top of this policy. Substantial changes will be reflected in extension release notes.

---

### 7. Contact Us

If you have questions or feedback about DriveMate's privacy practices:
- **Email**: `support@drivemate.app`
- **GitHub**: `https://github.com/gobindabiswas/drivemate`

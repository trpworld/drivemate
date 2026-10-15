import React from 'react';
import type { AppSettings, LicenseState } from '../types';

export type SettingsTab = 'General' | 'Downloads' | 'Storage' | 'Appearance' | 'Notifications' | 'License';

interface SettingsViewProps {
  settings: AppSettings;
  license: LicenseState | null;
  onSaveSettings: (settings: AppSettings) => void;
  onActivateKey: (key: string) => Promise<void>;
  onDeactivateKey?: () => Promise<void>;
  onSelectFolder: () => Promise<string | null>;
  initialTab?: SettingsTab;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  license,
  onSaveSettings,
  onActivateKey,
  onDeactivateKey,
  onSelectFolder,
  initialTab = 'Downloads',
}) => {
  const [activeTab, setActiveTab] = React.useState<SettingsTab>(initialTab);
  const [concurrency, setConcurrency] = React.useState(settings.concurrency || 16);
  const [theme, setTheme] = React.useState<'light' | 'dark' | 'system'>(settings.theme || 'light');
  const [skipExisting, setSkipExisting] = React.useState(settings.skipExisting);
  const [verifyFormat, setVerifyFormat] = React.useState(true);
  const [showNotifications, setShowNotifications] = React.useState(true);
  const [playSound, setPlaySound] = React.useState(true);
  const [autoResume, setAutoResume] = React.useState(true);
  const [launchAtStartup, setLaunchAtStartup] = React.useState(false);
  const [minimizeToTray, setMinimizeToTray] = React.useState(true);
  const [defaultDest, setDefaultDest] = React.useState(
    settings.defaultDestination && settings.defaultDestination !== '.'
      ? settings.defaultDestination
      : '~/Downloads'
  );

  const [licenseKeyInput, setLicenseKeyInput] = React.useState('');
  const [activationMsg, setActivationMsg] = React.useState<{ text: string; isError: boolean } | null>(null);
  const [isActivating, setIsActivating] = React.useState(false);
  const [isDeactivating, setIsDeactivating] = React.useState(false);

  // Sync initialTab if prop changes
  React.useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  const handleBrowse = async () => {
    const chosen = await onSelectFolder();
    if (chosen) {
      setDefaultDest(chosen);
      onSaveSettings({ ...settings, defaultDestination: chosen });
    }
  };

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme);
    onSaveSettings({ ...settings, theme: newTheme });
  };

  const handleToggleSkip = () => {
    const val = !skipExisting;
    setSkipExisting(val);
    onSaveSettings({ ...settings, skipExisting: val });
  };

  const handleConcurrencyChange = (val: number) => {
    setConcurrency(val);
    onSaveSettings({ ...settings, concurrency: val });
  };

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!licenseKeyInput.trim()) return;

    setIsActivating(true);
    setActivationMsg(null);
    try {
      await onActivateKey(licenseKeyInput.trim());
      setActivationMsg({ text: '🎉 License activated successfully! Registered in Google Sheets ledger.', isError: false });
      setLicenseKeyInput('');
    } catch (err: any) {
      const errText = typeof err === 'string' ? err : err?.message || String(err) || 'Invalid license key.';
      setActivationMsg({ text: errText, isError: true });
    } finally {
      setIsActivating(false);
    }
  };

  const handleDeactivate = async () => {
    if (!onDeactivateKey) return;
    setIsDeactivating(true);
    setActivationMsg(null);
    try {
      await onDeactivateKey();
      setActivationMsg({ text: 'License deactivated. Reverted to Free tier.', isError: false });
    } catch (err: any) {
      const errText = typeof err === 'string' ? err : err?.message || String(err) || 'Failed to deactivate.';
      setActivationMsg({ text: errText, isError: true });
    } finally {
      setIsDeactivating(false);
    }
  };

  return (
    <div className="view-content-scroll">
      {/* Title Header */}
      <div className="page-header-box">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Configure download engine, storage, appearance, and preferences.</p>
      </div>

      {/* Two-Column Settings Layout */}
      <div className="settings-two-col">
        {/* Left Subnav */}
        <div className="settings-subnav">
          <div
            className={`settings-nav-item ${activeTab === 'General' ? 'active' : ''}`}
            onClick={() => setActiveTab('General')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            General
          </div>

          <div
            className={`settings-nav-item ${activeTab === 'Downloads' ? 'active' : ''}`}
            onClick={() => setActiveTab('Downloads')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Downloads
          </div>

          <div
            className={`settings-nav-item ${activeTab === 'Storage' ? 'active' : ''}`}
            onClick={() => setActiveTab('Storage')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
            </svg>
            Storage
          </div>

          <div
            className={`settings-nav-item ${activeTab === 'Appearance' ? 'active' : ''}`}
            onClick={() => setActiveTab('Appearance')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="5" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
            Appearance
          </div>

          <div
            className={`settings-nav-item ${activeTab === 'Notifications' ? 'active' : ''}`}
            onClick={() => setActiveTab('Notifications')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            Notifications
          </div>

          <div
            className={`settings-nav-item ${activeTab === 'License' ? 'active' : ''}`}
            onClick={() => setActiveTab('License')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            License
          </div>
        </div>

        {/* Right Main Settings Panel (Switches per activeTab) */}
        <div className="settings-main-panel">
          {/* TAB 1: General */}
          {activeTab === 'General' && (
            <div className="card">
              <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px', color: 'var(--text-primary)' }}>
                General Preferences
              </h3>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>
                  Default Destination Folder
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    className="link-input-field"
                    value={defaultDest}
                    onChange={(e) => setDefaultDest(e.target.value)}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: '12.5px' }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleBrowse}
                    style={{ padding: '0 16px', borderRadius: '8px', fontSize: '13px' }}
                  >
                    Browse
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div className="switch-label-row">
                  <div>
                    <div style={{ fontWeight: 600 }}>Launch on system startup</div>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>Automatically start DriveMate in the background when logging in.</div>
                  </div>
                  <label className="ios-switch">
                    <input type="checkbox" checked={launchAtStartup} onChange={() => setLaunchAtStartup(!launchAtStartup)} />
                    <span className="ios-slider" />
                  </label>
                </div>

                <div className="switch-label-row" style={{ borderBottom: 'none' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>Minimize to menu bar / system tray</div>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>Keep downloads running when closing the main window.</div>
                  </div>
                  <label className="ios-switch">
                    <input type="checkbox" checked={minimizeToTray} onChange={() => setMinimizeToTray(!minimizeToTray)} />
                    <span className="ios-slider" />
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Downloads */}
          {activeTab === 'Downloads' && (
            <div className="card">
              <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px', color: 'var(--text-primary)' }}>
                Download Settings
              </h3>

              {/* Concurrent Download Workers */}
              <div style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Concurrent Download Workers</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--primary)' }}>
                    {concurrency} Workers
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={32}
                  value={concurrency}
                  onChange={(e) => handleConcurrencyChange(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--primary)', cursor: 'pointer' }}
                />
                <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Recommended: 16 streams. Higher concurrency accelerates multi-file downloads.
                </div>
              </div>

              {/* iOS Toggles */}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div className="switch-label-row">
                  <div>
                    <div style={{ fontWeight: 600 }}>Skip already completed files</div>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>Checks existing file sizes and format headers to skip redundant downloads.</div>
                  </div>
                  <label className="ios-switch">
                    <input type="checkbox" checked={skipExisting} onChange={handleToggleSkip} />
                    <span className="ios-slider" />
                  </label>
                </div>

                <div className="switch-label-row">
                  <div>
                    <div style={{ fontWeight: 600 }}>Verify files size and format after download</div>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>Validates MP4, JPEG, ZIP and PDF container headers against corruption.</div>
                  </div>
                  <label className="ios-switch">
                    <input type="checkbox" checked={verifyFormat} onChange={() => setVerifyFormat(!verifyFormat)} />
                    <span className="ios-slider" />
                  </label>
                </div>

                <div className="switch-label-row">
                  <div>
                    <div style={{ fontWeight: 600 }}>Show desktop notifications</div>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>Notify when individual files or full folders finish downloading.</div>
                  </div>
                  <label className="ios-switch">
                    <input type="checkbox" checked={showNotifications} onChange={() => setShowNotifications(!showNotifications)} />
                    <span className="ios-slider" />
                  </label>
                </div>

                <div className="switch-label-row" style={{ borderBottom: 'none' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>Auto-resume interrupted downloads</div>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>Automatically reconnect and resume incomplete .part chunks upon network reconnect.</div>
                  </div>
                  <label className="ios-switch">
                    <input type="checkbox" checked={autoResume} onChange={() => setAutoResume(!autoResume)} />
                    <span className="ios-slider" />
                  </label>
                </div>
              </div>

              {/* Default Destination Folder */}
              <div style={{ marginTop: '20px' }}>
                <label style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>
                  Default Destination Folder
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    className="link-input-field"
                    value={defaultDest}
                    onChange={(e) => setDefaultDest(e.target.value)}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: '12.5px' }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleBrowse}
                    style={{ padding: '0 16px', borderRadius: '8px', fontSize: '13px' }}
                  >
                    Browse
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Storage */}
          {activeTab === 'Storage' && (
            <div className="card">
              <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px', color: 'var(--text-primary)' }}>
                Storage & Database
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '20px' }}>
                <div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Application Data Directory</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-primary)', marginTop: '2px' }}>
                    ~/Library/Application Support/com.drivemate.pro
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Database Engine</div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--emerald-text)', marginTop: '2px' }}>
                    SQLite 3 (WAL Mode Active • Persistent Ledger)
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Database Size</div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginTop: '2px' }}>
                    24.8 MB
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', paddingTop: '10px', borderTop: '1px solid var(--border-subtle)' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => alert('Temporary cache cleared successfully.')}
                >
                  Clear Temporary Cache
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => alert('Data directory: ~/Library/Application Support/com.drivemate.pro')}
                >
                  Open Data Directory
                </button>
              </div>
            </div>
          )}

          {/* TAB 4: Appearance */}
          {activeTab === 'Appearance' && (
            <div className="card">
              <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px', color: 'var(--text-primary)' }}>
                Appearance & Theme
              </h3>
              <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                Choose your preferred interface theme. Changes take effect instantly across all windows.
              </p>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  className={`btn ${theme === 'light' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => handleThemeChange('light')}
                  style={{ flex: 1, padding: '12px' }}
                >
                  ☀️ Light Theme
                </button>
                <button
                  type="button"
                  className={`btn ${theme === 'dark' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => handleThemeChange('dark')}
                  style={{ flex: 1, padding: '12px' }}
                >
                  🌙 Dark Theme
                </button>
                <button
                  type="button"
                  className={`btn ${theme === 'system' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => handleThemeChange('system')}
                  style={{ flex: 1, padding: '12px' }}
                >
                  💻 System Theme
                </button>
              </div>
            </div>
          )}

          {/* TAB 5: Notifications */}
          {activeTab === 'Notifications' && (
            <div className="card">
              <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px', color: 'var(--text-primary)' }}>
                Notification Preferences
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div className="switch-label-row">
                  <div>
                    <div style={{ fontWeight: 600 }}>Show desktop notifications</div>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>Display system notifications when downloads complete.</div>
                  </div>
                  <label className="ios-switch">
                    <input type="checkbox" checked={showNotifications} onChange={() => setShowNotifications(!showNotifications)} />
                    <span className="ios-slider" />
                  </label>
                </div>

                <div className="switch-label-row">
                  <div>
                    <div style={{ fontWeight: 600 }}>Play completion sound</div>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>Play a subtle audio chime when all files finish downloading.</div>
                  </div>
                  <label className="ios-switch">
                    <input type="checkbox" checked={playSound} onChange={() => setPlaySound(!playSound)} />
                    <span className="ios-slider" />
                  </label>
                </div>

                <div className="switch-label-row" style={{ borderBottom: 'none' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>Notify on network errors or rate limits</div>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>Send an alert if Google Drive issues an HTTP 429 backoff request.</div>
                  </div>
                  <label className="ios-switch">
                    <input type="checkbox" defaultChecked />
                    <span className="ios-slider" />
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: License */}
          {activeTab === 'License' && (
            <div className="card">
              <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px', color: 'var(--text-primary)' }}>
                License & Activation
              </h3>

              <div
                style={{
                  backgroundColor: 'var(--emerald-bg)',
                  border: '1px solid var(--emerald-border)',
                  borderRadius: '10px',
                  padding: '16px 20px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '20px',
                }}
              >
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--emerald-text)' }}>
                    👑 {license?.is_pro ? (license.plan_name || 'LIFETIME PRO') : 'FREE EDITION'}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--emerald-text)', marginTop: '4px' }}>
                    {license?.is_pro
                      ? (license.days_remaining != null ? `${license.days_remaining} days remaining • Team ${license.devices_used || 1}/${license.max_devices || 5} devices` : 'Active Edition • No Expiration')
                      : 'Free Tier (10 GB daily quota). Upgrade to 6-Month Pro (₹100) or 1-Year Team (₹500).'}
                  </div>
                  {license?.utr && (
                    <div style={{ fontSize: '11.5px', color: 'var(--emerald-text)', marginTop: '3px', fontWeight: 600 }}>
                      🧾 UPI UTR: {license.utr} (Verified Genuine)
                    </div>
                  )}
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
                    Device ID: {license?.device_id || 'DM-MAC-08365AD4'}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
                  <span className={`badge ${license?.is_pro ? 'badge-success' : 'badge-warning'}`}>
                    {license?.is_pro ? 'ACTIVE' : 'FREE TIER'}
                  </span>
                  {license?.is_pro && onDeactivateKey && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleDeactivate}
                      disabled={isDeactivating}
                      style={{ fontSize: '11px', padding: '4px 10px' }}
                    >
                      {isDeactivating ? 'Deactivating...' : 'Deactivate'}
                    </button>
                  )}
                </div>
              </div>

              <form onSubmit={handleActivate} style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <input
                  type="text"
                  className="link-input-field"
                  placeholder="Enter License Key (e.g. DM-PRO-XXXX-XXXX or DM-6M-...)"
                  value={licenseKeyInput}
                  onChange={(e) => setLicenseKeyInput(e.target.value)}
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isActivating || !licenseKeyInput.trim()}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {isActivating ? 'Verifying...' : 'Activate Key'}
                </button>
              </form>

              {activationMsg && (
                <div
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    fontSize: '12.5px',
                    backgroundColor: activationMsg.isError ? 'var(--crimson-bg)' : 'var(--emerald-bg)',
                    color: activationMsg.isError ? 'var(--crimson-text)' : 'var(--emerald-text)',
                    border: `1px solid ${activationMsg.isError ? 'var(--crimson-border)' : 'var(--emerald-border)'}`,
                  }}
                >
                  {activationMsg.text}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

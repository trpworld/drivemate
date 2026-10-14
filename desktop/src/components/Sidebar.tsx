import React from 'react';
import type { LicenseState } from '../types';
import type { SettingsTab } from './SettingsView';

export type ViewType =
  | 'dashboard'
  | 'new-download'
  | 'active'
  | 'completed'
  | 'history'
  | 'settings'
  | 'diagnostics';

interface SidebarProps {
  currentView: ViewType;
  onSelectView: (view: ViewType, subTab?: SettingsTab) => void;
  license?: LicenseState | null;
  activeCount: number;
  concurrency?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onSelectView,
  activeCount,
}) => {

  return (
    <aside className="app-sidebar" data-tauri-drag-region>
      {/* Brand Header */}
      <div
        className="brand-header-area"
        style={{ padding: '24px 20px 18px 20px', cursor: 'pointer' }}
        onClick={() => onSelectView('dashboard')}
      >
        <div
          className="brand-logo-wrapper"
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '9px',
            overflow: 'hidden',
            boxShadow: '0 0 14px rgba(56, 189, 248, 0.45)',
            background: '#0f172a',
            border: '1px solid rgba(56, 189, 248, 0.35)',
            flexShrink: 0,
          }}
        >
          <img
            src="/icons/icon-128.png"
            alt="DriveMate Logo"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        </div>
        <div className="brand-title-meta">
          <div className="brand-title-line">
            <span className="brand-main-name">DriveMate</span>
          </div>
          <span className="brand-subtext">Google Drive Downloader</span>
        </div>
      </div>

      {/* Navigation Menu */}
      <ul className="nav-menu-list">
        <li
          className={`nav-menu-item ${currentView === 'dashboard' ? 'active' : ''}`}
          onClick={() => onSelectView('dashboard')}
        >
          <span className="nav-menu-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
            </svg>
          </span>
          Dashboard
        </li>

        <li
          className={`nav-menu-item ${currentView === 'new-download' ? 'active' : ''}`}
          onClick={() => onSelectView('new-download')}
        >
          <span className="nav-menu-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </span>
          New Download
        </li>

        <li
          className={`nav-menu-item ${currentView === 'active' ? 'active' : ''}`}
          onClick={() => onSelectView('active')}
        >
          <span className="nav-menu-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </span>
          Active Downloads
          {activeCount > 0 && <span className="nav-count-badge">{activeCount}</span>}
        </li>

        <li
          className={`nav-menu-item ${currentView === 'completed' ? 'active' : ''}`}
          onClick={() => onSelectView('completed')}
        >
          <span className="nav-menu-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <polyline points="9 12 11 14 15 10" />
            </svg>
          </span>
          Completed
        </li>

        <li
          className={`nav-menu-item ${currentView === 'history' ? 'active' : ''}`}
          onClick={() => onSelectView('history')}
        >
          <span className="nav-menu-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <polyline points="12 7 12 12 15 14" />
            </svg>
          </span>
          History
        </li>

        <li
          className={`nav-menu-item ${currentView === 'settings' ? 'active' : ''}`}
          onClick={() => onSelectView('settings')}
        >
          <span className="nav-menu-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </span>
          Settings
        </li>

        <li
          className={`nav-menu-item ${currentView === 'diagnostics' ? 'active' : ''}`}
          onClick={() => onSelectView('diagnostics')}
        >
          <span className="nav-menu-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </span>
          Diagnostics
        </li>
      </ul>
    </aside>
  );
};

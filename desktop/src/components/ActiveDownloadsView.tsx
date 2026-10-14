import React from 'react';
import type { FileEvent, JobProgressEvent } from '../types';
import { formatBytes, formatSpeed } from '../utils/formatters';

interface ActiveDownloadsViewProps {
  activeJobId: string | null;
  progress: JobProgressEvent | null;
  fileEvents: FileEvent[];
  isPaused: boolean;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onNavigate: (view: 'completed' | 'new-download') => void;
  concurrency?: number;
}

export const ActiveDownloadsView: React.FC<ActiveDownloadsViewProps> = ({
  activeJobId,
  progress,
  fileEvents = [],
  isPaused,
  onPause,
  onResume,
  onCancel,
  onNavigate,
  concurrency = 16,
}) => {
  const isJobActive = Boolean(activeJobId || (progress && progress.status === 'RUNNING'));

  const overallBytes = progress?.overall_bytes || 0;
  const totalBytes = progress?.overall_total_bytes || 0;
  const pct = totalBytes > 0 ? Math.min(100, Math.round((overallBytes / totalBytes) * 100)) : 0;
  const currentSpeed = progress?.speed_bps || 0;
  const activeStreams = progress?.active_count || (isJobActive ? concurrency : 0);
  const completedCount = progress?.completed_count || 0;
  const totalFiles = progress?.total_files || 0;

  return (
    <div className="view-content-scroll">
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 className="page-title">Active Downloads</h1>
          <p className="page-subtitle">Real-time multi-threaded streaming progress.</p>
        </div>

        {isJobActive && (
          <div style={{ display: 'flex', gap: '8px' }}>
            {isPaused ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onResume}
                style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                Resume
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onPause}
                style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
                Pause
              </button>
            )}

            <button
              type="button"
              className="btn btn-secondary"
              onClick={onCancel}
              style={{ fontSize: '13px', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
              Cancel
            </button>
          </div>
        )}
      </div>

      {!isJobActive ? (
        /* Clean Empty State */
        <div
          className="card"
          style={{
            padding: '50px 24px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div
            style={{
              width: '52px',
              height: '52px',
              borderRadius: '14px',
              background: 'var(--bg-tertiary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
            }}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>
            No Active Downloads
          </h3>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', maxWidth: '420px', lineHeight: 1.5 }}>
            You do not have any downloads running right now. When you start downloading from Google Drive, live progress and speeds will stream here.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onNavigate('new-download')}
            style={{ marginTop: '10px', fontSize: '13px', padding: '8px 18px', borderRadius: '8px' }}
          >
            Start a New Download
          </button>
        </div>
      ) : (
        /* Real Active Streaming View */
        <>
          {/* 4 Metric KPI Cards */}
          <div className="stat-kpi-row" style={{ marginBottom: '20px' }}>
            <div className="kpi-card">
              <div className="kpi-icon-bubble blue">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              </div>
              <div className="kpi-content">
                <span className="kpi-label">Current Speed</span>
                <div className="kpi-value-row">
                  <span className="kpi-big-value">{formatSpeed(currentSpeed)}</span>
                </div>
                <span className="kpi-subtext">{activeStreams} active streams</span>
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-icon-bubble green">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div className="kpi-content">
                <span className="kpi-label">Files Completed</span>
                <div className="kpi-value-row">
                  <span className="kpi-big-value">{completedCount} <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>/ {totalFiles}</span></span>
                </div>
                <span className="kpi-subtext">{totalFiles - completedCount} files remaining</span>
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-icon-bubble indigo">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 19 19 12" />
                </svg>
              </div>
              <div className="kpi-content">
                <span className="kpi-label">Downloaded Data</span>
                <div className="kpi-value-row">
                  <span className="kpi-big-value">{formatBytes(overallBytes)}</span>
                </div>
                <span className="kpi-subtext">of {formatBytes(totalBytes)}</span>
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-icon-bubble slate">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
              <div className="kpi-content">
                <span className="kpi-label">Job Status</span>
                <div className="kpi-value-row">
                  <span className={`kpi-big-value ${isPaused ? 'amber' : 'green'}`}>
                    {isPaused ? 'Paused' : 'Streaming'}
                  </span>
                  {!isPaused && <span className="pulse-dot-green" />}
                </div>
                <span className="kpi-subtext">{isPaused ? 'Click Resume to continue' : 'Writing directly to disk'}</span>
              </div>
            </div>
          </div>

          {/* Overall Progress Card */}
          <div className="card" style={{ marginBottom: '20px', padding: '18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Overall Progress
              </span>
              <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--primary)' }}>
                {pct}%
              </span>
            </div>

            <div className="table-progress-bar-bg" style={{ height: '8px', borderRadius: '4px' }}>
              <div
                className="table-progress-bar-fill blue"
                style={{ width: `${pct}%`, height: '8px', borderRadius: '4px' }}
              />
            </div>
          </div>

          {/* Live Streaming Files List */}
          <div className="card" style={{ padding: '16px' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', color: 'var(--text-primary)' }}>
              Live File Activity ({fileEvents.length})
            </h3>

            {fileEvents.length === 0 ? (
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
                Connecting streams and preparing local file allocations...
              </p>
            ) : (
              <div style={{ maxHeight: '360px', overflowY: 'auto' }}>
                <table className="downloads-table">
                  <thead>
                    <tr>
                      <th>File Name</th>
                      <th>Size</th>
                      <th>Status</th>
                      <th>Verification</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fileEvents.slice(0, 50).map((ev, idx) => (
                      <tr key={`${ev.file_id}-${idx}`}>
                        <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                          {ev.name}
                        </td>
                        <td style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                          {formatBytes(ev.bytes)}
                        </td>
                        <td>
                          <span className={`status-pill ${ev.status === 'Completed' ? 'completed' : 'downloading'}`}>
                            {ev.status}
                          </span>
                        </td>
                        <td style={{ fontSize: '12px', color: ev.verification === 'Verified' ? 'var(--emerald-text)' : 'var(--text-muted)' }}>
                          {ev.verification || 'In Progress'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

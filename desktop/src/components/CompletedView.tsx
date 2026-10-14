import React from 'react';
import type { DbJob, FileEvent } from '../types';
import { formatBytes } from '../utils/formatters';

interface CompletedViewProps {
  completedFiles: FileEvent[];
  destinationPath: string;
  onOpenFolder: (path: string) => void;
  onNavigate: (view: 'new-download') => void;
  completedJobs?: DbJob[];
}

export const CompletedView: React.FC<CompletedViewProps> = ({
  completedFiles = [],
  destinationPath,
  onOpenFolder,
  onNavigate,
  completedJobs = [],
}) => {
  const hasFiles = completedFiles.length > 0;
  const hasJobs = completedJobs.length > 0;

  return (
    <div className="view-content-scroll">
      {/* Page Title & Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 className="page-title">Completed Downloads</h1>
          <p className="page-subtitle">Verified files successfully downloaded to your Mac.</p>
        </div>

        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => onOpenFolder(destinationPath)}
          style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          Open Downloads Folder
        </button>
      </div>

      {!hasFiles && !hasJobs ? (
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
              <circle cx="12" cy="12" r="9" />
              <polyline points="9 12 11 14 15 10" />
            </svg>
          </div>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>
            No Completed Downloads Yet
          </h3>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', maxWidth: '420px', lineHeight: 1.5 }}>
            Files downloaded and verified on disk will be cataloged here with one-click access to open their folders in Finder.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onNavigate('new-download')}
            style={{ marginTop: '10px', fontSize: '13px', padding: '8px 18px', borderRadius: '8px' }}
          >
            Start a Download
          </button>
        </div>
      ) : (
        /* Real Completed Files or Jobs */
        <div className="card" style={{ padding: '16px' }}>
          {hasFiles ? (
            <table className="downloads-table">
              <thead>
                <tr>
                  <th>File Name</th>
                  <th>Relative Path</th>
                  <th>Size</th>
                  <th>Verification</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {completedFiles.map((f, idx) => (
                  <tr key={`${f.file_id}-${idx}`}>
                    <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                      {f.name}
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                      {f.relative_path || f.name}
                    </td>
                    <td style={{ color: 'var(--text-primary)', fontSize: '13px' }}>
                      {formatBytes(f.bytes)}
                    </td>
                    <td>
                      <span style={{ color: 'var(--emerald-text)', fontSize: '12.5px', fontWeight: 500 }}>
                        {f.verification || 'Verified'}
                      </span>
                    </td>
                    <td>
                      <span className="status-pill completed">Completed</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            /* Completed Jobs from SQLite */
            <table className="downloads-table">
              <thead>
                <tr>
                  <th>Folder Name</th>
                  <th>Destination</th>
                  <th>Files</th>
                  <th>Total Size</th>
                  <th>Completed At</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {completedJobs.map((j) => (
                  <tr key={j.id}>
                    <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                      {j.root_folder_name}
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '12px', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {j.destination_path}
                    </td>
                    <td style={{ fontSize: '13px' }}>
                      {j.completed_files} of {j.total_files}
                    </td>
                    <td style={{ fontSize: '13px', fontWeight: 500 }}>
                      {formatBytes(j.total_bytes || j.downloaded_bytes)}
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                      {j.completed_at ? new Date(j.completed_at).toLocaleString() : 'Recent'}
                    </td>
                    <td>
                      <div className="row-actions-group" style={{ justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn-action-icon"
                          title="Open in Finder"
                          onClick={() => onOpenFolder(j.destination_path)}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
};

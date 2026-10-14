import React from 'react';
import type { DbJob } from '../types';
import { formatBytes } from '../utils/formatters';

interface HistoryViewProps {
  jobs: DbJob[];
  onOpenFolder: (path: string) => void;
  onRefresh: () => void;
  onNavigate?: (view: any) => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  jobs = [],
  onOpenFolder,
  onRefresh,
  onNavigate,
}) => {
  const [search, setSearch] = React.useState('');

  const filteredJobs = jobs.filter((j) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (j.root_folder_name || '').toLowerCase().includes(q) ||
      (j.source_url || '').toLowerCase().includes(q) ||
      (j.destination_path || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="view-content-scroll">
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 className="page-title">Download History</h1>
          <p className="page-subtitle">Persistent SQLite database records of all transfers.</p>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search history..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '12.5px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              width: '180px',
            }}
          />

          <button
            type="button"
            className="btn btn-secondary"
            onClick={onRefresh}
            style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {filteredJobs.length === 0 ? (
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
              <polyline points="12 7 12 12 15 14" />
            </svg>
          </div>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>
            No Download History
          </h3>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', maxWidth: '420px', lineHeight: 1.5 }}>
            All your Google Drive downloads will be logged here with timestamps, file counts, and folder destinations.
          </p>
          {onNavigate && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onNavigate('new-download')}
              style={{ marginTop: '10px', fontSize: '13px', padding: '8px 18px', borderRadius: '8px' }}
            >
              Start New Download
            </button>
          )}
        </div>
      ) : (
        /* Real History Table */
        <div className="card" style={{ padding: '16px' }}>
          <table className="downloads-table">
            <thead>
              <tr>
                <th>Job Name</th>
                <th>Files</th>
                <th>Size</th>
                <th>Destination</th>
                <th>Status</th>
                <th>Created</th>
                <th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredJobs.map((j) => (
                <tr key={j.id}>
                  <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    {j.root_folder_name || 'Download'}
                  </td>
                  <td style={{ fontSize: '13px' }}>
                    {j.completed_files} of {j.total_files}
                  </td>
                  <td style={{ fontSize: '13px', fontWeight: 500 }}>
                    {formatBytes(j.total_bytes || j.downloaded_bytes)}
                  </td>
                  <td
                    style={{
                      fontSize: '12px',
                      color: 'var(--text-muted)',
                      maxWidth: '220px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={j.destination_path}
                  >
                    {j.destination_path}
                  </td>
                  <td>
                    <span className={`status-pill ${j.status === 'COMPLETED' ? 'completed' : j.status === 'RUNNING' ? 'downloading' : 'failed'}`}>
                      {j.status}
                    </span>
                  </td>
                  <td style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {j.created_at ? new Date(j.created_at).toLocaleDateString() : 'Recent'}
                  </td>
                  <td>
                    <div className="row-actions-group" style={{ justifyContent: 'flex-end' }}>
                      {j.destination_path && (
                        <button
                          type="button"
                          className="btn-action-icon"
                          title="Open Destination in Finder"
                          onClick={() => onOpenFolder(j.destination_path)}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

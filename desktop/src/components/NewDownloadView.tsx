import React from 'react';
import type { AppSettings, ScanFileItem, ScanProgress, ScanResult } from '../types';
import { formatBytes } from '../utils/formatters';

interface NewDownloadViewProps {
  initialUrl?: string;
  settings: AppSettings;
  onStartJob: (files: ScanFileItem[], destPath: string, rootName: string, sourceUrl: string) => void;
  onScan: (url: string, onProgress: (p: ScanProgress) => void) => Promise<ScanResult>;
  onSelectFolder: () => Promise<string | null>;
}

export const NewDownloadView: React.FC<NewDownloadViewProps> = ({
  initialUrl = '',
  settings,
  onStartJob,
  onScan,
  onSelectFolder,
}) => {
  const [url, setUrl] = React.useState(initialUrl || '');
  const [destPath, setDestPath] = React.useState(
    settings.defaultDestination && settings.defaultDestination !== '.'
      ? settings.defaultDestination
      : '~/Downloads'
  );

  const [isScanning, setIsScanning] = React.useState(false);
  const [scanProgress, setScanProgress] = React.useState<ScanProgress | null>(null);
  const [scanResult, setScanResult] = React.useState<ScanResult | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [selectedFileIds, setSelectedFileIds] = React.useState<Set<string>>(new Set());
  const [fileSearch, setFileSearch] = React.useState('');

  // Auto-scan if an initialUrl is provided
  React.useEffect(() => {
    if (initialUrl && initialUrl.trim().length > 10 && !scanResult && !isScanning) {
      setUrl(initialUrl);
      handleTriggerScan(initialUrl);
    }
  }, [initialUrl]);

  const handleTriggerScan = async (targetUrl?: string) => {
    const link = (targetUrl || url).trim();
    if (!link) {
      setErrorMsg('Please enter a valid Google Drive URL.');
      return;
    }

    setIsScanning(true);
    setErrorMsg(null);
    setScanProgress(null);
    setScanResult(null);

    try {
      const res = await onScan(link, (prog) => {
        setScanProgress(prog);
      });
      setScanResult(res);
      // Select all files by default
      setSelectedFileIds(new Set(res.files.map((f) => f.id)));
    } catch (err: any) {
      setErrorMsg(typeof err === 'string' ? err : err?.message || 'Failed to scan Google Drive link.');
    } finally {
      setIsScanning(false);
    }
  };

  const handleChooseFolder = async () => {
    try {
      const chosen = await onSelectFolder();
      if (chosen) {
        setDestPath(chosen);
      }
    } catch (e) {
      console.warn('Folder selection error:', e);
    }
  };

  const handleToggleFile = (id: string) => {
    const next = new Set(selectedFileIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedFileIds(next);
  };

  const handleToggleAll = () => {
    if (!scanResult) return;
    if (selectedFileIds.size === scanResult.files.length) {
      setSelectedFileIds(new Set());
    } else {
      setSelectedFileIds(new Set(scanResult.files.map((f) => f.id)));
    }
  };

  const handleStart = () => {
    if (!scanResult) return;
    const selectedFiles = scanResult.files.filter((f) => selectedFileIds.has(f.id));
    if (selectedFiles.length === 0) {
      setErrorMsg('Please select at least one file to download.');
      return;
    }
    onStartJob(selectedFiles, destPath, scanResult.root_folder_name || 'Google Drive Download', url);
  };

  const selectedFilesList = scanResult ? scanResult.files.filter((f) => selectedFileIds.has(f.id)) : [];
  const totalSelectedBytes = selectedFilesList.reduce((acc, f) => acc + (f.size_bytes || 0), 0);

  const displayedFiles = (scanResult?.files || []).filter((f) => {
    if (!fileSearch) return true;
    return f.name.toLowerCase().includes(fileSearch.toLowerCase());
  });

  return (
    <div className="view-content-scroll">
      {/* Page Title */}
      <div style={{ marginBottom: '20px' }}>
        <h1 className="page-title">New Download</h1>
        <p className="page-subtitle">Scan and preview public Google Drive folders before downloading.</p>
      </div>

      {/* Input Configuration Box */}
      <div className="card" style={{ marginBottom: '20px' }}>
        {/* Link Input Row */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: 'var(--text-primary)' }}>
            Google Drive Link
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              className="link-input-field"
              placeholder="Paste public Google Drive folder or file link (https://drive.google.com/...)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              style={{ flex: 1 }}
              disabled={isScanning}
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => handleTriggerScan()}
              disabled={isScanning || !url.trim()}
              style={{ minWidth: '130px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
            >
              {isScanning ? (
                <>
                  <span className="pulse-dot-green" />
                  Scanning...
                </>
              ) : (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  Scan Link
                </>
              )}
            </button>
          </div>
        </div>

        {/* Destination Path Selector */}
        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: 'var(--text-primary)' }}>
            Destination Folder
          </label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <div
              style={{
                flex: 1,
                padding: '8px 12px',
                background: 'var(--bg-tertiary)',
                borderRadius: '8px',
                fontSize: '13px',
                fontFamily: 'monospace',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {destPath}
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleChooseFolder}
              disabled={isScanning}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              Browse...
            </button>
          </div>
        </div>
      </div>

      {/* Error Message */}
      {errorMsg && (
        <div
          style={{
            padding: '12px 16px',
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '8px',
            color: '#ef4444',
            fontSize: '13px',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {errorMsg}
        </div>
      )}

      {/* Scanning Active Status */}
      {isScanning && (
        <div className="card" style={{ padding: '30px', textAlign: 'center', marginBottom: '20px' }}>
          <div style={{ display: 'inline-block', marginBottom: '12px' }}>
            <span className="pulse-dot-green" style={{ width: '14px', height: '14px' }} />
          </div>
          <h3 style={{ margin: '0 0 6px 0', fontSize: '16px', color: 'var(--text-primary)' }}>
            Scanning Google Drive Contents...
          </h3>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
            {scanProgress
              ? `Found ${scanProgress.files_found} files across ${scanProgress.folders_scanned} folders`
              : 'Contacting Google Drive public gateway...'}
          </p>
        </div>
      )}

      {/* Scanned Results */}
      {scanResult && !isScanning && (
        <div className="card" style={{ padding: '16px' }}>
          {/* Header Summary */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1px solid var(--border-color)',
              paddingBottom: '12px',
              marginBottom: '14px',
              flexWrap: 'wrap',
              gap: '10px',
            }}
          >
            <div>
              <h3 style={{ margin: '0 0 4px 0', fontSize: '16px', color: 'var(--text-primary)' }}>
                {scanResult.root_folder_name || 'Scanned Files'}
              </h3>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {selectedFileIds.size} of {scanResult.files.length} files selected • {formatBytes(totalSelectedBytes)} total
              </span>
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="Filter files..."
                value={fileSearch}
                onChange={(e) => setFileSearch(e.target.value)}
                style={{
                  padding: '6px 10px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  width: '160px',
                }}
              />

              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleToggleAll}
                style={{ fontSize: '12.5px', padding: '6px 12px' }}
              >
                {selectedFileIds.size === scanResult.files.length ? 'Deselect All' : 'Select All'}
              </button>

              <button
                type="button"
                className="btn btn-primary"
                onClick={handleStart}
                disabled={selectedFileIds.size === 0}
                style={{ fontSize: '12.5px', padding: '6px 16px', fontWeight: 600 }}
              >
                Start Download ({selectedFileIds.size})
              </button>
            </div>
          </div>

          {/* Files Table */}
          <div style={{ maxHeight: '420px', overflowY: 'auto' }}>
            <table className="downloads-table">
              <thead>
                <tr>
                  <th style={{ width: '36px' }}>
                    <input
                      type="checkbox"
                      className="custom-checkbox"
                      checked={scanResult.files.length > 0 && selectedFileIds.size === scanResult.files.length}
                      onChange={handleToggleAll}
                    />
                  </th>
                  <th>Name</th>
                  <th>Relative Path</th>
                  <th>Size</th>
                </tr>
              </thead>
              <tbody>
                {displayedFiles.map((file) => (
                  <tr
                    key={file.id}
                    onClick={() => handleToggleFile(file.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>
                      <input
                        type="checkbox"
                        className="custom-checkbox"
                        checked={selectedFileIds.has(file.id)}
                        onChange={() => handleToggleFile(file.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                      {file.name}
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                      {file.relative_path || file.name}
                    </td>
                    <td style={{ color: 'var(--text-primary)', fontSize: '13px' }}>
                      {formatBytes(file.size_bytes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Initial Empty Guide (Before any scan) */}
      {!scanResult && !isScanning && (
        <div
          className="card"
          style={{
            padding: '40px 24px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              background: 'var(--bg-tertiary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--primary)',
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </div>
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
            Ready to Scan
          </h3>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', maxWidth: '420px', lineHeight: 1.5 }}>
            Paste any publicly shared Google Drive folder or file link above and click <strong>Scan Link</strong> to preview and select files for download.
          </p>
        </div>
      )}
    </div>
  );
};

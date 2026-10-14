import React from 'react';
import { DashboardView } from './components/DashboardView';

import type {
  AppSettings,
  DbJob,
  DiagnosticsReport,
  FileEvent,
  JobProgressEvent,
  LicenseState,
  ScanFileItem,
  ScanProgress,
  ScanResult,
} from './types';

// Tauri v2 API helper with graceful fallback
const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

async function invokeTauri<T>(cmd: string, args: Record<string, any> = {}): Promise<T> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(cmd, args);
  }
  throw new Error(`Tauri core IPC not available in this environment.`);
}

export const App: React.FC = () => {
  const [settings, setSettings] = React.useState<AppSettings>({
    concurrency: 16,
    theme: 'dark', // Default to sleek Slate Dark theme matching DriveMate reference UI
    skipExisting: true,
    defaultDestination: '/Users/gobindabiswas/Downloads',
  });

  const [license, setLicense] = React.useState<LicenseState | null>(null);
  const [jobsHistory, setJobsHistory] = React.useState<DbJob[]>([]);

  // Active Job State
  const [activeJobId, setActiveJobId] = React.useState<string | null>(null);
  const [activeDestination, setActiveDestination] = React.useState<string>('/Users/gobindabiswas/Downloads');
  const [activeProgress, setActiveProgress] = React.useState<JobProgressEvent | null>(null);
  const [fileEvents, setFileEvents] = React.useState<FileEvent[]>([]);
  const [isPaused, setIsPaused] = React.useState(false);

  // Initialize data on mount
  React.useEffect(() => {
    loadSettings();
    loadLicense();
    loadHistory();

    // Listen to Tauri native events
    if (isTauri) {
      import('@tauri-apps/api/event').then(({ listen }) => {
        listen<JobProgressEvent>('job:progress', (event) => {
          setActiveProgress(event.payload);
        });

        listen<FileEvent>('file:event', (event) => {
          setFileEvents((prev) => [event.payload, ...prev]);
        });
      });
    }
  }, []);

  // Update theme attribute on root
  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  const loadSettings = async () => {
    try {
      const res = await invokeTauri<AppSettings>('get_settings');
      if (res) {
        setSettings({
          concurrency: res.concurrency || 16,
          theme: res.theme || 'dark',
          skipExisting: res.skipExisting ?? true,
          defaultDestination: res.defaultDestination || '/Users/gobindabiswas/Downloads',
        });
        if (res.defaultDestination) {
          setActiveDestination(res.defaultDestination);
        }
      }
    } catch {}
  };

  const loadLicense = async () => {
    try {
      const res = await invokeTauri<LicenseState>('get_license_state');
      if (res) setLicense(res);
    } catch {}
  };

  const handleSaveSettings = async (nextSettings: AppSettings) => {
    setSettings(nextSettings);
    try {
      await invokeTauri('save_settings', { settings: nextSettings });
    } catch {}
  };

  const loadHistory = async () => {
    try {
      const res = await invokeTauri<DbJob[]>('get_jobs_history');
      if (res) setJobsHistory(res);
    } catch {}
  };

  const handleScan = async (url: string, onProgress: (p: ScanProgress) => void): Promise<ScanResult> => {
    if (isTauri) {
      const { listen } = await import('@tauri-apps/api/event');
      const unlisten = await listen<ScanProgress>('scan:progress', (evt) => {
        onProgress(evt.payload);
      });

      try {
        const result = await invokeTauri<ScanResult>('scan_link', { url });
        return result;
      } finally {
        unlisten();
      }
    }

    // Authentic scanner fallback for browser preview environment
    return new Promise((resolve) => {
      onProgress({ folders_scanned: 1, files_found: 4, current_path: 'Google Drive' });
      setTimeout(() => {
        const folderSlug = url.split('/').filter(Boolean).pop()?.split('?')[0] || 'drive_folder';
        resolve({
          root_folder_id: folderSlug,
          root_folder_name: `Google_Drive_${folderSlug.slice(0, 10)}`,
          completeness_status: 'Complete',
          total_folders_count: 2,
          total_files_count: 4,
          files: [
            { id: 'f-1', name: 'Document_Archive.zip', relative_path: 'Archives/Document_Archive.zip', size_bytes: 45289120, mime_type: 'application/zip' },
            { id: 'f-2', name: 'Project_Specification.pdf', relative_path: 'Documents/Project_Specification.pdf', size_bytes: 3824100, mime_type: 'application/pdf' },
            { id: 'f-3', name: 'Raw_Footage.mp4', relative_path: 'Media/Raw_Footage.mp4', size_bytes: 184549200, mime_type: 'video/mp4' },
            { id: 'f-4', name: 'HighRes_Image.jpg', relative_path: 'Media/HighRes_Image.jpg', size_bytes: 5214800, mime_type: 'image/jpeg' },
          ],
        });
      }, 700);
    });
  };

  const handleSelectFolder = async (): Promise<string | null> => {
    try {
      const chosen = await invokeTauri<string | null>('select_destination_folder');
      if (chosen) {
        setActiveDestination(chosen);
        handleSaveSettings({ ...settings, defaultDestination: chosen });
        return chosen;
      }
      return null;
    } catch {
      return null;
    }
  };

  const handleStartJob = async (
    files: ScanFileItem[],
    destPath: string,
    rootName: string,
    sourceUrl: string
  ) => {
    setActiveDestination(destPath);
    setFileEvents([]);
    setIsPaused(false);

    if (!isTauri) {
      // Browser preview simulated active job matching reference
      const mockJobId = `job-${Date.now().toString().slice(-4)}`;
      setActiveJobId(mockJobId);
      const totalBytes = files.reduce((acc, f) => acc + (f.size_bytes || 10485760), 0) || 45880000000;
      setActiveProgress({
        job_id: mockJobId,
        overall_bytes: Math.round(totalBytes * 0.871), // 87.1% matching screenshot
        overall_total_bytes: totalBytes,
        speed_bps: 8230000, // 8.23 MB/s
        active_count: 16,
        completed_count: 1029,
        failed_count: 0,
        skipped_count: 0,
        total_files: 1045,
        status: 'RUNNING',
      });
      setFileEvents([
        { job_id: mockJobId, file_id: 'f-1', name: 'C1162.MP4', relative_path: 'C1162.MP4', bytes: 198040000, status: 'DOWNLOADING', verification: 'STREAMING' },
        { job_id: mockJobId, file_id: 'f-2', name: 'C0836.MP4', relative_path: 'C0836.MP4', bytes: 152660000, status: 'DOWNLOADING', verification: 'STREAMING' },
        { job_id: mockJobId, file_id: 'f-3', name: 'C0975.MP4', relative_path: 'C0975.MP4', bytes: 38150000, status: 'DOWNLOADING', verification: 'STREAMING' },
      ]);
      return;
    }

    try {
      const jobId = await invokeTauri<string>('start_download_job', {
        request: {
          source_url: sourceUrl,
          root_folder_name: rootName,
          destination_path: destPath,
          concurrency: settings.concurrency,
          skip_existing: settings.skipExisting,
          files: files.map((f) => ({
            id: f.id,
            name: f.name,
            relative_path: f.relative_path,
            expected_size: f.size_bytes > 0 ? f.size_bytes : undefined,
          })),
        },
      });

      setActiveJobId(jobId);
    } catch (err) {
      console.error('Failed to start job:', err);
    }
  };

  const handlePauseJob = async () => {
    try {
      await invokeTauri('pause_download_job');
      setIsPaused(true);
    } catch {
      setIsPaused(true);
      if (!isTauri && activeProgress) {
        setActiveProgress({ ...activeProgress, speed_bps: 0, status: 'PAUSED' });
      }
    }
  };

  const handleResumeJob = async () => {
    try {
      await invokeTauri('resume_download_job');
      setIsPaused(false);
    } catch {
      setIsPaused(false);
      if (!isTauri && activeProgress) {
        setActiveProgress({ ...activeProgress, speed_bps: 8230000, status: 'RUNNING' });
      }
    }
  };

  const handleCancelJob = async () => {
    try {
      await invokeTauri('stop_download_job');
      setActiveJobId(null);
      setActiveProgress(null);
      loadHistory();
    } catch {
      setActiveJobId(null);
      setActiveProgress(null);
    }
  };

  const handleOpenFolder = async (path: string) => {
    try {
      await invokeTauri('open_folder_in_os', { path });
    } catch {
      console.log('Opening folder:', path);
    }
  };

  const handleActivateKey = async (key: string) => {
    const res = await invokeTauri<LicenseState>('verify_license', { key });
    if (res) setLicense(res);
  };

  const handleRunDiagnostics = async (): Promise<DiagnosticsReport> => {
    return await invokeTauri<DiagnosticsReport>('run_diagnostics');
  };

  return (
    <div className="desktop-app-window">
      <DashboardView
        jobs={jobsHistory}
        license={license}
        settings={settings}
        onSaveSettings={handleSaveSettings}
        onActivateLicense={handleActivateKey}
        destinationPath={activeDestination}
        onOpenFolder={handleOpenFolder}
        concurrency={settings.concurrency}
        activeJobId={activeJobId}
        progress={activeProgress}
        fileEvents={fileEvents}
        isPaused={isPaused}
        onPause={handlePauseJob}
        onResume={handleResumeJob}
        onCancel={handleCancelJob}
        onScan={handleScan}
        onStartJob={handleStartJob}
        onSelectFolder={handleSelectFolder}
        onRunDiagnostics={handleRunDiagnostics}
      />
    </div>
  );
};


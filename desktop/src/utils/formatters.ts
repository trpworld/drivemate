export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0 || isNaN(bytes)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i] || 'TB'}`;
}

export function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0 || isNaN(bytesPerSec)) return '0 B/s';
  return `${formatBytes(bytesPerSec)}/s`;
}

export function getFileType(fileName: string, mimeType?: string): 'video' | 'photo' | 'zip' | 'audio' | 'doc' | 'folder' | 'file' {
  const lower = (fileName || '').toLowerCase();
  const mime = (mimeType || '').toLowerCase();

  if (mime.includes('directory') || mime.includes('folder')) return 'folder';
  if (mime.startsWith('video/') || /\.(mp4|mkv|mov|avi|wmv|webm|flv|m4v)$/i.test(lower)) return 'video';
  if (mime.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|svg|bmp|tiff|heic|raw|cr2|nef)$/i.test(lower)) return 'photo';
  if (mime.includes('zip') || mime.includes('compressed') || /\.(zip|rar|7z|tar|gz|bz2)$/i.test(lower)) return 'zip';
  if (mime.startsWith('audio/') || /\.(mp3|wav|flac|aac|ogg|m4a|wma)$/i.test(lower)) return 'audio';
  if (mime.includes('pdf') || mime.includes('document') || /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|rtf|csv)$/i.test(lower)) return 'doc';

  return 'file';
}

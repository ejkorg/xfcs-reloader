export interface EnvYearRange {
  environment: string;
  dbCode: string;
  siteName: string;
  siteCode?: string;
  areaCode?: string;
  testerType?: string;
  parentGroup: string;
  regionGroup: string;
  processGroup: string;
  folder: string;
  startYear: number;
  endYear: number;
  active?: boolean;
}

export interface SearchBlock {
  year?: number;
  month?: number;
  lots?: string[];
}

export interface SearchCriteria {
  environment: string;
  blocks?: SearchBlock[];
  site?: string;
  area?: string;
  testerType?: string;
  years?: number[]; // Deprecated, but keeping for compatibility
  months?: number[]; // Deprecated
  lotIds?: string[]; // Deprecated
  maxResults?: number;
}

export interface SearchResult {
  path: string;
  fullPath: string;
  lotId: string;
  filename: string;
  year?: number;
  month?: number;
  sizeBytes?: number;
  userLotId?: string;
}

export interface DownloadFilesRequest {
  paths: string[];
}

export interface ReloadRequest {
  environment: string;
  site?: string;
  area?: string;
  testerType?: string;
  requester?: string;
  filePaths: string[];
  files?: { path: string, userLotId?: string }[];
}

export interface ReloadSession {
  id: string;
}

export interface ReloadStatus {
  sessionId: string;
  status: string;
  environment?: string;
  message?: string;
  requester?: string;
  createdAt?: string;
  updatedAt?: string;
  totalFiles?: number;
  completedFiles?: number;
  failedFiles?: number;
  filePaths?: string[]; // Kept for backward compatibility
  files?: { path: string, userLotId?: string }[];
}

export interface ReloadSessionEvent {
  id: number;
  sessionId: string;
  eventTime: string;
  eventType: string;
  message?: string;
  actor?: string;
  errorCode?: string;
}

export interface DashboardData {
  generatedAt: string;
  totalRequests: number;
  completed: number;
  failed: number;
  recentLots: string[];
  activeSessions: number;
  pendingFiles: number;
  stuckTimeoutMin: number;
}

export interface FileStatusItem {
  absPath: string;
  fileName: string;
  originalFileName?: string;
  userLotId?: string;
  fileStatus: 'pending' | 'staging' | 'etl_complete' | 'completed' | 'unverified' | 'failed';
  errorReason?: string;
  resolvedPath?: string;
  destinationFolder?: string;
  processingDestination?: 'PRODUCTION' | 'SANDBOX' | null;
  createdAt?: string;
  resolvedAt?: string;
}

export interface EnvInfo {
  environment: string;
  cfgPath: string;
  inboxPath: string;
  fileCount: number;
  active: boolean;
  configSource?: string;
  logPath?: string;
}

export interface ArchiveLotDetail {
  lot: string;
  wafer?: string;
  filename?: string;
  year?: number;
  month?: number;
  archivePath?: string;
  status?: string;
  processingStatus?: string;
  environment?: string;
  error?: string;
  processedAt?: number;
}

import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { ArchiveLotDetail, DashboardData, DownloadFilesRequest, EnvInfo, EnvYearRange, FileCoveragePoint, FileStatusItem, ReloadRequest, ReloadSession, ReloadSessionEvent, ReloadStatus, SearchCriteria, SearchResult } from './xfcs-models';

@Injectable({ providedIn: 'root' })
export class XfcsApiService {
  private readonly base = `${environment.apiUrl}/xfcs`;

  constructor(private http: HttpClient, private auth: AuthService) {}

  getEnvs(): Observable<EnvYearRange[]> {
    return this.http.get<EnvYearRange[]>(`${this.base}/envs`, { headers: this.auth.getAuthHeaders() ?? undefined });
  }

  searchArchive(criteria: SearchCriteria): Observable<SearchResult[]> {
    return this.http.post<SearchResult[]>(`${this.base}/archive/search`, criteria, { headers: this.auth.getAuthHeaders() ?? undefined });
  }

  downloadFiles(req: DownloadFilesRequest): Observable<HttpResponse<Blob>> {
    const headers = (this.auth.getAuthHeaders() ?? new HttpHeaders()).set('Accept', 'application/octet-stream');
    return this.http.post(`${this.base}/files/download`, req, { headers, responseType: 'blob', observe: 'response' });
  }

  createReload(req: ReloadRequest): Observable<ReloadSession> {
    return this.http.post<ReloadSession>(`${this.base}/reload`, req, { headers: this.auth.getAuthHeaders() ?? undefined });
  }

  getReloadStatus(sessionId: string): Observable<ReloadStatus> {
    return this.http.get<ReloadStatus>(`${this.base}/reload/${encodeURIComponent(sessionId)}`, { headers: this.auth.getAuthHeaders() ?? undefined });
  }

  getReloadEvents(sessionId: string): Observable<ReloadSessionEvent[]> {
    return this.http.get<ReloadSessionEvent[]>(`${this.base}/reload/${encodeURIComponent(sessionId)}/events`, {
      headers: this.auth.getAuthHeaders() ?? undefined
    });
  }

  getDashboard(): Observable<DashboardData> {
    return this.http.get<DashboardData>(`${this.base}/dashboard`, { headers: this.auth.getAuthHeaders() ?? undefined });
  }

  getSessions(): Observable<ReloadStatus[]> {
    return this.http.get<ReloadStatus[]>(`${this.base}/sessions`, { headers: this.auth.getAuthHeaders() ?? undefined });
  }

  getEnvInfo(environment: string): Observable<EnvInfo> {
    return this.http.get<EnvInfo>(`${this.base}/envs/${encodeURIComponent(environment)}/info`, {
      headers: this.auth.getAuthHeaders() ?? undefined
    });
  }

  findArchiveLots(environment: string, lot?: string, wafer?: string): Observable<ArchiveLotDetail[]> {
    const params: Record<string, string> = { environment };
    if (lot) params['lot'] = lot;
    if (wafer) params['wafer'] = wafer;
    return this.http.get<ArchiveLotDetail[]>(`${this.base}/archive/find-lots`, {
      headers: this.auth.getAuthHeaders() ?? undefined,
      params
    });
  }

  getSessionFiles(sessionId: string): Observable<FileStatusItem[]> {
    return this.http.get<FileStatusItem[]>(
      `${this.base}/reload/${encodeURIComponent(sessionId)}/files`,
      { headers: this.auth.getAuthHeaders() ?? undefined }
    );
  }

  cancelSession(sessionId: string): Observable<ReloadStatus> {
    return this.http.post<ReloadStatus>(
      `${this.base}/reload/${encodeURIComponent(sessionId)}/cancel`,
      {},
      { headers: this.auth.getAuthHeaders() ?? undefined }
    );
  }

  getStreamUrl(sessionId: string, lastEventId?: number): string {
    const base = `${this.base}/reload/${encodeURIComponent(sessionId)}/stream`;
    return lastEventId != null ? `${base}?lastEventId=${lastEventId}` : base;
  }

  getFileCoverage(environment?: string, granularity?: string, dateFrom?: string, dateTo?: string): Observable<FileCoveragePoint[]> {
    const params: Record<string, string> = {};
    if (environment) params['environment'] = environment;
    if (granularity) params['granularity'] = granularity;
    if (dateFrom) params['dateFrom'] = dateFrom;
    if (dateTo) params['dateTo'] = dateTo;
    return this.http.get<FileCoveragePoint[]>(`${this.base}/reload/coverage`, {
      headers: this.auth.getAuthHeaders() ?? undefined,
      params
    });
  }
}

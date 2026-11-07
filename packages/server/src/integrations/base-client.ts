/**
 * BaseIntegrationClient — abstract HTTP client for all integration plugins.
 * Outlook, Jira, Loop plugins extend this class for consistent
 * error handling and logging.
 */
export abstract class BaseIntegrationClient {
  protected baseUrl: string;
  protected headers: Record<string, string>;
  protected timeoutMs: number;

  constructor(baseUrl: string, defaultHeaders: Record<string, string> = {}, timeoutMs = 10_000) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.headers = { 'Content-Type': 'application/json', ...defaultHeaders };
    this.timeoutMs = timeoutMs;
  }

  async get<T>(path: string, extraHeaders?: Record<string, string>): Promise<T> {
    return this.request<T>('GET', path, undefined, extraHeaders);
  }

  async post<T>(path: string, body: unknown, extraHeaders?: Record<string, string>): Promise<T> {
    return this.request<T>('POST', path, body, extraHeaders);
  }

  async put<T>(path: string, body: unknown, extraHeaders?: Record<string, string>): Promise<T> {
    return this.request<T>('PUT', path, body, extraHeaders);
  }

  async patch<T>(path: string, body: unknown, extraHeaders?: Record<string, string>): Promise<T> {
    return this.request<T>('PATCH', path, body, extraHeaders);
  }

  async delete<T>(path: string, extraHeaders?: Record<string, string>): Promise<T> {
    return this.request<T>('DELETE', path, undefined, extraHeaders);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        method,
        headers: { ...this.headers, ...extraHeaders },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`${method} ${url} → HTTP ${res.status}: ${text}`);
      }

      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        return res.json() as Promise<T>;
      }
      return res.text() as unknown as Promise<T>;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Subclasses can override to refresh tokens, inject auth headers, etc.
   */
  protected async refreshAuth(): Promise<void> {}

  abstract isConfigured(): boolean;
  abstract getName(): string;
}

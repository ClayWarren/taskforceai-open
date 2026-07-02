export class ApiClientError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `Request failed with status ${status}`);
    this.name = 'ApiClientError';
    this.status = status;
    this.body = body;
  }
}

export class SyncError extends Error {
  override name = 'SyncError';
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

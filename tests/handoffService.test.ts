import { describe, expect, it, vi, beforeEach } from 'vitest';

// In-memory stand-in for the Upstash client. Crucially, get() returns the
// *deserialized object* (not a string) — exactly what @upstash/redis does
// with automaticDeserialization (its default). The original bug was that
// resolveHandoffToken did JSON.parse() on this object.
const store = new Map<string, unknown>();
vi.mock('../src/config/redis', () => ({
  redis: {
    setex: async (key: string, _ttl: number, value: string) => {
      // The client parses JSON strings back to objects on read.
      store.set(key, JSON.parse(value));
      return 'OK';
    },
    get: async (key: string) => (store.has(key) ? store.get(key) : null),
    del: async (key: string) => {
      store.delete(key);
      return 1;
    },
  },
}));

// Imported after the mock is registered.
const { HandoffService } = await import('../src/services/handoffService');

describe('HandoffService', () => {
  beforeEach(() => store.clear());

  it('round-trips a token when redis returns a deserialized object', async () => {
    const svc = new HandoffService();
    const token = await svc.createHandoffToken('anon_abc123', ['scrolt_001', 'scrolt_002']);
    const resolved = await svc.resolveHandoffToken(token);
    expect(resolved).not.toBeNull();
    expect(resolved!.userId).toBe('anon_abc123');
    expect(resolved!.progressSnapshot.seenCardIds).toEqual(['scrolt_001', 'scrolt_002']);
  });

  it('is single-use: a resolved token cannot be resolved again', async () => {
    const svc = new HandoffService();
    const token = await svc.createHandoffToken('anon_abc123', []);
    expect(await svc.resolveHandoffToken(token)).not.toBeNull();
    expect(await svc.resolveHandoffToken(token)).toBeNull();
  });

  it('rejects malformed tokens without touching redis', async () => {
    const svc = new HandoffService();
    expect(await svc.resolveHandoffToken('not-a-token')).toBeNull();
    expect(await svc.resolveHandoffToken('DEADBEEFEXTRA')).toBeNull();
  });
});

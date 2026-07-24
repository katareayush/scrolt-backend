import { redis } from '../config/redis';
import { randomBytes } from 'crypto';

interface HandoffData {
  userId: string;
  progressSnapshot: {
    seenCardIds: string[];
    lastCardIndex: number;
  };
  createdAt: number;
}

export class HandoffService {
  private readonly TOKEN_LENGTH = 8;
  private readonly TOKEN_TTL = 600;

  async createHandoffToken(userId: string, seenCardIds: string[]): Promise<string> {
    const token = this.generateToken();
    
    const handoffData: HandoffData = {
      userId,
      progressSnapshot: {
        seenCardIds,
        lastCardIndex: seenCardIds.length
      },
      createdAt: Date.now()
    };

    await redis.setex(
      `handoff:${token}`,
      this.TOKEN_TTL,
      JSON.stringify(handoffData)
    );

    return token;
  }

  async resolveHandoffToken(token: string): Promise<HandoffData | null> {
    if (!this.isValidTokenFormat(token)) {
      return null;
    }

    const data = await redis.get(`handoff:${token}`);

    if (data == null) {
      return null;
    }

    await redis.del(`handoff:${token}`);

    // @upstash/redis deserializes JSON automatically, so `data` is already
    // an object here; it's only a string if a raw non-JSON value was
    // stored. Handle both so a client-config change can't silently break
    // resolution.
    try {
      const handoffData =
        typeof data === 'string' ? (JSON.parse(data) as HandoffData) : (data as HandoffData);
      return handoffData;
    } catch {
      return null;
    }
  }

  private generateToken(): string {
    return randomBytes(this.TOKEN_LENGTH)
      .toString('hex')
      .toUpperCase()
      .slice(0, this.TOKEN_LENGTH);
  }

  private isValidTokenFormat(token: string): boolean {
    return /^[A-F0-9]{8}$/.test(token);
  }
}
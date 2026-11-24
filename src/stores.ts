/** Call-spanning state lives behind these interfaces so a shared (e.g. DynamoDB) version can replace them. */
export interface TokenUseStore {
  /** Returns true the first time a token is used, false afterwards. */
  tryUse(token: string, expSeconds: number): boolean;
}

export interface CallRegistry {
  tryAdd(callSid: string): boolean;
  remove(callSid: string): void;
  count(): number;
  readonly capacity: number;
}

export class InMemoryTokenUseStore implements TokenUseStore {
  private readonly used = new Map<string, number>();

  tryUse(token: string, expSeconds: number): boolean {
    const now = Math.floor(Date.now() / 1000);
    for (const [t, exp] of this.used) if (exp < now) this.used.delete(t);
    if (this.used.has(token)) return false;
    this.used.set(token, expSeconds);
    return true;
  }
}

export class InMemoryCallRegistry implements CallRegistry {
  private readonly calls = new Set<string>();
  constructor(readonly capacity: number) {}

  tryAdd(callSid: string): boolean {
    if (this.calls.size >= this.capacity || this.calls.has(callSid)) return false;
    this.calls.add(callSid);
    return true;
  }
  remove(callSid: string): void {
    this.calls.delete(callSid);
  }
  count(): number {
    return this.calls.size;
  }
}

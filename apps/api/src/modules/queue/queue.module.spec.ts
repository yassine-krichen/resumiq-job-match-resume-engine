import { MODULE_METADATA } from '@nestjs/common/constants';
import { QueueModule } from './queue.module';

/**
 * QueueModule's @Module({ imports: [...] }) decorator calls
 * BullModule.forRootAsync({ useFactory }) eagerly at class-definition time —
 * Reflect.getMetadata(MODULE_METADATA.IMPORTS, QueueModule) returns the
 * literal array passed in, so `imports[0]` is the DynamicModule
 * forRootAsync produced, and our connection factory is the *first* provider
 * on it (a `useFactory` provider; the second, `extraOptionsProvider`, uses
 * `useValue` and never matches). This asserts our code's inputs to BullMQ,
 * not BullMQ's own module-wiring internals.
 */
function connectionFactoryFromQueueModule(): () => { connection: Record<string, unknown> } {
  const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, QueueModule) as Array<{
    providers?: Array<{ provide: unknown; useFactory?: () => unknown }>;
  }>;
  const forRootAsyncModule = imports[0];
  const factoryProvider = forRootAsyncModule?.providers?.find((p) => typeof p.useFactory === 'function');
  if (!factoryProvider?.useFactory) {
    throw new Error('Could not locate BullModule.forRootAsync useFactory on QueueModule');
  }
  return factoryProvider.useFactory as () => { connection: Record<string, unknown> };
}

describe('QueueModule Redis connection config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws a clear, actionable error when REDIS_URL is unset', () => {
    delete process.env.REDIS_URL;
    const factory = connectionFactoryFromQueueModule();

    expect(() => factory()).toThrow(/REDIS_URL is not set/);
  });

  it('sets maxRetriesPerRequest: null — BullMQ/Upstash requires this exact value, not a finite retry count', () => {
    process.env.REDIS_URL = 'rediss://default:secret@my-redis.upstash.io:6379';
    const factory = connectionFactoryFromQueueModule();

    const { connection } = factory();

    expect(connection.maxRetriesPerRequest).toBeNull();
  });

  it('enables TLS ({}) for a rediss:// URL', () => {
    process.env.REDIS_URL = 'rediss://default:secret@my-redis.upstash.io:6379';
    const factory = connectionFactoryFromQueueModule();

    const { connection } = factory();

    expect(connection.tls).toEqual({});
  });

  it('leaves TLS unset for a plain redis:// URL', () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    const factory = connectionFactoryFromQueueModule();

    const { connection } = factory();

    expect(connection.tls).toBeUndefined();
  });

  it('parses host, port, username, and password out of the connection string', () => {
    process.env.REDIS_URL = 'rediss://myuser:mypass@my-redis.upstash.io:6380';
    const factory = connectionFactoryFromQueueModule();

    const { connection } = factory();

    expect(connection.host).toBe('my-redis.upstash.io');
    expect(connection.port).toBe(6380);
    expect(connection.username).toBe('myuser');
    expect(connection.password).toBe('mypass');
  });

  it('defaults to port 6379 when the URL has no explicit port', () => {
    process.env.REDIS_URL = 'redis://localhost';
    const factory = connectionFactoryFromQueueModule();

    const { connection } = factory();

    expect(connection.port).toBe(6379);
  });
});

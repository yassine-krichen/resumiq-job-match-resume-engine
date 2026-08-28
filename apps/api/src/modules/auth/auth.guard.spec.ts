import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { getAuth } from './auth.config';

// better-auth/node is ESM-only and would otherwise fail to parse under
// Jest's default CommonJS transform — stub it since the guard only uses
// fromNodeHeaders() to pass request headers through untouched.
jest.mock('better-auth/node', () => ({
  fromNodeHeaders: (headers: unknown) => headers,
}));

const authStub = {
  api: {
    getSession: jest.fn(),
  },
};

jest.mock('./auth.config', () => ({
  getAuth: () => authStub,
}));

function createExecutionContext(headers: Record<string, string> = {}): {
  context: ExecutionContext;
  request: { headers: Record<string, string>; user?: unknown; session?: unknown };
} {
  const request = { headers };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('AuthGuard', () => {
  let guard: AuthGuard;
  const getSessionMock = getAuth().api.getSession as unknown as jest.Mock;

  beforeEach(() => {
    guard = new AuthGuard();
    getSessionMock.mockReset();
  });

  it('returns true and attaches the user to the request when the session is valid', async () => {
    const session = { user: { id: 'user-1' }, session: { id: 'session-1' } };
    getSessionMock.mockResolvedValue(session);

    const { context, request } = createExecutionContext({ cookie: 'valid' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual(session.user);
    expect(request.session).toEqual(session.session);
  });

  it('throws UnauthorizedException when the session is missing or invalid', async () => {
    getSessionMock.mockResolvedValue(null);

    const { context } = createExecutionContext();

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });
});

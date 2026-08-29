import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function createHost(): { host: ArgumentsHost; response: { status: jest.Mock; json: jest.Mock } } {
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  return { host, response };
}

describe('AllExceptionsFilter', () => {
  it('passes an HttpException through with its own status/body unchanged', () => {
    const filter = new AllExceptionsFilter();
    const { host, response } = createHost();
    const exception = new BadRequestException('x');

    filter.catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(exception.getResponse());
  });

  it('maps a plain Error to a generic sanitized 500 response without leaking the message or stack', () => {
    const filter = new AllExceptionsFilter();
    const { host, response } = createHost();
    const exception = new Error('secret internal detail');

    filter.catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 500,
      message: 'Internal server error',
    });

    const sentBody = JSON.stringify(response.json.mock.calls[0][0]);
    expect(sentBody).not.toContain('secret internal detail');
  });
});

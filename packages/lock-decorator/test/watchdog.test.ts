import { Watchdog } from '../src/core/watchdog';

const mockProvider = {
  acquire: jest.fn(),
  release: jest.fn(),
  renew: jest.fn(),
} as unknown as {
  acquire: jest.Mock;
  release: jest.Mock;
  renew: jest.Mock;
};

describe('Watchdog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should start timer and renew periodically', async () => {
    mockProvider.renew.mockResolvedValue(true);
    const watchdog = new Watchdog({
      provider: mockProvider,
      key: 'key',
      token: 'token',
      ttl: 30000,
      interval: 100,
    });

    watchdog.start();

    expect(mockProvider.renew).not.toHaveBeenCalled();

    jest.advanceTimersByTime(100);
    expect(mockProvider.renew).toHaveBeenCalledWith('key', 'token', 30000);

    jest.advanceTimersByTime(100);
    expect(mockProvider.renew).toHaveBeenCalledTimes(2);
  });

  it('should stop renewal when renew returns false', async () => {
    mockProvider.renew
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const watchdog = new Watchdog({
      provider: mockProvider,
      key: 'key',
      token: 'token',
      ttl: 30000,
      interval: 100,
    });

    watchdog.start();

    jest.advanceTimersByTime(100);
    expect(mockProvider.renew).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(100);
    expect(mockProvider.renew).toHaveBeenCalledTimes(2);
    expect(mockProvider.renew).toHaveBeenCalledWith('key', 'token', 30000);
  });

  it('should stop renewal when explicitly stopped', async () => {
    mockProvider.renew.mockResolvedValue(true);
    const watchdog = new Watchdog({
      provider: mockProvider,
      key: 'key',
      token: 'token',
      ttl: 30000,
      interval: 100,
    });

    watchdog.start();
    jest.advanceTimersByTime(100);
    expect(mockProvider.renew).toHaveBeenCalledTimes(1);

    watchdog.stop();
    jest.advanceTimersByTime(100);
    expect(mockProvider.renew).toHaveBeenCalledTimes(1);
  });
});
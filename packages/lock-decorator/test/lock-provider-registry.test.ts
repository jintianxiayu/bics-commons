import { LockProviderRegistry } from '../src/core/lock-provider-registry';
import { LockProvider } from '../src/core/lock-provider';

const mockProvider: LockProvider = {
    acquire: jest.fn(),
    release: jest.fn(),
    renew: jest.fn(),
};

describe('LockProviderRegistry', () => {
    beforeEach(() => {
        LockProviderRegistry.clear();
    });

    describe('register', () => {
        it('should register a provider', () => {
            LockProviderRegistry.register('redis', mockProvider);
            expect(LockProviderRegistry.get('redis')).toBe(mockProvider);
        });
    });

    describe('get', () => {
        it('should get provider by name', () => {
            LockProviderRegistry.register('redis', mockProvider);
            expect(LockProviderRegistry.get('redis')).toBe(mockProvider);
        });

        it('should throw when provider not found', () => {
            expect(() => LockProviderRegistry.get('nonexistent')).toThrow('CacheProvider "nonexistent" not found');
        });

        it('should get default provider when name not specified', () => {
            LockProviderRegistry.register('redis', mockProvider);
            LockProviderRegistry.setDefault('redis');
            expect(LockProviderRegistry.get()).toBe(mockProvider);
        });

        it('should throw when no default set and no name provided', () => {
            expect(() => LockProviderRegistry.get()).toThrow('No CacheProvider registered and no default set');
        });
    });

    describe('setDefault', () => {
        it('should set default provider', () => {
            LockProviderRegistry.register('redis', mockProvider);
            LockProviderRegistry.setDefault('redis');
            expect(LockProviderRegistry.get()).toBe(mockProvider);
        });

        it('should throw when setting default for unregistered provider', () => {
            expect(() => LockProviderRegistry.setDefault('nonexistent')).toThrow(
                'CacheProvider "nonexistent" not found'
            );
        });
    });

    describe('clear', () => {
        it('should clear all providers and default', () => {
            LockProviderRegistry.register('redis', mockProvider);
            LockProviderRegistry.setDefault('redis');
            LockProviderRegistry.clear();
            expect(() => LockProviderRegistry.get()).toThrow('No CacheProvider registered and no default set');
        });
    });
});

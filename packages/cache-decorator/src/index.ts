import { Cache } from './decorators/cache';

export * from './core/cache-provider';
export * from './core/cache-provider-registry';
export * from './core/native-cache';
export * from './core/redis-cache';
export * from './core/key-builder';
export * from './core/pending-cache';
export * from './decorators/cache';
export * from './decorators/cache-evict';


class XX {
    @Cache('calc')
    add(a: number, b: number) {
        return a + b;
    }
}
import { KeyBuilder } from '../src/core/key-builder';

describe('KeyBuilder', () => {
    describe('build', () => {
        it('应生成包含缓存名的 key', () => {
            const key = KeyBuilder.build('user-cache', []);
            expect(key).toBe('user-cache');
        });

        it('应生成包含参数值的 key', () => {
            const key = KeyBuilder.build('user-cache', [1]);
            expect(key).toBe('user-cache:1');
        });

        it('应处理多个参数', () => {
            const key = KeyBuilder.build('user-cache', [1, 'test']);
            expect(key).toBe('user-cache:1&test');
        });

        it('应处理对象参数', () => {
            const key = KeyBuilder.build('user-cache', [{ id: 1, name: 'test' }]);
            expect(key).toBe('user-cache:{"id":1,"name":"test"}');
        });

        it('应处理 null 和 undefined', () => {
            const key1 = KeyBuilder.build('user-cache', [null]);
            const key2 = KeyBuilder.build('user-cache', [undefined]);
            expect(key1).toBe('user-cache:null');
            expect(key2).toBe('user-cache:null');
        });

        it('应处理数字和布尔值', () => {
            const key = KeyBuilder.build('user-cache', [123, true, false]);
            expect(key).toBe('user-cache:123&true&false');
        });
    });
});

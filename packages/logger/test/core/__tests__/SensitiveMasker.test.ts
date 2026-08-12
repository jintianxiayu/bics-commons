/**
 * SensitiveMasker 单元测试
 */

import { createMaskingPolicy, type MaskingPolicy } from '../../../src/core/SensitiveMasker';

describe('SensitiveMasker', () => {
    let policy: MaskingPolicy;

    beforeEach(() => {
        policy = createMaskingPolicy();
    });

    describe('compileTemplate & renderMask', () => {
        it('should render full mask template', () => {
            policy = createMaskingPolicy({ fields: [{ field: 'password', mask: '********' }] });
            const result = policy.mask({ password: 'secret123' });
            expect(result).toEqual({ password: '********' });
        });

        it('should render {last4} placeholder', () => {
            policy = createMaskingPolicy({ fields: [{ field: 'phone', mask: '*** *** {last4}' }] });
            const result = policy.mask({ phone: '13812345678' });
            expect(result).toEqual({ phone: '*** *** 5678' });
        });

        it('should render {firstN} placeholder', () => {
            policy = createMaskingPolicy({ fields: [{ field: 'id', mask: '{first3}****' }] });
            const result = policy.mask({ id: '13812345678' });
            expect(result).toEqual({ id: '138****' });
        });

        it('should render {domain} placeholder', () => {
            policy = createMaskingPolicy({ fields: [{ field: 'email', mask: '{first2}***@{domain}' }] });
            const result = policy.mask({ email: 'john@example.com' });
            expect(result).toEqual({ email: 'jo***@example.com' });
        });
    });

    describe('applyPlaceholder', () => {
        it('should handle {lastN} when value length <= N', () => {
            policy = createMaskingPolicy({ fields: [{ field: 'code', mask: '{last4}' }] });
            const result = policy.mask({ code: '123' });
            expect(result).toEqual({ code: '*123' });
        });

        it('should handle email without @ as domain', () => {
            policy = createMaskingPolicy({ fields: [{ field: 'email', mask: '{domain}' }] });
            const result = policy.mask({ email: 'justusername' });
            expect(result).toEqual({ email: '********' });
        });
    });

    describe('maskObject - top level', () => {
        it('should mask top-level sensitive field', () => {
            policy = createMaskingPolicy({ fields: [{ field: 'password', mask: '********' }] });
            const result = policy.mask({ password: 'secret123' });
            expect(result).toEqual({ password: '********' });
        });

        it('should not mask non-sensitive fields', () => {
            policy = createMaskingPolicy({ fields: [{ field: 'password', mask: '********' }] });
            const result = policy.mask({ username: 'john' });
            expect(result).toEqual({ username: 'john' });
        });
    });

    describe('maskObject - nested', () => {
        it('should mask nested sensitive field', () => {
            policy = createMaskingPolicy({ fields: [{ field: 'password', mask: '********' }] });
            const result = policy.mask({ user: { password: 'secret123' } });
            expect(result).toEqual({ user: { password: '********' } });
        });

        it('should handle deep nesting within limit', () => {
            policy = createMaskingPolicy({ fields: [{ field: 'secret', mask: '****' }] });
            const deep = { l1: { l2: { l3: { l4: { l5: { secret: 'data' } } } } } };
            const result = policy.mask(deep) as { l1: { l2: { l3: { l4: { l5: { secret: string } } } } } };
            expect(result.l1.l2.l3.l4.l5.secret).toBe('****');
        });

        it('should return MAX_DEPTH_EXCEEDED for too deep nesting', () => {
            policy = createMaskingPolicy({ fields: [{ field: 'secret', mask: '****' }] });
            const deep = {
                l1: { l2: { l3: { l4: { l5: { l6: { secret: 'data' } } } } } },
            };
            const result = policy.mask(deep) as {
                l1: { l2: { l3: { l4: { l5: { l6: { secret: string } } } } } };
            };
            expect(result.l1.l2.l3.l4.l5.l6).toBe('[MAX_DEPTH_EXCEEDED]');
        });
    });

    describe('maskObject - array', () => {
        it('should mask sensitive fields in array', () => {
            policy = createMaskingPolicy({ fields: [{ field: 'password', mask: '********' }] });
            const result = policy.mask({
                users: [
                    { name: 'A', password: 'pass1' },
                    { name: 'B', password: 'pass2' },
                ],
            });
            expect(result).toEqual({
                users: [
                    { name: 'A', password: '********' },
                    { name: 'B', password: '********' },
                ],
            });
        });

        it('normalizes special values, errors, and cycles while masking nested fields', () => {
            policy = createMaskingPolicy({ fields: [{ field: 'password', mask: '********' }] });
            const error = new Error('diagnostic') as Error & { password: bigint };
            error.password = 123n;
            const cyclic: Record<string, unknown> = { password: new Date('2026-08-13T00:00:00.000Z') };
            cyclic.self = cyclic;

            expect(policy.mask({ error, cyclic })).toMatchObject({
                error: { name: 'Error', message: 'diagnostic', password: '********' },
                cyclic: { password: '********', self: '[Circular]' },
            });
        });
    });

    describe('switch control', () => {
        it('should mask when enabled (default)', () => {
            policy = createMaskingPolicy({});
            const result = policy.mask({ password: 'secret' });
            expect(result).toEqual({ password: '********' });
        });

        it('should not mask when disabled', () => {
            policy = createMaskingPolicy({ enabled: false });
            const result = policy.mask({ password: 'secret', count: 1n });
            expect(result).toEqual({ password: 'secret', count: '1' });
        });

        it('uses exact case-sensitive matching for field-level masks', () => {
            policy = createMaskingPolicy({ fields: [{ field: 'password', mask: '********' }] });
            expect(policy.mask({ password: 'secret', Password: 2n })).toEqual({
                password: '********',
                Password: '2',
            });
        });
    });

    describe('edge cases', () => {
        it('should handle null value', () => {
            policy = createMaskingPolicy({ fields: [{ field: 'data', mask: '****' }] });
            const result = policy.mask({ data: null });
            expect(result).toEqual({ data: '****' });
        });

        it('should handle undefined value', () => {
            policy = createMaskingPolicy({ fields: [{ field: 'data', mask: '****' }] });
            const result = policy.mask({ data: undefined });
            expect(result).toEqual({ data: '****' });
        });

        it('should handle number value', () => {
            policy = createMaskingPolicy({ fields: [{ field: 'data', mask: '****' }] });
            const result = policy.mask({ data: 12345 });
            expect(result).toEqual({ data: '****' });
        });
    });

    describe('empty string', () => {
        it('should handle empty string', () => {
            policy = createMaskingPolicy({ fields: [{ field: 'name', mask: '{last4}' }] });
            const result = policy.mask({ name: '' });
            expect(result).toEqual({ name: '' });
        });
    });

    describe('config override', () => {
        it('should use custom mask from config', () => {
            policy = createMaskingPolicy({ fields: [{ field: 'password', mask: '******' }] });
            const result = policy.mask({ password: 'secret' });
            expect(result).toEqual({ password: '******' });
        });

        it('should add custom sensitive field', () => {
            policy = createMaskingPolicy({ fields: [{ field: 'customSecret', mask: '********' }] });
            const result = policy.mask({ customSecret: 'mysecret' });
            expect(result).toEqual({ customSecret: '********' });
        });
    });
});

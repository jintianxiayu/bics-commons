import {
    CIRCULAR_PLACEHOLDER,
    INVALID_DATE_PLACEHOLDER,
    MAX_DEPTH_PLACEHOLDER,
    PROPERTY_ACCESS_ERROR_PLACEHOLDER,
    UNSERIALIZABLE_PLACEHOLDER,
    normalizeMeta,
    safeStringify,
} from '../src/core/MetaSerializer';
import { createMaskingPolicy } from '../src/core/SensitiveMasker';

const visiblePolicy = createMaskingPolicy({ enabled: false });

function normalize(value: unknown): unknown {
    return normalizeMeta(value, visiblePolicy);
}

function makeAnonymousFunction(): () => void {
    const fn = (): void => undefined;
    Object.defineProperty(fn, 'name', { value: '' });
    return fn;
}

describe('MetaSerializer', () => {
    describe('JSON-compatible values', () => {
        it.each([
            ['null', null],
            ['boolean', true],
            ['finite number', 42.5],
            ['string', 'value'],
            ['empty object', {}],
            ['array and nested object', { list: [1, 'two', false, null], nested: { ok: true } }],
        ])('preserves %s', (_label, value) => {
            expect(normalize(value)).toEqual(value);
        });

        it('does not mutate the input and duplicates shared non-circular references', () => {
            const shared = { value: 1 };
            const input = { first: shared, second: shared };

            const result = normalize(input) as Record<string, unknown>;

            expect(result).toEqual({ first: { value: 1 }, second: { value: 1 } });
            expect(result).not.toBe(input);
            expect(result.first).not.toBe(shared);
            expect(result.second).not.toBe(shared);
            expect(input.first).toBe(input.second);
        });
    });

    describe('special values', () => {
        const named = function namedFunction(): void {};
        const anonymous = makeAnonymousFunction();

        it.each([
            ['bigint', 9007199254740993n, '9007199254740993'],
            ['NaN', NaN, 'NaN'],
            ['Infinity', Infinity, 'Infinity'],
            ['negative Infinity', -Infinity, '-Infinity'],
            ['undefined', undefined, '[Undefined]'],
            ['symbol', Symbol('marker'), 'Symbol(marker)'],
            ['named function', named, '[Function: namedFunction]'],
            ['anonymous function', anonymous, '[Function: anonymous]'],
        ])('normalizes top-level %s', (_label, value, expected) => {
            expect(normalize(value)).toBe(expected);
        });

        it('uses the same mapping in objects and arrays without dropping positions', () => {
            const values = [9007199254740993n, NaN, Infinity, -Infinity, undefined, Symbol('x'), named, anonymous];
            const expected = [
                '9007199254740993',
                'NaN',
                'Infinity',
                '-Infinity',
                '[Undefined]',
                'Symbol(x)',
                '[Function: namedFunction]',
                '[Function: anonymous]',
            ];

            expect(normalize(values)).toEqual(expected);
            expect(normalize(Object.fromEntries(values.map((value, index) => [String(index), value])))).toEqual(
                Object.fromEntries(expected.map((value, index) => [String(index), value]))
            );
            expect(normalize(new Array(2))).toEqual(['[Undefined]', '[Undefined]']);
        });

        it('normalizes valid and invalid dates without changing them', () => {
            const valid = new Date('2026-08-13T01:02:03.000Z');
            const invalid = new Date(Number.NaN);

            expect(normalize({ valid, invalid })).toEqual({
                valid: '2026-08-13T01:02:03.000Z',
                invalid: INVALID_DATE_PLACEHOLDER,
            });
            expect(valid.getTime()).toBe(1786582923000);
            expect(Number.isNaN(invalid.getTime())).toBe(true);
        });
    });

    describe('cycles, depth, and hostile properties', () => {
        it('marks direct and indirect cycles but continues sibling properties', () => {
            const direct: Record<string, unknown> = { value: 1 };
            direct.self = direct;
            const array: unknown[] = [];
            const nested = { array };
            array.push(nested);

            expect(normalize(direct)).toEqual({ value: 1, self: CIRCULAR_PLACEHOLDER });
            expect(normalize(nested)).toEqual({ array: [CIRCULAR_PLACEHOLDER] });
        });

        it('truncates composite values beyond depth five but preserves primitives', () => {
            const input = {
                l1: { l2: { l3: { l4: { l5: { primitive: 'kept', composite: { hidden: true } } } } } },
            };
            const result = normalize(input) as any;

            expect(result.l1.l2.l3.l4.l5.primitive).toBe('kept');
            expect(result.l1.l2.l3.l4.l5.composite).toBe(MAX_DEPTH_PLACEHOLDER);
        });

        it('reads a normal getter once and isolates a throwing getter', () => {
            let reads = 0;
            const input = {
                get ok(): string {
                    reads += 1;
                    return 'visible';
                },
                get broken(): never {
                    throw new Error('secret getter failure');
                },
                sibling: 7,
            };

            const result = normalize(input);

            expect(result).toEqual({ ok: 'visible', broken: PROPERTY_ACCESS_ERROR_PLACEHOLDER, sibling: 7 });
            expect(reads).toBe(1);
            expect(safeStringify(result)).not.toContain('secret getter failure');
        });

        it('degrades enumeration failures without leaking the thrown message', () => {
            const input = new Proxy(
                {},
                {
                    ownKeys(): never {
                        throw new Error('raw-token-must-not-leak');
                    },
                }
            );

            const result = normalize(input);

            expect(result).toBe(UNSERIALIZABLE_PLACEHOLDER);
            expect(safeStringify(result)).not.toContain('raw-token-must-not-leak');
        });

        it('does not invoke a custom toJSON', () => {
            let calls = 0;
            const input = {
                value: 1,
                toJSON(): never {
                    calls += 1;
                    throw new Error('must not run');
                },
            };

            const result = normalize(input);

            expect(result).toEqual({ value: 1, toJSON: '[Function: toJSON]' });
            expect(safeStringify(result)).toBe('{"value":1,"toJSON":"[Function: toJSON]"}');
            expect(calls).toBe(0);
        });
    });

    describe('Error values', () => {
        it('preserves top-level and nested diagnostics, cause, and custom fields', () => {
            const cause = new TypeError('inner');
            const error = new Error('outer') as Error & {
                cause: Error;
                code: string;
                details: unknown;
                count: bigint;
            };
            Object.defineProperty(error, 'cause', { configurable: true, value: cause });
            error.code = 'E_OUTER';
            error.details = { retryable: false };
            error.count = 3n;

            const top = normalize(error) as Record<string, any>;
            const nested = normalize({ error }) as Record<string, any>;

            expect(top.name).toBe('Error');
            expect(top.message).toBe('outer');
            expect(top.stack).toContain('Error: outer');
            expect(top.cause.name).toBe('TypeError');
            expect(top.cause.message).toBe('inner');
            expect(top).toMatchObject({ code: 'E_OUTER', details: { retryable: false }, count: '3' });
            expect(nested.error).toEqual(top);
            expect(error.code).toBe('E_OUTER');
            expect(error.cause).toBe(cause);
        });

        it('handles cause cycles, depth limits, and failed standard fields', () => {
            const cyclic = new Error('cycle');
            Object.defineProperty(cyclic, 'cause', { enumerable: false, value: cyclic });
            const hostile = new Error('fallback');
            Object.defineProperty(hostile, 'message', {
                configurable: true,
                get(): never {
                    throw new Error('private diagnostic');
                },
            });
            let deep: Error = new Error('leaf');
            for (let index = 0; index < 6; index += 1) {
                const parent = new Error(`level-${index}`);
                Object.defineProperty(parent, 'cause', { configurable: true, value: deep });
                deep = parent;
            }

            expect((normalize(cyclic) as Record<string, unknown>).cause).toBe(CIRCULAR_PLACEHOLDER);
            expect((normalize(hostile) as Record<string, unknown>).message).toBe(PROPERTY_ACCESS_ERROR_PLACEHOLDER);
            expect(safeStringify(normalize(hostile))).not.toContain('private diagnostic');
            let cursor = normalize(deep) as any;
            for (let index = 0; index < 5; index += 1) cursor = cursor.cause;
            expect(cursor.cause).toBe(MAX_DEPTH_PLACEHOLDER);
        });
    });

    describe('masking collaboration and safe stringify', () => {
        it('masks special and composite sensitive values before traversing them', () => {
            const policy = createMaskingPolicy({
                fields: [
                    { field: 'token', mask: 'TOKEN_MASK' },
                    { field: 'password', mask: 'PASSWORD_MASK' },
                ],
            });
            const cyclic: Record<string, unknown> = { password: 'raw-password' };
            cyclic.self = cyclic;
            const secretError = new Error('raw-error-detail');

            const result = normalizeMeta(
                {
                    token: secretError,
                    nested: { password: 123n },
                    cyclic,
                },
                policy
            );
            const text = safeStringify(result);

            expect(result).toEqual({
                token: 'TOKEN_MASK',
                nested: { password: 'PASSWORD_MASK' },
                cyclic: { password: 'PASSWORD_MASK', self: CIRCULAR_PLACEHOLDER },
            });
            expect(text).not.toContain('raw-password');
            expect(text).not.toContain('raw-error-detail');
        });

        it('keeps exact field casing and still normalizes when masking is disabled', () => {
            const enabled = createMaskingPolicy({ fields: [{ field: 'token', mask: 'MASK' }] });
            const disabled = createMaskingPolicy({ enabled: false });
            const cyclic: Record<string, unknown> = { token: 1n, Token: 2n };
            cyclic.self = cyclic;

            expect(normalizeMeta(cyclic, enabled)).toEqual({ token: 'MASK', Token: '2', self: CIRCULAR_PLACEHOLDER });
            expect(normalizeMeta(cyclic, disabled)).toEqual({
                token: '1',
                Token: '2',
                self: CIRCULAR_PLACEHOLDER,
            });
        });

        it('returns valid JSON for snapshots and a stable fallback for unexpected input', () => {
            expect(safeStringify(normalize({ value: 1n }))).toBe('{"value":"1"}');
            expect(safeStringify(1n)).toBe('"[Unserializable]"');
        });

        it('is stable across repeated bounded traversals', () => {
            const input = { a: { b: { c: { d: { e: { primitive: 1, composite: { value: 2 } } } } } } };
            const expected = safeStringify(normalize(input));

            for (let index = 0; index < 1000; index += 1) {
                expect(safeStringify(normalize(input))).toBe(expected);
            }
        });
    });
});

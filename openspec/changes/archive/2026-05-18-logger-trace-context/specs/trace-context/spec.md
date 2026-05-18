# Trace Context

## ADDED Requirements

### Requirement: LoggerContext.set

LoggerContext SHALL provide a `set` method to store key-value pairs in the async local storage context.

```typescript
set(key: string, value: string): void
```

#### Scenario: Set and get value

- **GIVEN** LoggerContext has no stored values
- **WHEN** caller invokes `LoggerContext.set('traceId', 'abc123')`
- **THEN** subsequent `LoggerContext.get('traceId')` SHALL return `'abc123'`

#### Scenario: Overwrite existing value

- **GIVEN** LoggerContext has `traceId` set to `'old-value'`
- **WHEN** caller invokes `LoggerContext.set('traceId', 'new-value')`
- **THEN** `LoggerContext.get('traceId')` SHALL return `'new-value'`

#### Scenario: Set multiple values

- **GIVEN** LoggerContext is empty
- **WHEN** caller invokes `LoggerContext.set('traceId', 't1')` and `LoggerContext.set('userId', 'u1')`
- **THEN** `LoggerContext.get('traceId')` SHALL return `'t1'`
- **AND** `LoggerContext.get('userId')` SHALL return `'u1'`

### Requirement: LoggerContext.get

LoggerContext SHALL provide a `get` method to retrieve values by key from the async local storage context.

```typescript
get(key: string): string | undefined
```

#### Scenario: Get existing value

- **GIVEN** LoggerContext has `traceId` set to `'abc123'`
- **WHEN** caller invokes `LoggerContext.get('traceId')`
- **THEN** return value SHALL be `'abc123'`

#### Scenario: Get non-existent key

- **GIVEN** LoggerContext is empty
- **WHEN** caller invokes `LoggerContext.get('nonexistent')`
- **THEN** return value SHALL be `undefined`

### Requirement: LoggerContext.clear

LoggerContext SHALL provide a `clear` method to remove all values from the current async local storage context.

```typescript
clear(): void
```

#### Scenario: Clear all values

- **GIVEN** LoggerContext has `traceId` set to `'abc123'` and `userId` set to `'u1'`
- **WHEN** caller invokes `LoggerContext.clear()`
- **THEN** `LoggerContext.get('traceId')` SHALL return `undefined`
- **AND** `LoggerContext.get('userId')` SHALL return `undefined`

### Requirement: LoggerContext.withContext

LoggerContext SHALL provide a `withContext` method that executes a function with a given context, automatically clearing the context after the function completes.

```typescript
withContext<T>(values: Record<string, string>, fn: () => T): T
```

#### Scenario: withContext provides values to nested code

- **GIVEN** LoggerContext is empty
- **WHEN** caller invokes `LoggerContext.withContext({ traceId: 't1' }, () => logger.info('test'))`
- **THEN** the log output SHALL contain `'t1'` in place of `%{traceId}`

#### Scenario: withContext preserves outer context

- **GIVEN** LoggerContext has `userId` set to `'u1'`
- **WHEN** caller invokes `LoggerContext.withContext({ traceId: 't1' }, () => { ... })`
- **THEN** inside the callback, `LoggerContext.get('userId')` SHALL still return `'u1'`
- **AND** `LoggerContext.get('traceId')` SHALL return `'t1'`

#### Scenario: withContext cleans up after execution

- **GIVEN** LoggerContext is empty
- **WHEN** caller invokes `LoggerContext.withContext({ traceId: 't1' }, () => { ... })`
- **AND** execution of the callback completes
- **THEN** `LoggerContext.get('traceId')` SHALL return `undefined`

#### Scenario: withContext cleans up on exception

- **GIVEN** LoggerContext is empty
- **WHEN** caller invokes `LoggerContext.withContext({ traceId: 't1' }, () => { throw new Error('test') })`
- **AND** the callback throws an exception
- **THEN** after the exception propagates, `LoggerContext.get('traceId')` SHALL return `undefined`

### Requirement: %{traceId} placeholder in pattern

LoggerFactory SHALL support `%{traceId}` as a placeholder in log patterns that resolves to the traceId stored in LoggerContext.

```typescript
// Example pattern: '%{timestamp} %{level} [%{traceId}] %{message}'
```

#### Scenario: TraceId exists in context

- **GIVEN** LoggerContext has `traceId` set to `'abc123'`
- **WHEN** caller invokes `logger.info('hello')`
- **THEN** the log output SHALL contain `[abc123]` at the position of `%{traceId}`

#### Scenario: TraceId not in context

- **GIVEN** LoggerContext is empty (no traceId set)
- **WHEN** caller invokes `logger.info('hello')`
- **THEN** the log output SHALL contain `[-]` at the position of `%{traceId}`

### Requirement: AsyncLocalStorage context propagation

LoggerContext SHALL use AsyncLocalStorage to ensure traceId is available across async call chains.

#### Scenario: TraceId available in async callback

- **GIVEN** LoggerContext has `traceId` set to `'t1'`
- **WHEN** caller invokes an async function that calls `logger.info('async')` from within a `.then()` callback
- **THEN** the log output SHALL contain `'t1'` for `%{traceId}`

#### Scenario: withContext works across async boundaries

- **GIVEN** LoggerContext is empty
- **WHEN** caller invokes `LoggerContext.withContext({ traceId: 't1' }, async () => { await someAsyncOperation(); logger.info('after async'); })`
- **THEN** the log output SHALL contain `'t1'` for `%{traceId}`
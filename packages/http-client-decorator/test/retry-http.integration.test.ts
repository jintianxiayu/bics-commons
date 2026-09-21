import 'reflect-metadata';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Body, Get, HttpClient, HttpError, Post } from '../src';

interface ServerState {
    counts: Map<string, number>;
    jsonBodies: string[];
}

function writeJson(response: ServerResponse, status: number, data: unknown): void {
    response.statusCode = status;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(data));
}

async function readBody(request: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
}

function createTestServer(state: ServerState): Server {
    return createServer(async (request, response) => {
        const path = request.url ?? '/';
        const count = (state.counts.get(path) ?? 0) + 1;
        state.counts.set(path, count);

        if (path === '/flaky') {
            writeJson(response, count === 1 ? 503 : 200, { count });
            return;
        }
        if (path === '/always') {
            writeJson(response, 503, { count });
            return;
        }
        if (path === '/missing') {
            writeJson(response, 404, { message: 'missing' });
            return;
        }
        if (path === '/accepted') {
            writeJson(response, 503, { accepted: true });
            return;
        }
        if (path === '/json') {
            state.jsonBodies.push(await readBody(request));
            writeJson(response, count === 1 ? 503 : 200, { count });
            return;
        }
        writeJson(response, 500, { unexpected: path });
    });
}

async function listen(server: Server): Promise<string> {
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
    server.closeAllConnections?.();
    await new Promise<void>((resolve, reject) => {
        server.close((error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}

describe('重试本地 HTTP 集成', () => {
    let server: Server;
    let state: ServerState;
    let baseURL: string;

    beforeEach(async () => {
        state = { counts: new Map(), jsonBodies: [] };
        server = createTestServer(state);
        baseURL = await listen(server);
    });

    afterEach(async () => {
        await close(server);
    });

    it('实际发送 503 后成功，并按配置限制持续失败次数', async () => {
        @HttpClient({ baseURL })
        class Client {
            @Get('/flaky', { retry: { retries: 1, retryDelay: () => 0 } })
            flaky(): Promise<{ count: number }> {
                throw new Error('Original method should not execute');
            }

            @Get('/always', { retry: { retries: 2, retryDelay: () => 0 } })
            always(): Promise<unknown> {
                throw new Error('Original method should not execute');
            }
        }

        const client = new Client();
        await expect(client.flaky()).resolves.toEqual({ count: 2 });
        await expect(client.always()).rejects.toMatchObject<HttpError>({
            status: 503,
            data: { count: 3 },
            message: `HTTP 503: ${baseURL}/always`,
        });
        expect(state.counts.get('/flaky')).toBe(2);
        expect(state.counts.get('/always')).toBe(3);
    });

    it('保留 404 错误，并允许显式 validateResponse 接受 503', async () => {
        @HttpClient({ baseURL })
        class Client {
            @Get('/missing')
            missing(): Promise<unknown> {
                throw new Error('Original method should not execute');
            }

            @Get('/accepted', { retry: { validateResponse: (response) => response.status === 503 } })
            accepted(): Promise<{ accepted: boolean }> {
                throw new Error('Original method should not execute');
            }
        }

        const client = new Client();
        await expect(client.missing()).rejects.toMatchObject<HttpError>({
            status: 404,
            data: { message: 'missing' },
            message: `HTTP 404: ${baseURL}/missing`,
        });
        await expect(client.accepted()).resolves.toEqual({ accepted: true });
        expect(state.counts.get('/missing')).toBe(1);
        expect(state.counts.get('/accepted')).toBe(1);
    });

    it('重试 POST 时保持 JSON 请求体内容一致', async () => {
        @HttpClient({ baseURL })
        class Client {
            @Post('/json', {
                retry: {
                    retries: 1,
                    retryDelay: () => 0,
                    retryCondition: () => true,
                },
            })
            send(@Body() _body: { name: string }): Promise<{ count: number }> {
                throw new Error('Original method should not execute');
            }
        }

        await expect(new Client().send({ name: 'Alice' })).resolves.toEqual({ count: 2 });
        expect(state.jsonBodies).toEqual(['{"name":"Alice"}', '{"name":"Alice"}']);
    });
});

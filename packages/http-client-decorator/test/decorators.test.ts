import 'reflect-metadata';
import {
    HttpClient,
    Get,
    Post,
    Put,
    Delete,
    Patch,
    Path,
    Query,
    Body,
    Header,
    getMethodMetadata,
    getParamMetadata,
} from '../src';

describe('装饰器元数据存储和读取', () => {
    describe('@HttpClient', () => {
        it('should store config in metadata', () => {
            @HttpClient({ baseURL: 'https://api.example.com' })
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            class TestService {}

            const config = (
                Reflect as unknown as { getMetadata: (key: symbol, target: object) => unknown }
            ).getMetadata(Symbol.for('bics:http-client:config'), TestService);
            expect(config).toEqual({ baseURL: 'https://api.example.com' });
        });

        it('should store config with middlewares', () => {
            const mockMw = async () => {};
            @HttpClient({ baseURL: 'https://api.example.com', middlewares: [mockMw] })
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            class TestService {}

            const config = (
                Reflect as unknown as { getMetadata: (key: symbol, target: object) => unknown }
            ).getMetadata(Symbol.for('bics:http-client:config'), TestService) as {
                baseURL: string;
                middlewares: unknown[];
            };
            expect(config.baseURL).toBe('https://api.example.com');
            expect(config.middlewares).toHaveLength(1);
            expect(config.middlewares[0]).toBe(mockMw);
        });
    });

    describe('@Get/@Post/@Put/@Delete/@Patch', () => {
        it('should store GET method metadata', () => {
            class TestService {
                @Get('/users/:id')
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                getUser() {}
            }

            const meta = getMethodMetadata(TestService.prototype, 'getUser');
            expect(meta).toEqual({ method: 'GET', path: '/users/:id' });
        });

        it('should store POST method metadata', () => {
            class TestService {
                @Post('/users')
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                createUser() {}
            }

            const meta = getMethodMetadata(TestService.prototype, 'createUser');
            expect(meta).toEqual({ method: 'POST', path: '/users' });
        });

        it('should store PUT method metadata', () => {
            class TestService {
                @Put('/users/:id')
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                updateUser() {}
            }

            const meta = getMethodMetadata(TestService.prototype, 'updateUser');
            expect(meta).toEqual({ method: 'PUT', path: '/users/:id' });
        });

        it('should store DELETE method metadata', () => {
            class TestService {
                @Delete('/users/:id')
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                deleteUser() {}
            }

            const meta = getMethodMetadata(TestService.prototype, 'deleteUser');
            expect(meta).toEqual({ method: 'DELETE', path: '/users/:id' });
        });

        it('should store PATCH method metadata', () => {
            class TestService {
                @Patch('/users/:id')
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                patchUser() {}
            }

            const meta = getMethodMetadata(TestService.prototype, 'patchUser');
            expect(meta).toEqual({ method: 'PATCH', path: '/users/:id' });
        });
    });

    describe('@Path/@Query/@Body/@Header', () => {
        it('should store Path param metadata', () => {
            class TestService {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                getUser(@Path('id') _id: string) {}
            }

            const meta = getParamMetadata(TestService.prototype, 'getUser');
            expect(meta).toContainEqual({ paramIndex: 0, paramType: 'path', paramName: 'id' });
        });

        it('should store Query param metadata', () => {
            class TestService {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                search(@Query('keyword') _keyword: string) {}
            }

            const meta = getParamMetadata(TestService.prototype, 'search');
            expect(meta).toContainEqual({ paramIndex: 0, paramType: 'query', paramName: 'keyword' });
        });

        it('should store Body param metadata', () => {
            class TestService {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                create(@Body() _dto: unknown) {}
            }

            const meta = getParamMetadata(TestService.prototype, 'create');
            expect(meta).toContainEqual({ paramIndex: 0, paramType: 'body' });
        });

        it('should store Header param metadata', () => {
            class TestService {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                getWithAuth(@Header('Authorization') _token: string) {}
            }

            const meta = getParamMetadata(TestService.prototype, 'getWithAuth');
            expect(meta).toContainEqual({ paramIndex: 0, paramType: 'header', paramName: 'Authorization' });
        });

        it('should store all param metadata when multiple params exist', () => {
            class TestService {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                complex(
                    @Path('id') _id: string,
                    @Query('expand') _expand: string,
                    @Header('X-Custom') _header: string,
                    @Body() _body: unknown
                ) {}
            }

            const meta = getParamMetadata(TestService.prototype, 'complex');
            // Sort by paramIndex to ensure correct order
            const sortedMeta = [...meta].sort((a, b) => a.paramIndex - b.paramIndex);
            expect(sortedMeta).toHaveLength(4);
            expect(sortedMeta[0]).toEqual({ paramIndex: 0, paramType: 'path', paramName: 'id' });
            expect(sortedMeta[1]).toEqual({ paramIndex: 1, paramType: 'query', paramName: 'expand' });
            expect(sortedMeta[2]).toEqual({ paramIndex: 2, paramType: 'header', paramName: 'X-Custom' });
            expect(sortedMeta[3]).toEqual({ paramIndex: 3, paramType: 'body' });
        });
    });
});

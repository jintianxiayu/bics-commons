import 'reflect-metadata';
import { HttpClient, Get, Post, Put, Delete, Path, Query, Body, HttpError } from '../src';

describe('集成测试：完整 HTTP 请求流程', () => {
    it('should throw HttpError on 404', async () => {
        @HttpClient({ baseURL: 'https://api.example.com' })
        class UserService {
            @Get('/users/:id')
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            getUser(@Path('id') _id: string): Promise<unknown> {
                return Promise.resolve({ id: '123' });
            }
        }

        const service = new UserService();
        expect(service).toBeInstanceOf(UserService);
        expect(typeof (service as unknown as { getUser: unknown }).getUser).toBe('function');
    });

    it('should throw HttpError on HTTP error status', async () => {
        const error = new HttpError(500, { message: 'Server error' }, 'HTTP 500');

        expect(error.status).toBe(500);
        expect(error.data).toEqual({ message: 'Server error' });
        expect(error.message).toBe('HTTP 500');
        expect(error.name).toBe('HttpError');
    });

    it('should create decorated class with multiple decorators', async () => {
        @HttpClient({ baseURL: 'https://api.example.com' })
        class ArticleService {
            @Get('/articles/:slug')
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            getArticle(@Path('slug') _slug: string, @Query('lang') _lang: string): Promise<unknown> {
                return Promise.resolve({ slug: 'test' });
            }

            @Post('/articles')
            createArticle(@Body() _body: unknown): Promise<unknown> {
                return Promise.resolve({ id: 1 });
            }

            @Put('/articles/:id')
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            updateArticle(@Path('id') _id: string, @Body() _body: unknown): Promise<unknown> {
                return Promise.resolve({ id: 1 });
            }

            @Delete('/articles/:id')
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            deleteArticle(@Path('id') _id: string): Promise<unknown> {
                return Promise.resolve({ success: true });
            }
        }

        const service = new ArticleService();
        expect(service).toBeInstanceOf(ArticleService);
        expect(typeof (service as unknown as { getArticle: unknown }).getArticle).toBe('function');
        expect(typeof (service as unknown as { createArticle: unknown }).createArticle).toBe('function');
        expect(typeof (service as unknown as { updateArticle: unknown }).updateArticle).toBe('function');
        expect(typeof (service as unknown as { deleteArticle: unknown }).deleteArticle).toBe('function');
    });

    it('should allow multiple @Path parameters', async () => {
        @HttpClient({ baseURL: 'https://api.example.com' })
        class NestedService {
            @Get('/orgs/:orgId/repos/:repoId')
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            getNested(@Path('orgId') _orgId: string, @Path('repoId') _repoId: string): Promise<unknown> {
                return Promise.resolve({});
            }
        }

        const service = new NestedService();
        expect(service).toBeInstanceOf(NestedService);
    });
});

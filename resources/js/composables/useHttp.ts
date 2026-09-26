import { useHttp as useInertiaHttp } from '@inertiajs/vue3'

type Body = object
type ValidationErrors = Record<string, string | string[]>

/**
 * A failed request. `status` is 0 when no response arrived (network error or
 * cancellation). `detail` is FastAPI's error payload when the body carries one.
 */
export class HttpRequestError extends Error {
    readonly status: number
    readonly body: unknown
    readonly detail: unknown
    readonly errors: ValidationErrors

    constructor(message: string, init: { status: number; body?: unknown; errors?: ValidationErrors; cause?: unknown }) {
        super(message, { cause: init.cause })
        this.name = 'HttpRequestError'
        this.status = init.status
        this.body = init.body
        this.detail = isRecord(init.body) ? init.body.detail : undefined
        this.errors = init.errors ?? {}
    }
}

export interface HttpClient<TResult extends 'throw' | 'lenient' = 'lenient'> {
    get<T>(url: string): Promise<Resolved<T, TResult>>
    delete<T>(url: string): Promise<Resolved<T, TResult>>
    post<T>(url: string, body?: Body): Promise<Resolved<T, TResult>>
    put<T>(url: string, body?: Body): Promise<Resolved<T, TResult>>
    patch<T>(url: string, body?: Body): Promise<Resolved<T, TResult>>
    /** A client that rejects with {@link HttpRequestError} on every failure, 422 included. */
    throwOnError(): HttpClient<'throw'>
    cancel(): void
}

// Inertia resolves a 422 with undefined, so only the throwing client can promise a value.
type Resolved<T, TResult> = TResult extends 'throw' ? T : T | undefined

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete'

/**
 * Thin client over Inertia's `useHttp`: one generic call per verb, with the
 * request body passed per call.
 *
 * Call it during component/composable setup, never inside a query or mutation
 * function: the underlying Inertia instance owns reactive state and watchers,
 * so creating one per request leaks. Requests on one client share Inertia's
 * abort controller and `processing` flag; use separate clients for requests
 * that may overlap (e.g. a poll and a mutation).
 *
 * @example
 * const http = useHttp().throwOnError()
 * const checkin = await http.get<AgentCheckin>(url)
 * await http.patch<AgentCheckin>(url, { enabled: true })
 */
export function useHttp(): HttpClient {
    const inertia = useInertiaHttp<Record<string, never>, unknown>()

    function createClient(throwOnError: boolean): HttpClient<'throw' | 'lenient'> {
        async function request<T>(method: Method, url: string, body: Body = {}): Promise<T> {
            // Inertia reads the transform synchronously when the request starts, so
            // setting it per call cannot leak one call's body into an overlapping one.
            inertia.transform(() => body as Record<string, never>)
            let validationErrors: ValidationErrors | undefined
            try {
                const data = await inertia[method](url, {
                    onError: errors => { validationErrors = errors as ValidationErrors },
                })
                if (validationErrors !== undefined && throwOnError) {
                    // Inertia hands over only the `errors` key of a 422 body, so FastAPI's
                    // `detail` is not recoverable here; `errors` is empty for those.
                    throw new HttpRequestError(`Request to ${url} failed validation`, { status: 422, errors: validationErrors })
                }
                return data as T
            } catch (error) {
                if (!throwOnError || error instanceof HttpRequestError) throw error
                throw toRequestError(error, url)
            }
        }

        return Object.freeze({
            get: <T>(url: string) => request<T>('get', url),
            delete: <T>(url: string) => request<T>('delete', url),
            post: <T>(url: string, body?: Body) => request<T>('post', url, body),
            put: <T>(url: string, body?: Body) => request<T>('put', url, body),
            patch: <T>(url: string, body?: Body) => request<T>('patch', url, body),
            throwOnError: () => createClient(true) as HttpClient<'throw'>,
            cancel: () => inertia.cancel(),
        })
    }

    return createClient(false) as HttpClient
}

function toRequestError(error: unknown, url: string): HttpRequestError {
    const response = isRecord(error) && isRecord(error.response) ? error.response : undefined
    if (!response) {
        const reason = error instanceof Error ? error.message : 'unknown error'
        return new HttpRequestError(`Request to ${url} failed: ${reason}`, { status: 0, cause: error })
    }
    const status = Number(response.status)
    const body = parseBody(response.data)
    const detail = isRecord(body) ? body.detail : undefined
    const message = typeof detail === 'string' ? detail : `Request to ${url} failed with status ${status}`
    return new HttpRequestError(message, { status, body, cause: error })
}

function parseBody(data: unknown): unknown {
    if (typeof data !== 'string') return data
    try {
        return JSON.parse(data)
    } catch {
        return data || undefined
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

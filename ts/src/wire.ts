// Generated from openapi/arex-v1.json by scripts/generate-wire.ts; do not edit.
export interface paths {
    "/v1/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Find web pages matching a query. Returns up to limit ranked results, each with a title, URL, and optional snippet and published_at timestamp, for locating specific pages, documentation, or candidate sources; optional published_after and published_before bound publication time. */
        post: operations["search"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/contents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Extract clean Markdown text and metadata from one public HTTP(S) page. content holds at most max_characters and truncated reports whether more exists; title, published_at and image URLs are included when known. tier is auto or flex (flex may take longer); livecrawl forces a fresh crawl instead of cached content. */
        post: operations["contents"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/research": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Start a Research Run that researches a natural-language query across multiple web sources and returns a synthesized answer with cited sources (well-suited for open-ended, comparative, or recent-developments questions). By default, fast Runs wait up to 20 seconds to return a terminal Run (200 with status completed, failed or cancelled), while deep Runs and Runs still in progress return 202 with status queued or running and message; pass Prefer: respond-async to return 202 immediately after admission. When status is queued or running, poll GET /v1/research/{id} until status is completed (result holds answer and sources), failed or cancelled. mode defaults to auto (recommended), which routes between fast and deep from the query; fast or deep can be specified when needed. */
        post: operations["createResearchRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/research/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Read a Research Run created with the same API key. queued and running are not final: read it again until status is completed, failed or cancelled. */
        get: operations["getResearchRun"];
        put?: never;
        post?: never;
        /** @description Delete a Research Run created with the same API key. Returns 204 once deleted; a Run that is still running is cancelled first and returns 202 with the Run until deletion completes. */
        delete: operations["deleteResearchRun"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/research/{id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Cancel a queued or running Research Run created with the same API key. 202 means cancellation is still in progress; run_not_cancellable means the Run already ended. */
        post: operations["cancelResearchRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        SearchRequest: {
            /** @description Search query used to find matching web pages. */
            query: string;
            /** @default 10 */
            limit?: number;
            /**
             * Format: date-time
             * @description Optional UTC ISO 8601 date-time lower bound (for example 2026-09-21T00:00:00Z).
             */
            published_after?: string;
            /**
             * Format: date-time
             * @description Optional UTC ISO 8601 date-time upper bound (for example 2026-10-21T23:59:59Z).
             */
            published_before?: string;
        };
        SearchResponse: {
            results: {
                title: string;
                url: string;
                snippet?: string;
                /** Format: date-time */
                published_at?: string;
            }[];
        };
        ContentsRequest: {
            /**
             * Format: uri
             * @description Absolute HTTP(S) URL without username or password.
             */
            url: string;
            /**
             * @default auto
             * @enum {string}
             */
            tier?: "auto" | "flex";
            /** @default false */
            livecrawl?: boolean;
            livecrawl_timeout_ms?: number;
            /** @default 20000 */
            max_characters?: number;
        };
        ContentsResponse: {
            url: string;
            title?: string;
            published_at?: string;
            image_url?: string;
            image_urls?: string[];
            content: string;
            truncated: boolean;
        };
        ResearchCreateRequest: {
            /** @description Complete natural-language question or research topic (including all compared entities, context, and constraints) to answer with cited web sources. */
            query: string;
            /**
             * @description Defaults to auto (leave unset for both simple and complex questions). Set fast or deep when the user's prompt explicitly requests fast or deep mode.
             * @default auto
             * @enum {string}
             */
            mode?: "auto" | "fast" | "deep";
        };
        ResearchRun: {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            status: "queued" | "running" | "completed" | "failed" | "cancelled";
            /** @enum {string} */
            mode: "fast" | "deep";
            /** @enum {string} */
            requested_mode: "auto" | "fast" | "deep";
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            started_at?: string;
            /** Format: date-time */
            completed_at?: string;
            result?: {
                answer: string;
                sources: {
                    title: string;
                    url: string;
                }[];
            };
            error?: {
                /** @enum {string} */
                code: "timeout" | "execution_failed" | "worker_unavailable" | "interrupted";
                retryable: boolean;
            };
            /** @description Informational English polling guidance present when status is queued or running; omitted on terminal states. Clients branch on status rather than parsing this text. */
            message?: string;
        } & (unknown & unknown & unknown);
        Error: {
            error: {
                /** @enum {string} */
                code: "invalid_request" | "content_blocked" | "unauthorized" | "registration_required" | "account_deletion_pending" | "not_found" | "method_not_allowed" | "run_not_cancellable" | "source_not_available" | "rate_limit_exceeded" | "outstanding_run_limit" | "daily_credits_exhausted" | "weekly_credits_exhausted" | "internal_error" | "temporarily_unavailable";
                message: string;
                retryable: boolean;
                request_id: string;
                param?: string;
            };
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: {
        /** @description Echoed valid request ID, otherwise a fresh UUID; also error.request_id. */
        "X-Request-Id": string;
        /** @description Authenticated request window limit. May be omitted. */
        "X-RateLimit-Limit": number;
        /** @description Requests remaining in the window. May be omitted. */
        "X-RateLimit-Remaining": number;
        /** @description Integer seconds until the request window resets. May be omitted. */
        "X-RateLimit-Reset": number;
        /** @description Canonical resource path for the created or polled Run. */
        Location: string;
        /** @description Echoed RFC 7240 preference applied by the server (respond-async or wait=N). */
        "Preference-Applied": string;
        /** @description Delta seconds before retrying on 429 or 503; may also indicate an asynchronous polling interval. */
        "Retry-After": number;
        /** @description Bearer authentication challenge on 401. */
        "WWW-Authenticate": "Bearer";
    };
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    search: {
        parameters: {
            query?: never;
            header?: {
                /** @description A matching value is echoed; invalid values are replaced by a UUID. */
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SearchRequest"];
            };
        };
        responses: {
            /** @description Successful response. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SearchResponse"];
                };
            };
            /** @description invalid_request, content_blocked */
            400: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "invalid_request" | "content_blocked";
                        };
                    };
                };
            };
            /** @description unauthorized */
            401: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "unauthorized";
                        };
                    };
                };
            };
            /** @description registration_required, account_deletion_pending */
            403: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "registration_required" | "account_deletion_pending";
                        };
                    };
                };
            };
            /** @description method_not_allowed */
            405: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "method_not_allowed";
                        };
                    };
                };
            };
            /** @description rate_limit_exceeded, daily_credits_exhausted, weekly_credits_exhausted */
            429: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "rate_limit_exceeded" | "daily_credits_exhausted" | "weekly_credits_exhausted";
                        };
                    };
                };
            };
            /** @description internal_error */
            500: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "internal_error";
                        };
                    };
                };
            };
            /** @description temporarily_unavailable */
            503: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "temporarily_unavailable";
                        };
                    };
                };
            };
        };
    };
    contents: {
        parameters: {
            query?: never;
            header?: {
                /** @description A matching value is echoed; invalid values are replaced by a UUID. */
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ContentsRequest"];
            };
        };
        responses: {
            /** @description Successful response. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContentsResponse"];
                };
            };
            /** @description invalid_request, content_blocked */
            400: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "invalid_request" | "content_blocked";
                        };
                    };
                };
            };
            /** @description unauthorized */
            401: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "unauthorized";
                        };
                    };
                };
            };
            /** @description registration_required, account_deletion_pending */
            403: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "registration_required" | "account_deletion_pending";
                        };
                    };
                };
            };
            /** @description method_not_allowed */
            405: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "method_not_allowed";
                        };
                    };
                };
            };
            /** @description source_not_available */
            422: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "source_not_available";
                        };
                    };
                };
            };
            /** @description rate_limit_exceeded, daily_credits_exhausted, weekly_credits_exhausted */
            429: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "rate_limit_exceeded" | "daily_credits_exhausted" | "weekly_credits_exhausted";
                        };
                    };
                };
            };
            /** @description internal_error */
            500: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "internal_error";
                        };
                    };
                };
            };
            /** @description temporarily_unavailable */
            503: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "temporarily_unavailable";
                        };
                    };
                };
            };
        };
    };
    createResearchRun: {
        parameters: {
            query?: never;
            header?: {
                /** @description A matching value is echoed; invalid values are replaced by a UUID. */
                "X-Request-Id"?: string;
                /** @description RFC 7240 processing preference: respond-async returns 202 immediately after admission; wait=N bounds synchronous waiting to N seconds (capped at 20 seconds). */
                Prefer?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResearchCreateRequest"];
            };
        };
        responses: {
            /** @description Successful response. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResearchRun"];
                };
            };
            /** @description Accepted; asynchronous work is pending. */
            202: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResearchRun"];
                };
            };
            /** @description invalid_request, content_blocked */
            400: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "invalid_request" | "content_blocked";
                        };
                    };
                };
            };
            /** @description unauthorized */
            401: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "unauthorized";
                        };
                    };
                };
            };
            /** @description registration_required, account_deletion_pending */
            403: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "registration_required" | "account_deletion_pending";
                        };
                    };
                };
            };
            /** @description method_not_allowed */
            405: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "method_not_allowed";
                        };
                    };
                };
            };
            /** @description rate_limit_exceeded, daily_credits_exhausted, weekly_credits_exhausted, outstanding_run_limit */
            429: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "rate_limit_exceeded" | "daily_credits_exhausted" | "weekly_credits_exhausted" | "outstanding_run_limit";
                        };
                    };
                };
            };
            /** @description internal_error */
            500: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "internal_error";
                        };
                    };
                };
            };
            /** @description temporarily_unavailable */
            503: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "temporarily_unavailable";
                        };
                    };
                };
            };
        };
    };
    getResearchRun: {
        parameters: {
            query?: never;
            header?: {
                /** @description A matching value is echoed; invalid values are replaced by a UUID. */
                "X-Request-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful response. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResearchRun"];
                };
            };
            /** @description invalid_request */
            400: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "invalid_request";
                        };
                    };
                };
            };
            /** @description unauthorized */
            401: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "unauthorized";
                        };
                    };
                };
            };
            /** @description registration_required, account_deletion_pending */
            403: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "registration_required" | "account_deletion_pending";
                        };
                    };
                };
            };
            /** @description not_found */
            404: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "not_found";
                        };
                    };
                };
            };
            /** @description method_not_allowed */
            405: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "method_not_allowed";
                        };
                    };
                };
            };
            /** @description rate_limit_exceeded */
            429: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "rate_limit_exceeded";
                        };
                    };
                };
            };
            /** @description internal_error */
            500: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "internal_error";
                        };
                    };
                };
            };
            /** @description temporarily_unavailable */
            503: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "temporarily_unavailable";
                        };
                    };
                };
            };
        };
    };
    deleteResearchRun: {
        parameters: {
            query?: never;
            header?: {
                /** @description A matching value is echoed; invalid values are replaced by a UUID. */
                "X-Request-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Accepted; asynchronous work is pending. */
            202: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResearchRun"];
                };
            };
            /** @description Deleted; no response body. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description invalid_request */
            400: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "invalid_request";
                        };
                    };
                };
            };
            /** @description unauthorized */
            401: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "unauthorized";
                        };
                    };
                };
            };
            /** @description registration_required, account_deletion_pending */
            403: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "registration_required" | "account_deletion_pending";
                        };
                    };
                };
            };
            /** @description not_found */
            404: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "not_found";
                        };
                    };
                };
            };
            /** @description method_not_allowed */
            405: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "method_not_allowed";
                        };
                    };
                };
            };
            /** @description rate_limit_exceeded */
            429: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "rate_limit_exceeded";
                        };
                    };
                };
            };
            /** @description internal_error */
            500: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "internal_error";
                        };
                    };
                };
            };
            /** @description temporarily_unavailable */
            503: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "temporarily_unavailable";
                        };
                    };
                };
            };
        };
    };
    cancelResearchRun: {
        parameters: {
            query?: never;
            header?: {
                /** @description A matching value is echoed; invalid values are replaced by a UUID. */
                "X-Request-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful response. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResearchRun"];
                };
            };
            /** @description Accepted; asynchronous work is pending. */
            202: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResearchRun"];
                };
            };
            /** @description invalid_request */
            400: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "invalid_request";
                        };
                    };
                };
            };
            /** @description unauthorized */
            401: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "unauthorized";
                        };
                    };
                };
            };
            /** @description registration_required, account_deletion_pending */
            403: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "registration_required" | "account_deletion_pending";
                        };
                    };
                };
            };
            /** @description not_found */
            404: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "not_found";
                        };
                    };
                };
            };
            /** @description method_not_allowed */
            405: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "method_not_allowed";
                        };
                    };
                };
            };
            /** @description run_not_cancellable */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "run_not_cancellable";
                        };
                    };
                };
            };
            /** @description rate_limit_exceeded */
            429: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "rate_limit_exceeded";
                        };
                    };
                };
            };
            /** @description internal_error */
            500: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "internal_error";
                        };
                    };
                };
            };
            /** @description temporarily_unavailable */
            503: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "X-RateLimit-Limit": components["headers"]["X-RateLimit-Limit"];
                    "X-RateLimit-Remaining": components["headers"]["X-RateLimit-Remaining"];
                    "X-RateLimit-Reset": components["headers"]["X-RateLimit-Reset"];
                    Location: components["headers"]["Location"];
                    "Preference-Applied": components["headers"]["Preference-Applied"];
                    "Retry-After": components["headers"]["Retry-After"];
                    "WWW-Authenticate": components["headers"]["WWW-Authenticate"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"] & {
                        error?: {
                            /** @enum {unknown} */
                            code?: "temporarily_unavailable";
                        };
                    };
                };
            };
        };
    };
}

export const WIRE_LIMITS = {
	"search": {
		"query": {
			"minLength": 1,
			"maxLength": 2000
		},
		"limit": {
			"minimum": 1,
			"maximum": 10,
			"default": 10
		}
	},
	"contents": {
		"url": {
			"maxLength": 8192
		},
		"tier": {
			"enum": [
				"auto",
				"flex"
			],
			"default": "auto"
		},
		"maxCharacters": {
			"minimum": 1,
			"maximum": 600000,
			"default": 20000
		},
		"livecrawlTimeoutMs": {
			"minimum": 1000,
			"maximum": 90000
		},
		"imageUrls": {
			"maxItems": 50
		}
	},
	"research": {
		"query": {
			"minLength": 1,
			"maxLength": 2000
		},
		"mode": {
			"enum": [
				"auto",
				"fast",
				"deep"
			],
			"default": "auto"
		},
		"runMode": {
			"enum": [
				"fast",
				"deep"
			]
		}
	},
	"errorCodes": [
		"invalid_request",
		"content_blocked",
		"unauthorized",
		"registration_required",
		"account_deletion_pending",
		"not_found",
		"method_not_allowed",
		"run_not_cancellable",
		"source_not_available",
		"rate_limit_exceeded",
		"outstanding_run_limit",
		"daily_credits_exhausted",
		"weekly_credits_exhausted",
		"internal_error",
		"temporarily_unavailable"
	],
	"researchFailureCodes": [
		"timeout",
		"execution_failed",
		"worker_unavailable",
		"interrupted"
	]
} as const;

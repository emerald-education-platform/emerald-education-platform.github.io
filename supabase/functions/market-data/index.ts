const allowedOrigins = new Set([
    'https://emerald-education-platform.github.io',
    'http://127.0.0.1:4173',
    'http://localhost:4173'
]);

const allowedIntervals = new Set(['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h', '1d', '5d', '1wk', '1mo', '3mo']);
const allowedRanges = new Set(['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max']);
const cache = new Map<string, { savedAt: number; data: Record<string, unknown> }>();
const cacheLifetimeMs = 45_000;

function corsHeaders(request: Request): Record<string, string> {
    const origin = request.headers.get('origin');
    const allowedOrigin = origin && allowedOrigins.has(origin)
        ? origin
        : 'https://emerald-education-platform.github.io';

    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Vary': 'Origin'
    };
}

function jsonResponse(request: Request, body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            ...corsHeaders(request),
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store'
        }
    });
}

function normalizeSymbol(value: unknown): string | null {
    const symbol = String(value || '').trim().toUpperCase().replaceAll('.', '-');
    return /^[A-Z0-9^=-]{1,15}$/.test(symbol) ? symbol : null;
}

async function fetchYahooChart(
    symbol: string,
    interval: string,
    range: string
): Promise<Record<string, unknown>> {
    const cacheKey = `${symbol}:${interval}:${range}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.savedAt < cacheLifetimeMs) return cached.data;

    let lastError = 'Yahoo Finance request failed';
    for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
        const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`;

        try {
            const response = await fetch(url, {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (compatible; EmeraldEducation/1.0)'
                },
                signal: AbortSignal.timeout(10_000)
            });

            if (!response.ok) {
                lastError = `Yahoo Finance returned HTTP ${response.status}`;
                continue;
            }

            const data = await response.json() as {
                chart?: {
                    result?: unknown[];
                    error?: { description?: string };
                };
            };
            if (!data?.chart?.result?.length) {
                lastError = data?.chart?.error?.description || `No data returned for ${symbol}`;
                continue;
            }

            cache.set(cacheKey, { savedAt: Date.now(), data });
            return data as Record<string, unknown>;
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
        }
    }

    throw new Error(lastError);
}

Deno.serve(async (request: Request) => {
    if (request.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders(request) });
    }

    if (request.method !== 'POST') {
        return jsonResponse(request, { error: 'Method not allowed' }, 405);
    }

    const origin = request.headers.get('origin');
    if (origin && !allowedOrigins.has(origin)) {
        return jsonResponse(request, { error: 'Origin not allowed' }, 403);
    }

    let body: { symbols?: unknown; interval?: string; range?: string };
    try {
        body = await request.json();
    } catch {
        return jsonResponse(request, { error: 'Request body must be valid JSON' }, 400);
    }

    if (!Array.isArray(body.symbols) || body.symbols.length === 0 || body.symbols.length > 25) {
        return jsonResponse(request, { error: 'Provide between 1 and 25 stock symbols' }, 400);
    }

    const normalizedSymbols = body.symbols.map(normalizeSymbol);
    if (normalizedSymbols.includes(null)) {
        return jsonResponse(request, { error: 'One or more stock symbols are invalid' }, 400);
    }
    const symbols = [...new Set(normalizedSymbols)] as string[];

    const interval = typeof body.interval === 'string' && allowedIntervals.has(body.interval)
        ? body.interval
        : '1d';
    const range = typeof body.range === 'string' && allowedRanges.has(body.range)
        ? body.range
        : '1mo';
    const results = await Promise.allSettled(
        symbols.map(symbol => fetchYahooChart(symbol, interval, range))
    );

    const charts: Record<string, Record<string, unknown>> = {};
    const errors: Record<string, string> = {};
    results.forEach((result, index) => {
        const symbol = symbols[index];
        if (result.status === 'fulfilled') {
            charts[symbol] = result.value;
        } else {
            errors[symbol] = result.reason instanceof Error
                ? result.reason.message
                : String(result.reason);
        }
    });

    if (Object.keys(charts).length === 0) {
        return jsonResponse(request, { error: 'Market data is temporarily unavailable', errors }, 502);
    }

    return jsonResponse(request, { charts, errors });
});

import { createClient } from 'npm:@supabase/supabase-js@2';

const allowedOrigins = new Set([
    'https://emerald-education-platform.github.io',
    'http://127.0.0.1:4173',
    'http://localhost:4173'
]);

function corsHeaders(request: Request): Record<string, string> {
    const origin = request.headers.get('origin');
    return {
        'Access-Control-Allow-Origin': origin && allowedOrigins.has(origin)
            ? origin
            : 'https://emerald-education-platform.github.io',
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

function isMissingRelationError(error: { code?: string; message?: string } | null): boolean {
    if (!error) return false;
    return error.code === '42P01'
        || error.code === 'PGRST205'
        || /does not exist|schema cache|could not find the table/i.test(error.message || '');
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

    const authorization = request.headers.get('authorization');
    const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!accessToken) {
        return jsonResponse(request, { error: 'You must be signed in to perform this action' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
        console.error('Missing required Supabase function environment variables');
        return jsonResponse(request, { error: 'Account service is not configured' }, 500);
    }

    const authClient = createClient(supabaseUrl, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false }
    });
    const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken);
    if (userError || !user) {
        return jsonResponse(request, { error: 'Your session is invalid or has expired' }, 401);
    }

    let body: { action?: unknown; startingBalance?: unknown };
    try {
        body = await request.json();
    } catch {
        return jsonResponse(request, { error: 'Request body must be valid JSON' }, 400);
    }

    const action = body.action;
    if (action !== 'reset' && action !== 'delete') {
        return jsonResponse(request, { error: 'Action must be reset or delete' }, 400);
    }

    let startingBalance: number | null = null;
    if (action === 'reset') {
        const requestedBalance = Number(body.startingBalance);
        if (!Number.isFinite(requestedBalance) || requestedBalance < 1000 || requestedBalance > 1_000_000) {
            return jsonResponse(request, { error: 'Starting balance must be between 1,000 and 1,000,000' }, 400);
        }
        startingBalance = Math.round(requestedBalance);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false }
    });

    // These are the only user-owned tables used by the application. A table is
    // allowed to be absent so deployments that predate portfolio history still work.
    const userTables = ['portfolio_history', 'transactions', 'portfolio', 'watchlist'];
    for (const table of userTables) {
        const { error } = await admin.from(table).delete().eq('user_id', user.id);
        if (error && !isMissingRelationError(error)) {
            console.error(`Failed to clear ${table} for ${user.id}:`, error);
            return jsonResponse(request, { error: `Could not clear ${table}. The operation stopped before completion.` }, 500);
        }
    }

    if (action === 'reset') {
        const { data: profile, error: updateError } = await admin
            .from('user_profiles')
            .update({ cash_balance: startingBalance })
            .eq('id', user.id)
            .select('id')
            .maybeSingle();

        if (updateError) {
            console.error(`Failed to reset balance for ${user.id}:`, updateError);
            return jsonResponse(request, { error: 'Portfolio data was cleared, but the cash balance could not be reset' }, 500);
        }

        if (!profile) {
            const { error: insertError } = await admin.from('user_profiles').insert({
                id: user.id,
                username: user.email?.split('@')[0] || 'trader',
                email: user.email,
                cash_balance: startingBalance
            });
            if (insertError) {
                console.error(`Failed to recreate profile for ${user.id}:`, insertError);
                return jsonResponse(request, { error: 'Portfolio data was cleared, but the profile could not be reset' }, 500);
            }
        }

        return jsonResponse(request, { ok: true, action, startingBalance });
    }

    const { error: profileError } = await admin.from('user_profiles').delete().eq('id', user.id);
    if (profileError && !isMissingRelationError(profileError)) {
        console.error(`Failed to delete profile for ${user.id}:`, profileError);
        return jsonResponse(request, { error: 'Could not delete the account profile' }, 500);
    }

    const { error: deleteUserError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteUserError) {
        console.error(`Failed to delete auth user ${user.id}:`, deleteUserError);
        return jsonResponse(request, { error: 'Account data was cleared, but the sign-in identity could not be deleted' }, 500);
    }

    return jsonResponse(request, { ok: true, action });
});

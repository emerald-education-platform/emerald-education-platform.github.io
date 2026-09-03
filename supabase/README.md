# Supabase functions

The `market-data` Edge Function replaces the retired anonymous `corsproxy.io`
integration. It accepts 1–25 symbols per request and proxies only validated Yahoo
Finance chart requests.

The `account-actions` Edge Function securely resets portfolios and permanently
deletes accounts. It validates the signed-in user's access token before using the
server-only service-role key supplied automatically by Supabase. Never put that
service-role key in frontend code.

Deploy it from the repository root:

```sh
npx supabase login
npx supabase link --project-ref nlcdgfpnreyjoomctoht
npx supabase functions deploy market-data --no-verify-jwt --use-api
npx supabase functions deploy account-actions --no-verify-jwt --use-api
```

After deployment, test it with:

```sh
curl -X POST \
  'https://nlcdgfpnreyjoomctoht.supabase.co/functions/v1/market-data' \
  -H 'Content-Type: application/json' \
  -d '{"symbols":["AAPL","MSFT"],"interval":"1d","range":"1mo"}'
```

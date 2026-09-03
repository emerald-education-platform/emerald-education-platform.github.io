# Supabase functions

The `market-data` Edge Function replaces the retired anonymous `corsproxy.io`
integration. It accepts 1–25 symbols per request and proxies only validated Yahoo
Finance chart requests.

Deploy it from the repository root:

```sh
npx supabase login
npx supabase link --project-ref nlcdgfpnreyjoomctoht
npx supabase functions deploy market-data --no-verify-jwt --use-api
```

After deployment, test it with:

```sh
curl -X POST \
  'https://nlcdgfpnreyjoomctoht.supabase.co/functions/v1/market-data' \
  -H 'Content-Type: application/json' \
  -d '{"symbols":["AAPL","MSFT"],"interval":"1d","range":"1mo"}'
```

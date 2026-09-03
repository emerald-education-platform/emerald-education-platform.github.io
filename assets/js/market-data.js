(function () {
    'use strict';

    const endpoint = 'https://nlcdgfpnreyjoomctoht.supabase.co/functions/v1/market-data';
    const publishableKey = 'sb_publishable_8OPX1CdBvxjjGkJbf5nRPA_oz0iSd_p';

    async function fetchCharts(symbols, options = {}) {
        const uniqueSymbols = [...new Set(
            symbols
                .map(symbol => String(symbol).trim().toUpperCase().replaceAll('.', '-'))
                .filter(Boolean)
        )];

        if (uniqueSymbols.length === 0) return {};

        const chunks = [];
        for (let index = 0; index < uniqueSymbols.length; index += 25) {
            chunks.push(uniqueSymbols.slice(index, index + 25));
        }

        const payloads = await Promise.all(chunks.map(async chunk => {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': publishableKey,
                    'Authorization': `Bearer ${publishableKey}`
                },
                body: JSON.stringify({
                    symbols: chunk,
                    interval: options.interval || '1d',
                    range: options.range || '1mo'
                })
            });

            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload.error || `Market data service returned HTTP ${response.status}`);
            }
            return payload;
        }));

        return payloads.reduce((charts, payload) => Object.assign(charts, payload.charts || {}), {});
    }

    async function fetchChart(symbol, options = {}) {
        const normalizedSymbol = String(symbol).trim().toUpperCase().replaceAll('.', '-');
        const charts = await fetchCharts([normalizedSymbol], options);
        const chart = charts[normalizedSymbol];

        if (!chart) {
            throw new Error(`No market data returned for ${normalizedSymbol}`);
        }

        return chart;
    }

    window.EmeraldMarketData = Object.freeze({ fetchChart, fetchCharts });
})();

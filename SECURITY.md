# Security

## API keys

Keep VIDIA API keys (`vd_live_…`) in server-side environment variables such as `VIDIA_API_KEY`. Do not commit keys, include them in browser bundles, place them in URLs, or print them in logs. The client sends the key only in the `Authorization` header to the configured `baseUrl` and never attaches it to download links.

Use a **read** key (browse, quote, track, download) wherever you do not need to start productions. A **run** key can spend points; give it a small daily production limit.

If a key may have been exposed, revoke it at <https://vidia.kr/settings/api> and create a new one.

## Reporting a vulnerability

Please report security issues privately through the 1:1 inquiry at <https://vidia.kr>. Do not open a public issue containing credentials, personal data, or exploit details.

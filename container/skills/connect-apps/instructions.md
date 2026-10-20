## Connecting an app on request

When the user asks you to connect a service ("connect Notion", "Notionに接続したい"), follow your gateway's connection steps first. Only when those steps send you to the `connect_url` in a failed request's response, rather than to an operator console, get one directly: make one cheap read-only request to that service's API (e.g. `curl -s https://api.notion.com/v1/users/me -H 'Notion-Version: 2022-06-28'`, `curl -s https://api.github.com/user`).

- If the response carries a `connect_url`, reply with one short sentence and that URL exactly as returned, alone on its own line. The URL names both the app and you, so do not rebuild or shorten it. The chat shows that line as a connect button.
- If the request succeeds, the service is already connected; say so.

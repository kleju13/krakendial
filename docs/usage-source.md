# Usage source

The dial shows Claude and Codex limits and costs from a usage source: any URL that answers `GET` with the JSON below. The service never asks Claude or Codex itself and never reads their credentials, so you decide what collects the numbers and where it runs, e.g. on another machine in your own network.

Set the URL in the settings under **Usage source**. You can also set the `KRAKENDIAL_USAGE` environment variable before the service first starts; once the settings are saved, the saved value wins. An empty URL turns limits and costs off.

## Polling

- The service fetches the URL every minute, with a 15-second timeout.
- If a limit says when the source refreshes next (`nextAt`), the service fetches again 15 s after that, but at most once every 5 s and at least once a minute.
- The last good answer is kept in `%LOCALAPPDATA%\krakendial\state.json` across restarts.

When a fetch fails, the dial keeps the last numbers, dims them as they age, and shows why at the bottom:

| Shown | Cause |
|---|---|
| `offline` | the URL can't be reached |
| `http 503` (or another code) | the source answered with an error |
| `bad reply` | the answer isn't JSON |

## Format

```json
{
  "limits": {
    "claude5h": { "pct": 12, "windowMs": 18000000, "resetsAt": 1792254000288, "fetchedAt": 1792243200469, "nextAt": 1792243500000 },
    "claude7d": { "pct": 1, "windowMs": 604800000, "resetsAt": 1792843200000, "fetchedAt": 1792243200469, "nextAt": 1792243500000 },
    "codex5h": null,
    "codex7d": { "pct": 6, "windowMs": 604800000, "resetsAt": 1792666380000, "fetchedAt": 1792243200469, "nextAt": 1792243500000 }
  },
  "costs": {
    "currency": "USD",
    "today": 12.16,
    "last24h": 30.02,
    "last7d": 1072.19,
    "month": 1869.65,
    "machines": [
      { "name": "desktop", "status": "online" },
      { "name": "laptop", "status": "offline" }
    ]
  }
}
```

All times are Unix milliseconds.

### `limits`

Keys: `claude5h`, `claude7d`, `codex5h`, `codex7d`. Any of them may be missing or `null`; a limit without a numeric `pct` is skipped. The dial currently draws `claude5h`, `claude7d` and `codex7d`.

| Field | Required | Meaning |
|---|---|---|
| `pct` | yes | Percent of the limit **used**, 0–100. The dial turns it into "left" if the settings say so. |
| `windowMs` | no | Length of the limit's window, e.g. 5 h or 7 days. Used for the pace marker and the burn-rate estimate. |
| `resetsAt` | no | When the window resets. Shown as "reset 18:20" or as a countdown. |
| `fetchedAt` | no | When the source read this number. A new value is recorded only when `fetchedAt` changes, so a source polled more often than it refreshes doesn't skew the burn rate. Defaults to the time of the fetch. |
| `nextAt` | no | When the source will read it again. Lets the dial fetch right after, and fills the small ring next to "synced". |

From consecutive values the service works out when, at the pace of the last 45 minutes (6 hours for weekly limits), a limit would run out, and passes it on as `burnAt` in `/api/state`. A new window, when `resetsAt` moves by more than 10 minutes or `pct` drops, starts this history afresh.

### `costs`

Optional. If `costs` is an object, the dial takes the whole object as it is.

| Field | Meaning |
|---|---|
| `today`, `last24h`, `last7d`, `month` | Amounts in US dollars. The **Cost** setting picks which one the layouts show. A missing period shows `—`. |
| `currency` | Informational; amounts are always shown with `$`. |
| `machines` | Optional list of `{ "name", "status" }`. The settings page lists the machines whose `status` isn't `"online"`. |

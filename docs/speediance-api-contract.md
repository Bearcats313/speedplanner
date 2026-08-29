# Speediance API contract

Companion to tech spec §4.2. Filled in from evidence per that section's
requirement — every entry below is marked with its source: `verified:
struct tag` (from `github.com/stozo04/speediance-cli`'s Go source, read
directly, not summarized — tech spec §4.1), or `verified: capture` (an
actual request/response from this app's own implementation, either logged
directly or inferred from a confirmed end-to-end outcome).

**A full week has pushed successfully and appeared correctly in the
Speediance app.** Every endpoint on the login → push path below is now
`verified: capture` — login, the two per-exercise lookups, and the program
creation itself. What's not yet independently confirmed is called out
inline (mainly: whether the weight values landed at the correct magnitude,
not just that the push didn't error).

Source files read directly for this table:
- `internal/api/types.go`
- `internal/api/client.go`
- `internal/api/endpoints.go`
- `internal/config/config.go`
- `internal/cli/push.go`
- `internal/template/template.go`
- `internal/template/library.go`

## Base URL

| Region key | Host | Status |
| --- | --- | --- |
| `Global` (default, and the fallback for any unrecognized key) | `https://api2.speediance.com/api` | `verified: struct tag` |
| `EU` | `https://euapi.speediance.com/api` | `verified: struct tag` |

Region keys are case-sensitive. `SPEEDIANCE_REGION` should be `Global` or
`EU`, not `us`/`eu` — an earlier version of this app used the latter, which
happened to resolve to the same Global host by coincidence but had the
wrong EU host entirely (`api2-eu.speediance.com`, which does not exist).

## Device type

`SPEEDIANCE_DEVICE_TYPE` is a plain integer API parameter, not a GM1/GM2
selector — there is no string like `"GM2"` anywhere in the API. `config.go`
defines `DefaultDeviceType = 1` with the comment "Gym Monster 1 — the only
tested device." Nothing in the CLI's source does any GM1-vs-GM2 branching
on this value at all; it's just always passed through as an opaque int.
Live evidence: setting this env var to the string `"GM2"` fails fast with
a client-side "not numeric" error (this app's own validation, not a
Speediance response) — confirming it must be a number, not a model name.
`1` is now `verified: capture` — a real push against a GM2 account with
this value landed successfully and appeared correctly in the app.

## Headers (every request)

`verified: struct tag`, from `client.go`'s `setHeaders()`. Applied as a
literal map, not `Header.Set`, so casing reaches the wire exactly as below.

| Header | Value |
| --- | --- |
| `User-Agent` | `Dart/3.9 (dart:io)` |
| `Content-Type` | `application/json` |
| `Timestamp` | current time, milliseconds since epoch, as a string |
| `Utc_offset` | `+0000` |
| `Timezone` | `GMT` |
| `Versioncode` | `40304` |
| `Accept-Language` | `en` |
| `App_type` | `SOFTWARE` |
| `Mobiledevices` | `{"brand":"google","device":"emulator64","deviceType":"sdk_gphone64","os":"","os_version":"31","manufacturer":"Google"}` |
| `Token` | session token, only once authenticated |
| `App_user_id` | session user id, only once authenticated |

`Host` is set explicitly by the Go client from the base URL's host; not
replicable the same way from `fetch()`, and shouldn't need to be — the
request already targets the right host by URL.

## Response envelope (every endpoint)

`verified: struct tag`, from `types.go`'s `Envelope`.

```json
{ "code": 0, "message": "", "data": {} }
```

`code: 0` is success. `code: 91` is an expired token — reauthenticate once
and retry the same request. Any other non-zero code is a real error;
`message` is the human-readable reason. `data`'s shape depends on the
endpoint.

## POST `/app/v2/login/verifyIdentity`

`verified: capture` — exercised successfully as the first step of a real
push. Shape below matches `types.go`.

Request:
```json
{ "type": 2, "userIdentity": "<email>" }
```

Response `data`:
```json
{ "isExist": true, "hasPwd": true }
```
`isExist: false` → account doesn't exist. `hasPwd: false` → no password set
on the account (set one in the Speediance app first). This app doesn't yet
branch on these two flags the way the CLI does — worth adding once this
endpoint has a `verified: capture` entry to confirm the exact failure
messaging a real account in either state produces.

## POST `/app/v2/login/byPass`

`verified: capture` — exercised successfully as the second step of a real
push. Shape below matches `types.go`.

Request:
```json
{ "userIdentity": "<email>", "password": "<password>", "type": 2 }
```

Response `data`:
```json
{ "token": "<string>", "appUserId": <number> }
```
`appUserId` arrives as a JSON number; the Go client parses it as
`json.Number` specifically to avoid float rounding on a large id. This
app's `String(data.appUserId)` on the parsed JS number risks the same
rounding for a sufficiently large id — worth revisiting if a real
`appUserId` ever turns out to exceed `Number.MAX_SAFE_INTEGER` (unlikely
for a user-account id, unlike the large catalog exercise ids, but not
independently confirmed either way).

## GET `/app/actionLibraryTab/list?deviceType=<n>`

`verified: struct tag`, from `library.go`. Returns tabs (Training,
Warmup, etc.) for a device type; entries with a truthy `isCustom` are
skipped.

## GET `/app/actionLibraryGroup/trainingPartGroup?tabId=<id>&deviceTypeList=<n>`

`verified: struct tag`, from `library.go`. Returns exercise groups
(`actionLibraryGroupList[].{id, title}`) for one tab.

## GET `/app/actionLibraryGroup/list?ids=<id>&ids=<id>...`

`verified: struct tag` for the library-pull usage (chunked by 50 ids,
`{id, mainMuscleGroupName}` rows). `verified: capture` for the push-time
usage (`resolveVariantIDs`, unchunked, `{id, actionLibraryList: [{id}]}`
rows) — exercised successfully resolving real exercises during a real push.

## GET `/app/actionLibraryGroup/<id>?isDisplay=1`

`verified: capture` — exercised successfully during a real push. Response
`data`: `{ "isLeftRight": 0 | 1 }`.

## POST `/app/v2/customTrainingTemplate`

`verified: capture` — a real payload in this exact shape created a program
that landed correctly on a GM2 account and appeared in the Speediance app.

```json
{
  "name": "Pull Day",
  "actionLibraryList": [
    {
      "groupId": 420074859921409,
      "actionLibraryId": 420074859921410,
      "templatePresetId": -1,
      "setsAndReps": "10,10,10",
      "breakTime": "75,75,75",
      "breakTime2": "75,75,75",
      "sportMode": "1,1,1",
      "leftRight": "0,0,0",
      "selectCompletionMethod": "1,1,1",
      "completionMethod": "1,1,1",
      "countType": "1,1,1",
      "weights": "55.0,55.0,55.0",
      "counterweight2": "",
      "level": "0,0,0",
      "capacity": 1650
    }
  ],
  "totalCapacity": 1650,
  "deviceType": 1,
  "bgColor": 0
}
```

Notes:
- `groupId` is the catalog id (what this app stores as an exercise's
  Speediance ID). `actionLibraryId` is a *different*, resolved id — the
  first entry in that group's `actionLibraryList` from the lookup above.
  Posting `groupId`'s value in place of `actionLibraryId` is very likely
  what an earlier version of this app's push was doing wrong, since that
  distinction didn't exist in that version at all.
- `leftRight` alternates `"1","2","1","2"...` per set when the exercise is
  unilateral (per the lookup above), else it's `"0"` for every set.
- `weights` is the API's internal unit, formatted to one decimal place.
  The Go CLI multiplies its (kilogram) input by `2.2` to produce this
  value; this app stores pounds already and sends the stored value with
  no multiplication. `verified: capture` — a pushed weight showed the
  correct pound value in the Speediance app, not doubled or halved,
  confirming the API's internal unit really is pounds and this app's
  no-conversion approach is correct.
- `capacity` (per exercise) and `totalCapacity` (whole payload) are
  `sum(reps × weight)` in that same internal unit. The Go source formats
  these to always carry a decimal point (`"1716.0"`, matching Python's
  `repr(float)`); this app sends plain JSON numbers instead (`1716`).
  `verified: capture` — a push with plain-number formatting for both
  fields succeeded, confirming the trailing `.0` really is cosmetic
  (matching the Python tool's own output for the source author's diffing
  purposes) and not something the server's parser is strict about.
- `bgColor` is always the integer `0` in the source, not a color.

## Endpoints not yet ported (read path, PRD R17/R8)

`workouts`/session-detail endpoints (`userTrainingDataRecord`,
`cttTrainingInfo[Detail]`, `freeTraining[Detail]`) exist in the source
(`endpoints.go`) but nothing in this app calls them yet — Phase 3 per the
PRD, contingent on the single-session read-cost tradeoff described there.
Not filled in here until that phase starts; the source itself already has
everything needed when it does.

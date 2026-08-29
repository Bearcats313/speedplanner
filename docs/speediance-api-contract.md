# Speediance API contract

Companion to tech spec §4.2. Filled in from evidence per that section's
requirement — every entry below is marked with its source. Nothing marked
`inferred` should ship; as of this writing everything is `verified: struct
tag`, pulled directly from `github.com/stozo04/speediance-cli`'s Go source
(fetched and read literally, not summarized — see tech spec §4.1). No entry
here is yet `verified: capture` (a real request/response pair logged from a
live call against this app's own implementation) — that upgrade happens
automatically as each endpoint gets exercised live, since `lib/speediance/
client.ts` logs the full raw request/response (password redacted) on every
call. Update this file's status column as that evidence comes in.

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
`1`, matching the CLI's own default, is `inferred` to be correct for GM2
as well specifically because nothing in the source treats device
generation as a factor at all — not yet `verified: capture` against a
live GM2 push landing with this exact value.

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

`verified: struct tag` (request and response), from `types.go`.

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

`verified: struct tag`, from `types.go`.

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

`verified: struct tag`, from both `library.go` (muscle enrichment, chunked
by 50 ids) and `template.go` (`resolveVariantIDs`, unchunked — a push day's
exercise count never approaches a URL length problem). Response rows carry
`{id, mainMuscleGroupName}` in the library-pull usage and
`{id, actionLibraryList: [{id}]}` in the push-time usage — same endpoint,
different fields read out of the same row shape.

## GET `/app/actionLibraryGroup/<id>?isDisplay=1`

`verified: struct tag`, from `template.go`'s `isUnilateral`. Response
`data`: `{ "isLeftRight": 0 | 1 }`.

## POST `/app/v2/customTrainingTemplate`

`verified: struct tag`, from `template.go`'s `Action`/`Payload`.

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
  value — this app stores pounds already, so sends the stored value with
  no multiplication. Not independently `verified: capture` that "the API's
  internal unit" is really pounds rather than something `kg × 2.2`
  approximates for unrelated reasons; treat as `inferred` specifically for
  that equivalence, even though every other field on this line is struct-tag-verified.
- `capacity` (per exercise) and `totalCapacity` (whole payload) are
  `sum(reps × weight)` in that same internal unit. The Go source formats
  these to always carry a decimal point (`"1716.0"`, matching Python's
  `repr(float)`) — this app sends them as plain JSON numbers instead
  (`1716`), which is the same JSON value to any standards-compliant
  parser. `inferred` that the trailing `.0` is purely cosmetic rather than
  something the server's own parser is strict about.
- `bgColor` is always the integer `0` in the source, not a color.

## Endpoints not yet ported (read path, PRD R17/R8)

`workouts`/session-detail endpoints (`userTrainingDataRecord`,
`cttTrainingInfo[Detail]`, `freeTraining[Detail]`) exist in the source
(`endpoints.go`) but nothing in this app calls them yet — Phase 3 per the
PRD, contingent on the single-session read-cost tradeoff described there.
Not filled in here until that phase starts; the source itself already has
everything needed when it does.

# Calendar availability

Use `m365_calendar_availability_get` to read free/busy codes for work or school calendars. Microsoft Graph does not support this endpoint for delegated personal Microsoft accounts. Existing calendar read permissions suffice; this tool does not create events or propose meeting slots.

Send 1–20 SMTP addresses, a positive UTC window of at most seven days, and an optional `availabilityViewInterval` of 5–1440 minutes (default 30). Addresses must be unique ignoring case. Both timestamps must end in `Z`; convert local times to UTC before calling so daylight-saving transitions are explicit.

```json
{
  "schedules": ["person@example.com"],
  "startDateTime": "2026-10-05T09:00:00Z",
  "endDateTime": "2026-10-05T10:00:00Z",
  "availabilityViewInterval": 30
}
```

The ordered result contains one entry for each requested target: availability codes or an explicit error. Codes follow Graph's availability view: `0` free/working elsewhere, `1` tentative, `2` busy, `3` out of office. Treat a missing schedule, provider error or invalid response as unavailable information, never as free time. The handler strips event subjects, locations, attendees and other provider detail, limits transport responses to 256 KiB, and checks the expected slot count.

This read-only tool remains available at default read access although Graph uses POST to retrieve the schedule. No live-account test is implied by fixture verification. See [Microsoft's getSchedule documentation](https://learn.microsoft.com/en-us/graph/api/calendar-getschedule?view=graph-rest-1.0) for provider permissions and restrictions.

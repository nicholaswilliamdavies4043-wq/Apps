# SharePoint lists used by the Machine Hours Portal

List names start with the prefix `MHP_` (setting `SP_LIST_PREFIX`). Every list also has **Title**, **AppId** (indexed) and **AppJson**.

- **AppJson** holds the full record and is the source of truth for anything without its own column. Do not edit it by hand.
- Columns marked ✎ can be edited directly in SharePoint, and the app picks up the change on its next refresh (every `SP_PULL_MINUTES`, default 5). Clearing a value in SharePoint is not copied back; change it in the app instead.
- Columns marked ƒ are calculated by the app (e.g. start readings, hours, check) and are overwritten.
- Cover photos are stored as files in the site's default document library under `MachineHoursPortal/covers/`.
- Sessions, superuser passwords and roles, notifications and app settings stay on the portal server and are **not** stored in SharePoint.

## MHP_Sites

Mine sites (environments)

| Column | Type | Indexed | |
|---|---|---|---|
| Title | text |  | ✎ name |
| SiteLocation | text |  | ✎ |
| Country | text |  | ✎ |
| SiteDescription | note |  | ✎ |
| ColorTag | text |  |  |
| ShiftList | text |  | ƒ✎ |
| MaxShiftHours | number |  | ✎ |
| WarnDays | number |  | ✎ |
| WarnHours | number |  | ✎ |
| CoverFile | text |  | ƒ |
| CreatedAtUtc | dateTime |  | ƒ |

## MHP_Machines

Loaders and other machines per site

| Column | Type | Indexed | |
|---|---|---|---|
| Title | text |  | ✎ name |
| SiteId | text | yes |  |
| SiteName | text |  | ƒ |
| Model | text |  | ✎ |
| InService | boolean |  | ƒ✎ |
| MachineStatus | text |  | ✎ |
| OpeningTR | number |  | ✎ |
| OpeningRCC | number |  | ✎ |
| ItemNotes | note |  | ✎ |

## MHP_Operators

Operator names per site

| Column | Type | Indexed | |
|---|---|---|---|
| Title | text |  | ✎ name |
| SiteId | text | yes |  |
| SiteName | text |  | ƒ |

## MHP_Telehuts

Tele-remote huts per site

| Column | Type | Indexed | |
|---|---|---|---|
| Title | text |  | ✎ name |
| SiteId | text | yes |  |
| SiteName | text |  | ƒ |

## MHP_ShiftEntries

End-of-shift TR/RCC hour-meter readings (start, hours and check are calculated by the app)

| Column | Type | Indexed | |
|---|---|---|---|
| Title | text |  | ƒ label |
| SiteId | text | yes |  |
| SiteName | text |  | ƒ |
| EntryDate | text | yes | ✎ |
| Shift | text |  | ✎ |
| MachineId | text | yes |  |
| MachineName | text |  | ƒ |
| Telehut | text |  | ✎ |
| Operator | text |  | ✎ |
| TREnd | number |  | ✎ |
| RCCEnd | number |  | ✎ |
| TRStart | number |  | ƒ |
| TRHours | number |  | ƒ |
| RCCStart | number |  | ƒ |
| RCCHours | number |  | ƒ |
| TotalHours | number |  | ƒ |
| CheckResult | text |  | ƒ |
| Remarks | note |  | ✎ |
| LoggedBy | text |  |  |
| LoggedAtUtc | dateTime |  | ƒ |

## MHP_Maintenance

Scheduled maintenance with due date and/or hour-meter limits

| Column | Type | Indexed | |
|---|---|---|---|
| Title | text |  | ✎ title |
| SiteId | text | yes |  |
| SiteName | text |  | ƒ |
| MachineId | text | yes |  |
| MachineName | text |  | ƒ |
| TaskCategory | text |  | ✎ |
| AssignedTo | text |  | ✎ |
| DueAtUtc | dateTime |  | ƒ✎ |
| MeterBasis | text |  |  |
| DueReading | number |  | ✎ |
| RepeatDays | number |  | ✎ |
| RepeatHours | number |  | ✎ |
| WarnDays | number |  |  |
| WarnHours | number |  |  |
| TaskStatus | text |  |  |
| CountdownStatus | text |  | ƒ |
| LastDoneUtc | dateTime |  | ƒ |
| ItemNotes | note |  | ✎ |

## MHP_MaintenanceLog

Completed maintenance history

| Column | Type | Indexed | |
|---|---|---|---|
| Title | text |  | ƒ label |
| SiteId | text | yes |  |
| SiteName | text |  | ƒ |
| MaintenanceId | text |  |  |
| MachineId | text | yes |  |
| MachineName | text |  | ƒ |
| TaskCategory | text |  |  |
| DoneAtUtc | dateTime |  | ƒ |
| DoneBy | text |  |  |
| WasDueUtc | dateTime |  | ƒ |
| DueReading | number |  |  |
| MeterBasis | text |  |  |
| ReadingTR | number |  |  |
| ReadingRCC | number |  |  |
| ItemNotes | note |  | ✎ |

## MHP_Announcements

Site announcements

| Column | Type | Indexed | |
|---|---|---|---|
| Title | text |  | ✎ title |
| SiteId | text | yes |  |
| SiteName | text |  | ƒ |
| AnnouncementText | note |  | ✎ |
| AnnPriority | text |  | ✎ |
| Pinned | boolean |  | ƒ✎ |
| ExpiresUtc | dateTime |  | ƒ |
| PostedBy | text |  |  |
| PostedAtUtc | dateTime |  | ƒ |

## MHP_ChatMessages

Chat messages (#general and per machine)

| Column | Type | Indexed | |
|---|---|---|---|
| Title | text |  | ƒ label |
| SiteId | text | yes |  |
| SiteName | text |  | ƒ |
| ChatChannel | text | yes |  |
| ChannelName | text |  | ƒ |
| MessageText | note |  |  |
| PostedBy | text |  |  |
| PostedAtUtc | dateTime |  | ƒ |

## MHP_Users

People who have signed in (roles are managed in the app, not here)

| Column | Type | Indexed | |
|---|---|---|---|
| Title | text |  | ƒ label |
| UserEmail | text | yes |  |
| NotifyEmail | boolean |  | ƒ |
| AppRole | text |  | ƒ |
| Disabled | boolean |  | ƒ |
| CreatedAtUtc | dateTime |  | ƒ |

## MHP_Widgets

Personal link widgets

| Column | Type | Indexed | |
|---|---|---|---|
| Title | text |  | ƒ label |
| OwnerId | text | yes |  |
| OwnerName | text |  | ƒ |
| Links | note |  | ƒ |
| ColorTag | text |  |  |
| IconName | text |  |  |
| SortOrder | number |  |  |

## MHP_AuditLog

Critical changes (who, what, when)

| Column | Type | Indexed | |
|---|---|---|---|
| Title | text |  | ƒ label |
| AtUtc | dateTime |  | ƒ |
| UserName | text |  |  |
| UserEmail | text |  |  |
| SiteId | text | yes |  |
| SiteName | text |  |  |
| Details | note |  |  |

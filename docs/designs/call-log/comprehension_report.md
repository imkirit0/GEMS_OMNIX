# Call log: EGM step 6 comprehension report

**Reviewed:** commit d8d377d, 2026-10-30, alongside steps 5 and 7.

**Verdict:** revise. The review found 1 blocker, 10 major findings and 5 nits. The design revision records how each one is resolved.

| ID | Severity | Finding | Proposed resolution |
|---|---|---|---|
| C1 | Blocker | The tele-caller default is ambiguous: `""` is turned into null, so is null a request for the default or for no tele-caller? | `undefined` means the default; `null` means none. The form preselects the person logging. |
| C2 | Major | Names come from `enquiry_counsellors`, which lists only users who may receive enquiries now, so a former tele-caller's name is lost. | Use name fields with a definer, or drop the names. |
| C3 | Major | The source of "Staff" and of the session's own name is not given. | Name the source, or drop the names. |
| C4 | Major | `CallFilter` has no defined semantics: inclusivity, the meaning of `dueBy`, invalid values, the sort order. | One line per filter; an invalid filter matches nothing. |
| C5 | Major | The timezone and format of `at` are not given. | ISO-8601 UTC. |
| C6 | Major | The multiline checks need `ctl_address`, not `ctl`. | Use `ws`/`ctl_address`. |
| C7 | Major | The name rule differs between `btrim` in the database and `trim` in JavaScript; `geoName` throws on `""`. | Use `ownText("name", v, 100)` and a `ws`/`ctl` check. |
| C8 | Major | The message table is incomplete (`not a date`, the `ownText` messages). | List every message. |
| C9 | Major | The trading gate body, the order of checks, and the case of manage without view are not stated. | Centre status only, after `authorize`; manage implies view (T-ENQ-005). |
| C10 | Major | `canLog` is undefined. | Manage, with `active` as a separate field. |
| C11 | Major | The fixtures use `session_replication_role`, not trigger toggles. | Add the table to the fixtures' truncate list. |
| C12 | Nit | How the guard identifies `gems_app` is not stated. | Moot: the guard no longer checks roles. |
| C13 | Nit | The audit keys are not listed. | List them. |
| C14 | Nit | The route's order of `""`-to-null versus `Number()` is not stated. | `""` becomes null first. |
| C15 | Nit | Whether an inactive centre's list is still shown, and how the test sets one up, are not stated. | The list is shown; the test deactivates the centre as admin. |
| C16 | Nit | The save route's error behaviour is not stated. | The `adminPost` `error` and `detail` parameters; typed values are not kept. |

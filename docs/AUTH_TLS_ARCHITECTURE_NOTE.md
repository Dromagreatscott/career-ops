# Career Ops Auth/TLS Architecture Note

## A. Localhost-only development

Career Ops development should bind only to localhost (`127.0.0.1` / `::1`) and assume a single local operator on the machine. Development mode must not be treated as a network service and must not expose package decision, tracker mutation, profile, CV, or apply-session routes beyond the local host.

## B. Authenticated HTTPS production access

Production access should require HTTPS at the edge and authenticated operator sessions before any UI or API mutation route is reachable. TLS termination, identity provider choice, session cookie policy, CSRF posture, and reverse-proxy enforcement should be selected as a separate production-auth decision rather than invented inside this sprint.

## C. Future Separate Accounts/Profiles

The production model should support separate operator accounts and separate career profiles, including David and another future user, without hard-coding either identity into authorization logic. Account identity should be data-driven and attached to sessions, not inferred from file names, host names, or global process state.

## D. Session/Profile Isolation

Every authenticated session should resolve to one active profile scope. Profile files, application packages, approval records, apply sessions, CV material, and tracker mutations should be isolated by that scope before multi-user UI is introduced. Approval hashes and package versions should be scoped with the profile so a decision from one profile cannot replay against another.

# Clinic Timetable Automation Project

## Project Purpose

This repository is the production source for the clinic timetable generator.

The long-term goal is not to rebuild a large clinic information system. The goal is to incrementally automate repetitive work involved in creating, modifying, saving, printing, and publishing clinic timetable information while preserving the current working timetable generator.

Use an Automation-first, not Infrastructure-first approach.

Prefer existing resources:
- the current timetable generator
- Vercel
- GitHub
- Google Sheets / Apps Script when appropriate
- LINE Official Account
- Meta / Facebook official capabilities
- the two existing clinic websites
- FarBar
- Google Business Profile
- existing AI capabilities

Do not add new infrastructure merely for architectural elegance.

## Production Source of Truth

The active production repository is:

`aangela-star/clinic-timetable-output`

Expected production URL:

`https://clinic-timetable-output.vercel.app/`

Do not treat older timetable prototypes or similarly named repositories as the production source unless explicitly instructed.

## Non-Negotiable Core Requirement: PNG and Printing

The current Preview → high-resolution PNG download flow is a formal production requirement.

The timetable poster must continue to support:
- editing
- preview
- high-resolution PNG download
- saving
- printing

Current capture behavior must not be casually changed:
- poster size: 1080 × 1920
- html2canvas scale: 2

Do not remove, weaken, or make the PNG / printing workflow more complicated.

`PosterContent`, `handleDownload`, html2canvas configuration, poster dimensions, and rendering behavior are protected areas unless the current task explicitly requires changing them.

## Incremental Development

Modify the current system incrementally.

Do not rewrite the timetable generator from scratch.

Follow:
- small changes
- testable steps
- production remains usable
- YAGNI
- minimum sufficient design

Do not pre-build infrastructure for features that are not yet approved.

## Data Principles

Clinic timetable facts must not exist only inside generated images.

The system must eventually support reliable distinction between:
- recurring monthly clinic schedules
- date-specific timetable changes such as substitute physician, cancellation, no substitute, added clinic, time change, and single-day closure
- emergency closure events

AI must never invent:
- physicians
- clinic times
- clinic locations
- substitute coverage
- closures
- other timetable facts

Clinic facts must come from formally stored timetable data or authorized human confirmation.

## Monthly Schedule Workflow

Preferred future workflow:

copy previous month
→ modify differences
→ preview
→ save
→ optionally download / print PNG
→ optionally publish to selected channels

When creating a new month, copy only recurring timetable data.

Do not copy one-time events from the previous month such as:
- temporary substitute coverage
- one-time cancellation
- emergency closure
- temporary events

## Save Is Not Publish

Saving timetable data and publishing timetable information are separate actions.

Do not automatically publish merely because data was saved.

Publishing must remain explicitly selectable and confirmable.

A failure on one publishing channel must not cause already-successful channels to be published again.

## Future Publishing Direction

Potential publishing channels include:
- Facebook page for 晉安
- Facebook page for 毅安
- LINE Official Account
- 晉安 website
- 毅安 website
- FarBar in-clinic display
- Google Business Profile when appropriate

Do not implement publishing integrations unless the active task explicitly authorizes them.

Normal temporary timetable changes should generally use short update notices rather than repeatedly reposting the full monthly timetable.

## Emergency Closure

Emergency closure is a separate workflow from the normal monthly timetable.

Do not build government announcement polling, news monitoring, typhoon monitoring, or AI polling.

Emergency closure must be actively triggered by an authorized staff member.

AI or normal code may parse:
- date
- clinic
- time period
- reason
- announcement wording

But the system must first return a confirmation state.

Never publish an emergency closure directly from the initial command.

Required pattern:

authorized trigger
→ parse
→ preview / confirmation
→ human confirm
→ publish

Emergency closure may eventually generate a separate PNG notice and publish to selected external channels.

## AI Usage

Use AI to reduce human work, not to create more systems to maintain.

AI may help:
- interpret natural-language staff instructions
- interpret patient questions
- structure timetable changes
- draft Facebook / LINE / website announcements
- transform one confirmed fact set into platform-specific formats

If ordinary deterministic code can reliably do the task, prefer ordinary code over unnecessary AI calls.

## Infrastructure and Cost Guardrail

Do not introduce without explicit user approval:
- Supabase
- Firebase
- Neon
- PostgreSQL
- new database services
- new Auth SaaS
- queue SaaS
- automation SaaS
- Zapier
- Make
- other new paid or maintenance-heavy services

Even free services require approval if they add accounts, operational complexity, or maintenance.

If new infrastructure appears necessary, stop and explain:
1. why existing resources are insufficient
2. what the new service solves
3. whether an existing/free option exists
4. expected cost
5. new maintenance burden
6. practical limitation if it is not adopted

Do not implement it before approval.

## Security

Never place tokens, passwords, API credentials, or external platform secrets in:
- browser-side code
- GitHub repository content
- committed configuration

Prefer existing platform secret mechanisms.

Do not expose or log server-only secrets.

## External Platform Changes

Do not modify production settings for:
- LINE
- Facebook / Meta
- Google Business Profile
- clinic websites
- FarBar
- Apps Script deployment
- Vercel production

unless the active task explicitly authorizes it.

Prefer official APIs / official capabilities first.

Browser automation should be a later fallback, not the default.

## Current Architecture Direction

The timetable generator should remain the timetable management frontend rather than becoming a large all-in-one clinic system.

The clinic portal remains the system entry point.

Do not move every feature into the portal.

Current monthly persistence architecture uses existing infrastructure:

browser
→ same-origin Vercel API
→ server-side authentication / secret boundary
→ Google Apps Script
→ Google Sheet

Avoid replacing this architecture unless there is a demonstrated need and explicit approval.

## Task Scope Discipline

This file describes long-term direction and permanent constraints.

It does NOT authorize implementing every future feature.

For every Codex task:
- follow the specific task scope first
- use this file as architectural guidance and guardrails
- do not expand scope because a future feature is mentioned here
- stop and ask before production changes, new services, major architecture changes, or uncertain destructive actions

## Completion Discipline

Before declaring a code task complete:
- verify the current branch
- run relevant tests
- review the diff against the intended base
- check for accidental formatting / line-ending noise
- confirm no secrets or temporary debug endpoints were introduced
- confirm protected PNG / preview behavior remains intact unless intentionally changed
- report modified files, tests, remaining risks, and whether the work is ready for review

Production merge and production deployment always require explicit human approval.

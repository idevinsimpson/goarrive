# GoArrive Build System Vision

## Overview
The Build tab is the unified creative workspace that replaces the formerly separate Workouts and Movements tabs. It is not just a content library; it is a visual creative workspace where coaches can create, organize, and use the core assets that power the member journey.

## Build Information Architecture
Build contains five first-class asset types: plans, movements, workouts, playbooks, and folders. The tab features a search bar at the top that searches all Build item types, a filter button for filtering by type, and a plus button that expands to create any asset type.

## Visual Model
Everything in Build should feel visual and browsable, like icons and folders in a creative workspace. The visual hierarchy follows specific aspect ratio rules.

| Asset Type | Aspect Ratio | Display Behavior |
|---|---|---|
| **Movements** | 4:5 | Smaller and denser, rendering in a grid. |
| **Workouts** | 4:5 (thumbnail grid) | Visually bigger than movements, rendering 2 across by default. Support pinch/spread resizing. |
| **Folders** | Standard folder icon | Can contain mixed content (movements, workouts, playbooks). |

## Plans Inside Build
Plans are first-class Build assets representing the member's service and billing structure. They can be placed into folders for organizing businesses, families, cohorts, or groups. When a coach opens a plan, they see the intake view, plan view, coach view, and member view.

## Movements Inside Build
Movements live inside Build as first-class assets, not in a separate tab. They can be organized into folders and can coexist inside and outside of folders. Dragging one movement onto another should prompt the coach to either create a folder or create a workout. Multi-selecting movements should also allow folder creation or workout creation.

## Workouts Inside Build
Workouts are first-class Build assets that can be placed into folders. Folders support mixed content, meaning workouts, movements, and playbooks can coexist in the same folder. There is no rigid separation between "movement folders" and "workout folders."

## Playbooks Inside Build
A playbook is a sequence of workouts designed to drip across a member's scheduled rhythm over time. Playbooks can exist unassigned, be prepared ahead of time, be assigned to a member, and become live. Only one playbook can be live for a member at a time. The "live" state means the playbook is actively attached to the member, driving the upcoming workout sequence, aligned to the session rhythm, and progressing through the workout sequence.

Coaches can create loop structures visually, including looping one week, multiple weeks, a block of weeks, or a loop block. Two strategies exist for missed sessions: "missed means missed" (the member waits until the next appropriate point) and "shift forward" (the remaining sequence shifts forward so the member still receives the missed workout).

## Context-Sensitive Browsing
Build serves as the source browser for adding content while editing workouts. When a coach is adding a movement to a workout, the browser shows only movements, workouts, and folders containing movements or workouts, hiding plans, playbooks, and irrelevant folders. When adding a block from another workout, only workouts and folders containing workouts are shown. The goal is low-noise, context-aware browsing.

## Workout Creation Philosophy
Workout creation must not begin with a giant form. The new direction involves opening a blank build canvas, creating a container, adding building blocks, and editing details later. The first experience should feel easy and creative. Workout-level details live behind overflow menus, slide-over details, edit panels, or details sheets, and they do not dominate the first experience.

## Workout Internal Structure
A workout is composed of blocks. Block types include single movement, multiple movements, intro, demo, transition, water break, outro, and eventually imported blocks from other workouts. Blocks lay out left to right, top to bottom, with clear visual separation between them. The target is 4 items wide for movement-level blocks in the canvas.

Each block has a rounds count (default: 3, changeable per settings, per workout, per block). Single-movement blocks repeat the movement according to the round count, while multi-movement blocks repeat the whole group. Coaches can drag movements into, out of, and between blocks, drag entire blocks via block handles, and use between-block plus buttons to add water breaks, transitions, or combine adjacent blocks.

## Timing System
The timing system defines three key durations. Movement duration is the active time the member performs the movement (default: 40 seconds). Rest/prep is the time before the next movement begins, encompassing rest, setup, and preparation (default: 20 seconds). Extra first-movement prep time provides additional setup time before the first movement of a block begins for the first time. All defaults are changeable at the coach settings level, at the workout level, and at the block level.

## Member Playback Vision
The member workout experience must be redesigned around the block system. The core principle is that the member always knows what they are doing now, what is coming next, when to get ready, and when to go. As the countdown into the next movement begins, the next movement appears visually. During prep and rest, the member is already seeing and getting ready for the next movement.

Audio behavior follows a consistent pattern: during prep and rest, the member hears "3, 2, 1... rest, next up, [movement name]." At the end of prep, they hear "3, 2, 1, go." Demo blocks appear only before multi-movement blocks, where the member hears "here's what's coming up" and sees upcoming movements in order. Transition blocks provide duration, short instruction text, and supporting media. Water breaks have their own blocks with duration, keeping the media area present. Intro and outro blocks are full-screen, roughly 10 seconds by default, creating a strong "workout video" feel.

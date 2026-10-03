# WE STAY FIT — Visual North Star Atlas Requirements
Version: 2026-09-20
Status: OWNER / CHATGPT CREATIVE-DIRECTOR REQUIREMENT

This file expands the current nine-screen target package into the complete visual north-star atlas Devin requested.

The rule is simple:

**Do not begin page implementation until the relevant page has a reviewed TARGET.**

The current target package under `docs/design-target/` is a good start, but it does not yet cover the full product.

## 1. Visual references

The owner-approved visual direction is:
- vibrant mobile-app experience
- compact WSF chrome
- dominant expressive Living WE
- layered navy + bright progress green
- richer depth, gradients, imagery/illustration where authorized
- stronger iconography
- fewer cream/white bordered-card stacks
- obvious central MOVE action
- truthful recent momentum
- human/community energy without fake identity
- rewarding confirmed-contribution moments
- kiosk/event surfaces visually related to the same product family, not a separate admin website

Preserve the emotional loop:

**I did something → WE changed → I belong here → I want to come back.**

Truth/privacy from Strategic Master v3 remains hard. Visual energy may never invent data.

## 2. Complete route inventory from the actual app

Current user-facing routes discovered on the PR #365 branch:

### Core member product
- `/` — Home resolver / current community landing
- `/community` — community switcher / communities
- `/community/[groupId]` — community Home / command center
- `/activity` — current private activity; future Progress destination
- `/you` — identity/profile/account
- `/contribute/[goalId]` — contribution flow
- `/move/[goalId]` — movement/player route where applicable
- `/community/[groupId]/challenge` — community challenge surface

### Identity and onboarding
- `/signin`
- `/signup`
- `/verify-email`
- `/profile-setup`
- `/reset-password`

### Joining and community creation
- `/join/[joinCode]`
- `/start-community`

### Champion goal / multi-movement setup
- `/goals/new`
- `/combined/[setupId]`

### Expo / LIVE / event
- `/event/[goalId]`
- `/queue/[goalId]`
- `/station/[goalId]`
- `/kiosk/[goalId]`

### Public / shared display
- `/display/[goalId]`

### Technical-only
- `/health` is operational/technical, not a member-facing visual target unless it becomes a user-facing diagnostic.

## 3. Required visual-target atlas

Every item below needs an inspectable WSF TARGET before that surface is implemented or visually accepted.

### A. Global shell / navigation
1. Signed-in phone shell — 390×844
2. Short phone shell — 390×640
3. Large phone — 430×932
4. Signed-out / identity shell
5. Member navigation: **Home | Community | MOVE | Progress | You**
6. Champion contextual Manage access
7. Event/kiosk surfaces with member shell intentionally absent

### B. Home / community command center
8. Active goal — ordinary progress
9. Zero progress
10. Near goal (90%+)
11. Reached while still open
12. Closed/reached history handoff
13. Goal closed unfinished
14. No active goal
15. Stale progress
16. Progress unavailable / recovery
17. Member view
18. Champion view
19. Multiple active goals with one explicitly featured
20. Short-phone variant

### C. MOVE / contribution
21. Choose/start movement
22. Record an already-completed movement
23. Guided movement details
24. Optional timer
25. Amount entry
26. Review before recording
27. Recording/loading
28. Pending / unknown result
29. Retry / confirm same attempt
30. Failed/refused contribution
31. Once-policy already completed
32. Goal closed while attempting
33. Confirmed ordinary contribution
34. Confirmed near-goal contribution
35. Confirmed after goal already reached
36. Goal-level reached celebration without false individual crossing attribution

### D. Community
37. Community identity/story
38. Authorized aggregate presence
39. Anonymous recent momentum
40. What we're doing
41. What we've done
42. Invitation/join controls as secondary
43. Member view
44. Champion context
45. Multiple-community switcher
46. Empty/new community

### E. Progress
47. Own recent recorded movement
48. Own goal-by-goal contribution
49. Safe/private consistency
50. Empty state
51. History
52. No rankings / no comparative surface

### F. You
53. Profile/account
54. Edit profile entry
55. Sign-out/account actions
56. Minimal identity state before profile completion

### G. Authentication / onboarding
57. Sign in
58. Sign up
59. Verification email waiting
60. Verification complete / continue
61. Reset-password request
62. Reset-password completion
63. Profile setup
64. Auth error
65. Return-to-event after sign-in
66. Return-to-join after sign-in

### H. Join / create community
67. Join invitation landing
68. Signed-out join gate
69. Profile-required join gate
70. Join confirmation
71. Joined success
72. Invalid/expired join code
73. Private/refused state
74. Start community
75. Community creation confirmation

### I. Champion goal setup
76. Goal basics
77. Movement catalog
78. One movement selected
79. Multiple movements selected
80. Target/unit/window
81. Review before opening
82. Created/opened success
83. Multi-movement setup progress
84. Multi-movement setup error/recovery
85. Never expose parent/child/combined implementation language to the user

### J. Community challenge
86. Challenge overview
87. Quick action / check-in
88. Participation state
89. Completed/reached state
90. No fake health/social outcome claims

### K. Event / LIVE on personal phone
91. Scanned event landing
92. Signed-out event
93. Returning member
94. Not-member state
95. Activity chooser
96. Activity selected
97. Device-choice / personal-vs-shared-screen decision where applicable
98. Event completion / next action

### L. Queue
99. Join queue
100. Waiting
101. Place/position state without public identity leakage
102. Assigned station
103. Ready
104. Leave queue
105. Rejoin/recovery
106. Unavailable/refused

### M. Station — tablet / landscape
107. Pair/enrol station
108. Waiting/available
109. Participant assigned
110. Ready to start
111. Active 60-second movement
112. Review/result entry
113. Recorded receipt
114. Cleared for next participant
115. Offline/stale/unavailable
116. No prior participant identity after clear

### N. Kiosk — tablet / portrait
117. Idle/walk-up
118. Choose movement
119. QR/sign-in handoff
120. Contribution
121. Confirmation
122. Finish/reset
123. Next visitor clean state
124. Timeout/idle reset
125. Offline/unavailable

### O. Public/shared display
126. Phone preview
127. Tablet portrait picture-frame display
128. Tablet landscape display
129. 1280×800 booth/monitor
130. 1920×1080 collective screen
131. Zero progress
132. Ordinary progress
133. Near goal
134. Reached/open
135. Closed/reached achievement
136. Closed unfinished
137. Stale
138. Unavailable
139. Unauthorized/refused
140. No individual identity unless separately authorized

## 4. Device classes

Targets must not assume every surface is an iPhone.

Minimum:
- Phone: 390×844
- Short phone: 390×640
- Large phone: 430×932
- Tablet portrait: 800×1280
- Tablet landscape / kiosk: 1280×800
- Collective display: 1920×1080

Only create additional widths when a real layout need exists.

## 5. How to keep this manageable

This atlas does **not** require 140 unrelated full-screen drawings.

Use:
- one full TARGET per page/destination
- state strips / state matrices for closely related variants
- matched device boards for tablet/kiosk/display surfaces
- one page-specific target before implementation
- one route index that links every state to its visual target

No state may be silently omitted just because the happy path looks good.

## 6. Page-by-page implementation remains the gate

After this atlas is reviewed:
1. Home
2. MOVE / contribution
3. Confirmed contribution
4. Community
5. Progress
6. You
7. Unified movement picker / Champion setup
8. Auth/onboarding
9. Join/create community
10. Community challenge
11. Event/queue
12. Station/kiosk
13. Public/tablet/collective display

For each implementation:
**BEFORE → TARGET → AFTER → emotional self-critique → STOP for visual acceptance.**

## 7. Emotional acceptance

Every page handoff answers:
1. What should the person feel in the first five seconds?
2. What does the eye land on first?
3. What action is unmistakable?
4. What makes it unmistakably WE STAY FIT?
5. What is still flat, corporate, empty, over-carded, or emotionally weak versus target?

If #5 has a material answer, iterate before moving on.

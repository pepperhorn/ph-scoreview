# 0003 — Teaching layer for the score editor

- **Status:** approved
- **Ledger:** 0003 · **Plan:** ../plans/0003-teaching-layer.md
- **Author:** lead · **Date:** 2026-11-02

Decisions are marked **(decided)** when they came from the product owner, and **(builder's call)** when they were made
while writing this document and have not been individually approved. Anything unmarked is description.

## Intent

A student working alone should be able to sit down with the editor and get from "I love this song" to a score they
worked out themselves. The teaching layer is a coach on top of the editor. It does not do the work for them, and it
does not tell them what to do. It asks questions that lead them to the answer, so that they learn to hear and notate
music, not just to operate the software.

The editor itself is unfinished. This layer must not depend on features that are still moving more than it has to,
and it must leave the editor fully usable without it.

## The coaching rules

These define the product and apply to every part. **(decided)**

1. **Always leading questions, never explicit directions.** Not "set the time signature to 3/4" but "how many beats go
   by before it feels like the pattern starts over?"
2. **Never say "wrong" and never give the answer.** When the student is off, send them back to the music with a smaller
   task. Reference example, for a student who tapped 4 in a song that is in 3: "Have a listen again. Which beat is 1?
   Clap or tap 1 only, then count how many beats there are till you get back to 1 again."
3. **Bite-sized, digestible chunks.** One idea at a time.
4. **When a step doesn't land:** try another approach or way of describing it, then break it down further until they
   find success, then build back up step by step.

## Who it is for

A student working alone. **(decided)** Not a teacher-assigned or classroom flow, though nothing here should prevent one
later. Young students may use it, which is one reason logging is anonymous.

## Goals

- Open with a question about what the student wants to do, and shape everything after it around that goal.
- Set up the score before any notes, through an overlay tour that dims the editor and spotlights the real controls.
- Support transcribing a song from audio, with stem separation and pitch and rhythm detection as a hidden frame of
  reference for the coach.
- Support composing, through the same style of guidance.
- Improve the coach continuously through a collaborative review cycle.

## Non-goals

- Pulling audio from Spotify (it is DRM-protected) or from YouTube (it breaks YouTube's terms, which matters for a paid
  product). Students bring their own audio.
- Automatic transcription as a product. The analysis exists to guide the student, not to replace them.
- Teaching the whole of music theory. The coach teaches what the current piece needs.

## Anti-goals

The work has failed, even if it technically functions, if:

- The coach reveals an answer, including when a student asks or tricks it.
- The tour lectures, or reads as a list of instructions.
- Using the editor without the coach becomes harder, or the coach blocks an experienced user.
- A student feels marked or told off.

## Overall shape: four parts

The parts depend on each other, so they are built in this order. Each gets its own detailed design and plan. Part 1 is
specified in full below; parts 2 to 4 are outlines that record what has been decided so far.

| Part | What it is | Depends on |
| --- | --- | --- |
| 1 | Goal picker and guided setup tour, scripted questions | Editor only |
| 2 | Score details and projects saved to the student's account | Part 1, accounts |
| 3 | Audio analysis: upload, Demucs, pitch and beat detection | Accounts, server |
| 4 | Live AI coaching and the review cycle | Parts 1 to 3 |

## Part 1: goal picker and guided setup tour

### Goal picker

The first thing a new student sees is a question about what they want to do, offering outcomes such as "Transcribe a
song I love" and "Write something of my own". **(decided)** The other two options from the concept mockup, "Copy out
sheet music" and "Just explore", and a "No thanks, I know what I'm doing" skip link are **(builder's call)**.

Mockup copy: title "What would you like to make today?", subtitle "Pick one. I'll ask you questions along the way, and
you'll make the decisions." Each option is a card with an icon, a name and a one-line description.

### Setup tour

An overlay dims the editor and spotlights one real control at a time, with a coach bubble beside it holding one leading
question. **(decided)** The student makes the change in the real control, not a copy of it. Steps cover: **(decided)**

- About the piece: title, composer, description, project name, tags
- How it sounds: tempo, time signature, key **(key is builder's call; it was not in the owner's list)**
- Who plays it: the staves and each one's instrument

Rules for the steps:

- The order of the steps and the wording vary with the chosen goal. A transcriber is asked to listen; a composer is
  asked what they imagine. The goal also changes which steps appear: "Copy out sheet music" reads answers off the page.
- "About the piece" prompts are plain questions, not lessons. **(builder's call)**
- The coach can ask the student to do something, such as tapping along, not only to answer. **(decided in concept)**
- Every step can be skipped and filled in later. **(builder's call)**
- The bubble shows progress ("Setting up, 2 of 5") and offers "Give me a hint".

**Hints in part 1 are scripted.** Each step has a short ladder of pre-written hints that follow the coaching rules:
another way of describing it, then a smaller task. There is no checking of the student's answer in part 1, because
nothing to check against exists until part 3. Live AI wording arrives in part 4. **(builder's call)** A wrong answer
is therefore not detected in part 1. The coach cannot tell a song's time signature, so it must never imply that it
has judged one.

**The tap counter (builder's call)** is a small widget inside the coach bubble, not an editor feature. It counts the
student's taps and shows the count, and on the tempo step it can show the speed of those taps, since that comes from
the student and not from any analysis. It never fills in a control: the student enters the value themselves.

**Audio in part 1 (builder's call).** The tour does not load or play audio. The transcribe path asks the student to
listen to the song however they normally do, and the tap counter counts their taps against nothing. Playing their file
inside the editor needs the upload built in part 3.

### Where it appears and how it ends

- The goal picker appears each time a student starts a new score, because the goal belongs to the piece. It has a
  skip option and a "don't show this again" choice, and the tour can be reopened from the editor. **(builder's call)**
- "New score" means the student explicitly starts one. A plain page load does not count, so the host must signal it
  (only the phone menu has a New score action today). **(builder's call)**
- The chosen goal is saved on the score, because parts 3 and 4 will need it. **(builder's call)**
- It works on desktop and phone. The two shells place controls differently, so each step names a target per shell.
  **(builder's call)**
- It is an optional layer. With it off, the editor behaves exactly as it does today. **(builder's call)**
- "Don't show this again" is remembered locally for part 1; accounts come in part 2. **(builder's call)**
- The tour needs an editable score. In the read-only state it does not start. **(builder's call)**

### What exists in the editor today

Paths are under `packages/pepperscore-editor/src`.

- **Title and composer:** `MetaText` in `ui/TopBar.tsx`, written by the `setMeta` command in
  `engine/commands/score.ts`.
- **Key, time, tempo:** top-bar chips in `ui/TopBar.tsx` that open popovers, and the Score tab in `ui/ScoreTab.tsx`
  on desktop. On phone they are in `ui/phone/PhoneTabs.tsx` and related files.
- **Clef:** `ui/ScoreTab.tsx`.
- **Stored fields:** `meta` in `model/schema.ts` and `format/pepperscore-file.ts` holds only title and composer.
- **Staves:** a new score is one treble stave, from `newScore` in `ui/files.ts`. Parts carry a name, `gmProgram` and
  clefs. `model/instruments` has an instrument list, used today for layout swaps.
- **Editing is gated** by `editable` from the licence check.

### Gaps part 1 has to fill

1. **There is no way to add a stave or set an instrument in the editor.** No command or UI does this today. The tour's
   "who plays it" step needs it, so a new undoable command and a real control belong in part 1. The control must be a
   normal editor feature that works without the tour, respect the licence's `maxStaves` cap, and appear in both shells.
2. **Description, project name and tags have no home.** Add them as optional fields to `meta`, to the
   `.pepperscore` format, and to `setMeta`, and add a place to edit them. Files saved before this change must still
   open. Whether they export to MusicXML is left to the builder. **(builder's call)**
   Scope of the stave control **(builder's call)**: it adds a part, so a piano is one part with two staves. It offers
   pitched instruments and voice; drums wait, as unpitched notation is out of scope for this flow. An instrument can
   only be changed, and a part only removed, while the part has no notes, which avoids the question of what happens
   to existing notes on a transposing instrument. Reordering waits.
3. **Controls have no stable tour hooks.** Some have `data-ps-popover-for`; most do not. Add a consistent marker to
   each control the tour targets.

### Packaging and where it runs

- **The tour, its script and the coaching layer live in a separate private repo.** **(decided)** Nothing from them goes
  into this MIT repo, including the question wording.
- The editor changes under Gaps above are ordinary editor features and stay here.
- **The editor needs a plugin slot, which does not exist yet.** The tour talks to the editor through a small public
  interface (read and dispatch against the document, find a target, open a popover). That slot is MIT and is part 1
  work in this repo. It should follow `docs/specs/pepperscore-plugins-and-embeds.md`.
- **The first home is BeCreative, and students there can edit.** **(decided)** BeCreative hosts the editor and mounts
  the tour, so it needs an editor licence for those students, and it signals "new score" to the tour. BeCreative
  changes are planned as their own tasks in that repo. How BeCreative obtains the licence is left to the plan.

### Style

Class names alongside any utility classes, per project convention. Poppins for the coach's UI. Match the editor's
existing `ps-` naming. The bubble, spotlight and goal picker need keyboard use and screen reader support, and the
spotlight must follow its target when the layout changes or the phone header collapses.

### Done means

- A new student can pick a goal and reach a set-up score, with staves and instruments, without leaving the tour.
- An experienced user can dismiss it in one action and is not bothered again.
- With the tour off, existing editor tests pass and behaviour is unchanged.
- Every question in the script follows the coaching rules. The product owner reviews the script before it ships.

### Left to the builder

The exact step order and script draft, spotlight mechanics, how the public interface is shaped, the storage key for
local progress, and the placement of the new metadata and stave controls, within the existing layout conventions
(on phone, frequent controls go in the bottom toolbar and occasional ones in the header).

## Part 2 outline: score details and projects

- A project is a label, not a real folder. For the user it acts as a virtual folder that links various elements. Each
  item still saves to the student's account, and its record is tagged with the metadata. **(decided)**
- "Elements" includes scores and, later, a transcription's audio and stems. **(builder's call, to confirm in part 2)**
- Existing plans point to ph-apps (`app_user_saves`) for accounts and saves. Confirm before designing.

## Part 3 outline: audio analysis

- The student brings the audio, by uploading a file or recording it playing on their machine. **(decided in concept;
  the exact options are for part 3)**
- Demucs separates the instruments; pitch and beat detection build the reference.
- Demucs is heavy, so this probably runs on a server. Hosting, cost and how long audio is kept are open, and matter
  because the audio is commercial music the student has supplied. Licensing of Demucs and its models needs a check.
- The result must be precise enough to back a question, not to print a score.

## Part 4 outline: live coaching and review cycle

- AI writes the coaching live within the rules above, with continuous improvement. **(decided)**
- Plain code, not the AI, compares the student's work with the analysis, and gives the AI only the kind of problem,
  such as "beat 1 is in the wrong place". The AI never sees the correct answer, so it cannot let it slip.
  **(builder's call, proposed to and not objected to by the owner)**
- Logging is anonymous. **(decided)** No account link, student names or uploaded audio; scores stay out unless the
  owner says otherwise. **(builder's call)**
- What has worked for a student lives privately on their account, separate from the review logs. **(builder's call)**
- The coach watches the same small steps in transcription as in setup, for pitch and rhythm: higher or lower than the
  last note, sing it, then find it.
- The coaching wording comes from an LLM API call. The model must be swappable. Start with Haiku, then test others
  such as Kimi, and choose by cost per session and by how often each breaks the "never give the answer" rule, using the
  anonymous review logs as evidence. **(recommendation accepted by the owner; the final model is chosen in part 4)**
- AI has a cost per session, which ties into paid plans. Undecided.

**The review cycle (decided):** suggestions are shared, the reviewers give notes, a further review incorporates the
notes, and only then are the rules updated. Nothing changes on its own. Rules being versioned so a change can be rolled
back is **(builder's call)**, as is the guess that reviewers are the owner and invited teachers.

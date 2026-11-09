# Roadmap: Synthetic

## Overview

A hand-authored roadmap in the same shape as a real host, covering every case the adapter must handle.

## Phases

- [x] **Phase 1: Built Thing** - Every plan already has a summary
- [ ] **Phase 1.10: Ten** - Ordering probe (sorts after 1.9)
- [ ] **Phase 1.9: Nine** - Ordering probe (sorts before 1.10)
- [ ] **Phase 2: Ready Thing** - Context and two plans, nothing built
- [ ] **Phase 2.1: Inserted Thing** *(INSERTED)* - Context only
- [ ] **Phase 3: No Context** - No directory at all
- [ ] **Phase 4: Broken Yaml** - One plan has malformed frontmatter

## Phase Details

### Phase 1: Built Thing

**Goal**: Prove that a phase whose every plan has a summary reads as built.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: SYN-01
**Success Criteria** (what must be TRUE):
  1. The built phase is never offered for approval
**Plans**: 1/1 plans executed

**Wave 1**

- [x] 01-01-PLAN.md — Build the one thing

### Phase 1.10: Ten

**Goal**: Sort after Phase 1.9 because phase numbers compare as integers.
**Depends on**: Phase 1
**Plans**: TBD

### Phase 1.9: Nine

**Goal**: Sort before Phase 1.10.
**Depends on**: Phase 1
**Plans**: TBD

### Phase 02: Ready Thing

**Goal**: A phase that has its context and two plans, ready to approve.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: SYN-02, SYN-03
**Success Criteria** (what must be TRUE):
  1. It shows as ready to approve
**Plans**: 0/2 plans executed
**UI hint**: yes

**Wave 1**

- [ ] 02-01-PLAN.md — Set up the ready thing with a checkpoint
- [ ] 02-02-PLAN.md — Finish the ready thing without objective block

### Phase 2.1: Inserted Thing (INSERTED)

**Goal:** An inserted phase that has been discussed but not planned.
**Depends on**: Phase 2
**Requirements**: Enabling phase — no requirement ID.
**Plans**: TBD

### Phase 3: No Context

**Goal**: A phase nobody has discussed yet.
**Depends on**: Phase 2
**Requirements**: SYN-04
**Plans**: TBD

### Phase 4: Broken Yaml

**Goal**: One plan's frontmatter does not parse; only this phase is affected.
**Depends on**: Phase 3
**Requirements**: SYN-05
**Plans**: 0/1 plans executed

- [ ] 04-01-PLAN.md — The broken one

## Notes

A roadmap may quote headings in code; the adapter must not mistake them for phases:

```markdown
### Phase 9: In A Fence

**Goal**: This is not a phase.
```

## Progress

| Phase | Plans Complete | Status |
|-------|----------------|--------|
| 1. Built Thing | 1/1 | Complete |
| 2. Ready Thing | 0/2 | Not started |

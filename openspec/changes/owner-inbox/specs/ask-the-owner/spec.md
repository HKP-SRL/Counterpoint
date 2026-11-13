# ask-the-owner Spec Delta

## Purpose
Claude Code sessions, both builders in a run and the owner's own interactive sessions, ask the owner through the inbox instead of the terminal.

## ADDED Requirements

### Requirement: An ask tool for every session
Counterpoint SHALL provide an `ask_owner` tool to every builder session it starts, and SHALL offer the owner a one-time setup that adds the same tool to their interactive Claude Code sessions. A call SHALL post a question card with the question, 2–4 options, the recommended option and whether it is reversible.

#### Scenario: Builder asks
- **WHEN** a builder calls `ask_owner` with three options
- **THEN** a card with those options appears in Needs You, naming the run, the change and the session

#### Scenario: Interactive session asks
- **WHEN** the owner's interactive Claude Code session, set up with the tool, needs a decision
- **THEN** the question appears as a card in Needs You and the answer returns to that session

### Requirement: Waiting and assuming
A call SHALL either wait for the answer or return at once. A reversible question asked without waiting SHALL return the recommended option marked as assumed, and a later different answer SHALL follow the unanswered-card rules. A session ending before an answer SHALL leave its card answerable, and the answer SHALL be handed to the next session working on the same change.

#### Scenario: Owner answers after the session ended
- **WHEN** the owner answers a builder's card after that session handed off
- **THEN** the next session on that change receives the answer in its prompt

### Requirement: A capability limited to its own cards
Each session SHALL get its own ask capability, which can only post cards for that session and read their answers. It SHALL NOT read other cards, start or stop runs, approve, or reach any other console function, and a session SHALL have at most a fixed number of open cards.

#### Scenario: Leaked capability
- **WHEN** a builder obtains its own ask capability and tries to read another session's card
- **THEN** the request is refused

#### Scenario: Card flood
- **WHEN** a session tries to open more cards than its limit
- **THEN** further calls are refused with a message to proceed on assumptions

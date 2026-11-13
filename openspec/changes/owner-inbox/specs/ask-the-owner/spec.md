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
- **THEN** the question appears as a card in Needs You, the owner is notified, and the answer returns to that session

### Requirement: The card stands on its own
The tool SHALL tell every session that the owner sees only the card: a question SHALL name each thing it is about, never refer to "above" or the chat, and give each option in one short line. While an interactive session's question waits, the tool SHALL also tell that session to put the question in its reply in one line with numbered options, since the owner may be reading the chat.

#### Scenario: Owner at the terminal
- **WHEN** an interactive session asks without waiting
- **THEN** its reply in the chat also carries the question in one line with numbered options

### Requirement: Waiting and assuming
An interactive session's call SHALL wait for the answer or return at once; a builder's call SHALL always return at once, since builders never wait. A reversible question that returns unanswered SHALL return the recommended option as assumed; a later different answer SHALL follow the unanswered-card rules. A builder's card SHALL stay answerable after its session ends, and the answer SHALL go to the change's next session.

#### Scenario: Builder asks to wait
- **WHEN** a builder asks a reversible question with wait set
- **THEN** the call returns at once with the recommended option as assumed

#### Scenario: Owner answers after the session ended
- **WHEN** the owner answers a builder's card after that session handed off
- **THEN** the next session on that change receives the answer in its prompt

### Requirement: Where an answer went
An answered session card SHALL say "Not read yet" until the session that asked reads the answer, by waiting or with `check_answer`, and then "Read by the session"; a builder's answer its session never read SHALL say that the change's next session gets it. When an interactive session ends, its unanswered cards SHALL close as "Session ended", listed under Answered, and its capability SHALL end. Each card SHALL show when it was asked.

#### Scenario: Answer read
- **WHEN** the owner answers a session's card and the session then calls `check_answer`
- **THEN** the card's outcome changes from "Not read yet" to "Read by the session"

#### Scenario: Interactive session closed
- **WHEN** the owner quits a Claude Code session that has an unanswered card
- **THEN** the card leaves the inbox and shows under Answered as "Session ended"

### Requirement: A capability limited to its own cards
Each session SHALL get its own ask capability, which can only post cards for that session and read their answers. It SHALL NOT read other cards, start or stop runs, approve, or reach any other console function, and a session SHALL have at most a fixed number of open cards.

#### Scenario: Leaked capability
- **WHEN** a builder obtains its own ask capability and tries to read another session's card
- **THEN** the request is refused

#### Scenario: Card flood
- **WHEN** a session tries to open more cards than its limit
- **THEN** further calls are refused with a message to proceed on assumptions

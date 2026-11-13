# needs-you Spec Delta

## ADDED Requirements

### Requirement: Revision rounds in Needs You
A round that lands green SHALL put its change in Needs You as revised and ready to review, with the notes it addressed. A flagged note and a parked round SHALL appear with their reason. A revised item SHALL resolve itself when the owner sends another round or the change merges.

#### Scenario: Round lands green
- **WHEN** a revision round passes every gate and its head is pushed
- **THEN** Needs You lists the change as revised and ready to review, with the notes it addressed

#### Scenario: Flagged note
- **WHEN** a round flags a note as outside the change
- **THEN** Needs You shows the note, the reason, and the choices to send it anyway or file it as a backlog item

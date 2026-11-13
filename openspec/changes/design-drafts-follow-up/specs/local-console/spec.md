# local-console Spec Delta

## MODIFIED Requirements

### Requirement: Strict content security policy
The console SHALL be served with a content security policy that allows scripts only from its own origin and frames only from the draft server's origin, and SHALL NOT let any page frame the console. It SHALL render all host-supplied text (file contents, diffs, logs) as plain text, never as HTML.

#### Scenario: Diff containing markup
- **WHEN** a changed file in a diff contains `<script>` text
- **THEN** the console shows it as text and runs nothing

#### Scenario: Draft in a frame
- **WHEN** the console shows a draft from the draft server in a frame
- **THEN** the browser shows the draft

#### Scenario: Other frames refused
- **WHEN** a page in the console tries to frame any other origin, or another page tries to frame the console
- **THEN** the browser refuses the frame

# Provenance: cena fixture

- **Source:** the Cena repository's `openspec/` directory, taken from the **working tree** (uncommitted) on branch `openspec-migration` (HEAD `6bddb6a6102377139f72da843136889c66241485`), on 2026-11-11 at 09:47 local time, while Cena's OpenSpec conversion was being finished.
- **How:** `rsync -a` of `Cena/openspec/` into `openspec/` here, then `diff -r` against the source (identical). 57 files. Manifest digest (`find . -type f -exec shasum -a 256 {} + | sort -k2 | shasum -a 256`, run inside `openspec/`): `50a4d03fbf0e77b0c3fa0810bccf0e65f6cdc592668479d90881baaf9b34360d`. Cena was only read; nothing was written to it.
- **Role:** contract fixture. The OpenSpec adapter's parser is tested against these exact bytes (`tests/adapters/openspec/cena.test.ts`): seven active changes in dependency order, `owner-ui-on-astryx` ready with 1/32 tasks done and three owner steps, the other six proposed without tasks, and two archived changes. The counts agree with `openspec list --json` run on this copy.
- **Refresh:** when Cena's committed `openspec/` diverges, copy it again the same way, update this file and the expectations in the parse test.
- **Review before any public release of Counterpoint:** these files are the owner's private planning documents for Cena. Replace or scrub them before the repository is published.

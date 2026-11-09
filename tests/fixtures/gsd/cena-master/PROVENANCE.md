# Provenance: cena-master fixture

- **Source:** Cena repository, branch `master` @ 7e2e2a1 (`7e2e2a1370cec376c9769ba1513581028f268ff0`)
- **Frozen:** 2026-11-09
- **How:** `git archive` of `.planning/ROADMAP.md` and `.planning/phases` from `master`, extracted here. Cena was only read (`git archive --remote` / `git ls-remote`); nothing was written to it.
- **Role:** contract fixture. The GSD adapter's parser is tested against these exact bytes (Phase 1 with 17 plans, Phase 1.1 with 14, every plan built; Phases 2-7 without a directory).
- **Review before any public release of Counterpoint:** these files are the owner's private planning documents for Cena. Replace or scrub them before the repository is published.

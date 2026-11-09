# API Coverage — Phase 01.1 Design System Migration

No external API integration: the phase changes only the repo's styling layer, design tokens, primitives
and copy artifacts — the sole external calls are build-time typeface downloads via `next/font/google`
(which self-hosts and issues zero runtime requests) and one-off design-project reads and writes through
the `DesignSync` tool, neither of which ships an external API capability surface in the product.

Detector result at plan time: `{"detected": false, "signals": []}`
(`node gsd-core/bin/lib/api-coverage.cjs --json` over the phase scope, 2026-08-05).

## Why this declaration exists rather than a matrix

The deterministic detector returned `detected: false`, so the checkpoint does not fire. This declaration
is written anyway because several plans in the phase name the `DesignSync` tool and the shadcn registry,
and a seal-time re-scan over the plan bodies could read those as integration signals. The reasoned
declaration is the accepted form for a phase that genuinely integrates no external API.

## The three external touchpoints, and why none is an integration

| Touchpoint | When | Why it is not an API integration |
|---|---|---|
| `fonts.gstatic.com` | build time only | `next/font/google` downloads the three typefaces during the build and self-hosts them alongside other static assets. The compiled CSS emits zero external URLs — asserted by `tests/theme/build-assets.test.ts` (plan 01.1-05). No runtime request, no capability surface. |
| `ui.shadcn.com` registry | once, at plan 01.1-07 | `shadcn add` copies `.tsx` source files into `components/ui/` where they become repo code reviewed in the diff. Registry items are source, not dependencies; the phase adds zero npm packages. |
| `DesignSync` (design project `07b799d4-de60-4b17-8aec-106904d0b264`) | plans 01.1-01 and 01.1-14 | A developer-tooling read and write against a design document, executed twice during planning-adjacent tasks. Nothing in the shipped product calls it, and no capability of it is exposed to a user. |

## Related security coverage

Supply-chain and third-party-request risk for all three touchpoints is carried in the phase's threat
registers rather than here: `T-01.1-03` and `T-01.1-23` (third-party font and asset requests, plan
01.1-05), `T-01.1-04` and `T-01.1-SC` (registry supply chain and package-manager installs, plan 01.1-07),
and `T-01.1-10` and `T-01.1-12` (design-project write-back and fetched content treated as data, plans
01.1-01 and 01.1-14).

# LWS Security

## Trust boundaries

Treat as untrusted:
- LLM output;
- imported character/world files;
- prompts and lore;
- remote model responses;
- imported assets/metadata.

## LLM boundary

The LLM cannot execute SQL, shell commands, arbitrary file writes, or arbitrary HTTP. Consequential model output becomes a proposal that passes application validation.

## Prompt injection

Separate LWS platform/simulation instructions, Director commands, canonical state, imported/untrusted content, character speech/narrative, and model output.

Do not allow text embedded in character/world content to redefine security or simulation authority.

## Knowledge isolation

Character cognition contexts must fail closed with respect to hidden information. If an entity has not perceived/learned information, do not include it merely because the database knows it.

## State mutation

Security-sensitive changes must authenticate/authorize, validate input, validate domain invariants, commit transactionally, and fail closed on invalid proposals.

## Secrets

Never log or persist model API keys/session secrets inside simulation events or prompt context.

## Imports

Never execute imported code as part of normalization. File contents are data.

## Filesystem/network

Restrict LWS file access to its owned boundaries. Remote model calls occur through the existing ST/provider boundary. Model output must not arbitrarily select filesystem paths or network destinations.

## Prompt precedence is not security

Putting LWS text first or last in a prompt is not a sufficient control. Application logic enforces security and simulation invariants.

## Cognition and deliberation invariants

- **Resource bounding**: Deliberation and candidate generation must bound candidate evaluation counts and iteration steps to prevent unbounded CPU execution.
- **Moral veto enforcement**: Hard moral veto constraints ($\ge +75$) are enforced in application code during deliberation, preventing character actions that violate fundamental moral axioms regardless of prompt manipulation.
- **Lifecycle gating**: Cognition endpoints enforce simulation status checks (rejecting mutations on paused or archived simulations with HTTP 400).
- **Auditability**: All goal, need, and intention mutations must be committed through the authoritative event ledger (`UPDATE_RUNTIME_STATE`) to preserve an unbroken audit trail and prevent direct-SQL tampering.

## Social systems, rumors, and character development invariants

- **Tri-tier endpoint authorization & perspective isolation**:
  - *Observer Tier (Read-Only Ground Truth)*: Unrestricted simulation ground-truth inspection (relationship matrices, evidence chains, rumor transmission trees, complete faction rosters, and global development history). Enforces read-only semantics with no state mutation capabilities.
  - *Character-Subjective Tier (Knowledge-Isolated)*: Strict character perspective filtering (`/simulations/:simLwsId/characters/:charLwsId/social-view`). Exposes only relationships originating from the character, subjective beliefs adopted from received social information, current individual faction rank/standing, and personal development records. Completely prevents omniscience leakage or third-party secret disclosure.
  - *Director Tier (Authoritative State Transitions)*: Authoritative simulation interventions (`POST /relationships/modify`, `POST /rumors/inject`, `POST /factions/memberships/override`, `POST /development/record-override`) execute strictly via validated event ledger transactions (`DIRECTOR_MODIFY_STATE`, `UPDATE_RUNTIME_STATE`) with mandatory provenance logging.
- **Non-hive-mind isolation**: Information propagation occurs strictly through point-to-point physical communication (`COMMUNICATE`) or direct perception. Characters never instantaneously share beliefs or rumors across distances without explicit causal transmission events.
- **Character development causality verification**: Development records require verified causal event IDs belonging to the same simulation for all non-director trigger categories (`acute_trauma`, `sustained_experience`, `social_reinforcement`, `cognitive_dissonance`), preventing unearned or synthetic personality mutations.
- **Rumor tree topology integrity**: Enforces 17 structural invariants across database triggers and application code, guaranteeing that rumor trees maintain strictly monotonic depths ($0 \le d \le 5$), valid parent/root references, identical simulation lineage, and immutable propagation provenance.



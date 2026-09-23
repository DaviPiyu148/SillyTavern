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

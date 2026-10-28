# Browser extension

This is the current point-and-talk product, extracted from `ext-pointtalk` at the commit in `../PROVENANCE.json`. It preserves the existing capture sensors, cross-page session, microphone and briefing adapters.

Run `python3 tools/disdat.py setup --provider groq` from the repository root. Load the private extension directory it prints into Chrome. The source directory opens setup instructions until a mode is configured.

Own-key mode records with the selected direct providers and downloads a local capture bundle. Hosted mode selects the existing Dis Dat account and service. See [configuration](../docs/configuration.md) and [architecture](../docs/architecture.md).

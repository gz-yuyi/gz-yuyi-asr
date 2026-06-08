Update CHANGELOG.md whenever you make a commit.

Write user-facing documentation content in Chinese unless a file already has a clearly established different language.

Versioning rules:
- Interface standard restructuring or breaking contract changes require a major version bump.
- Small backward-compatible interface changes require a minor version bump.
- Test console bug fixes, UI-only improvements, and test console feature changes require a patch version bump.
- If a change spans multiple categories, use the highest required version bump.

When bumping a version:
- Update package.json and package-lock.json together.
- Update CHANGELOG.md under the matching version section or under [Unreleased] before the version is finalized.
- Versioned releases must use `vX.Y.Z`; do not create separate `console-vX.Y.Z` releases.
- Versioned console HTML assets must use `yuyi-asr-test-console-vX.Y.Z.html`.
- Do not publish or depend on `latest` console assets for application packaging.

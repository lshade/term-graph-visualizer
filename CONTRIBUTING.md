# Contributing

## Welcome

Contributions are welcome. You can open an issue to discuss a bug or idea, or
submit a pull request with a focused improvement.

## Set up the project

Install the current Node.js LTS release and npm, then install the locked
dependencies:

```powershell
npm ci
```

Start the development server:

```powershell
npm run dev
```

The public example dictionary loads by default. See
[`docs/dictionary-format.md`](docs/dictionary-format.md) when changing the
dictionary schema or example content.

## Keep private data local

Do not commit private names, private data, credentials, internal URLs, or
private dictionaries. Create local dictionaries with the `local-` filename
prefix described in the README. The repository ignores those files, local
enrichment scripts, environment files, generated exports, and build output.

Review the staged file list before every commit:

```powershell
git diff --cached --name-only
```

## Validate changes

Run the checks relevant to every pull request:

```powershell
npm run validate:config
npm run build
```

Exercise affected interactions in the development server. For dictionary
changes, confirm that terms, relationships, references, search, and editing
still behave as expected.

## Submit a pull request

Keep each pull request focused and explain the user-visible effect. Include
the validation commands you ran and note any checks that could not be
completed. Link the relevant issue when one exists. Maintainers may ask for
small follow-up changes before merging.
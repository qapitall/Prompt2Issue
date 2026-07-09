# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-07-09

### Added
- Pick a category for AI-generated cards: type it next to the Generate button
  (with suggestions from the board) and every generated card lands in it;
  leave it empty and the AI picks per card, as before.
- Column headers show how many cards are in each column.

### Changed
- Categories are case-insensitive: "Oyun" and "oyun" are the same category.
  New cards reuse the existing casing, and the filter matches regardless of
  case (Turkish dotted/dotless i handled correctly).
- Clicking anywhere on a card opens the editor (buttons keep their own actions).

## [1.3.0] - 2026-07-08

### Added
- One-click complete: every card now has a ✓ button that marks it as Done
  without dragging. Thanks [@Piyush180](https://github.com/Piyush180) for the
  project's first external contribution!
- A P2I icon, used as the favicon and in the README.

### Changed
- Pressing Enter in the plan box generates cards right away; use Shift+Enter
  for a newline.

## [1.2.0] - 2026-07-04

### Added
- Drag-and-drop reordering: cards can be reordered within a column and dropped
  at an exact position in another column. The order is saved and survives reloads.
- Card categories: type a free-text category when adding or editing a card,
  filter the board by category, and AI-generated cards get a category assigned
  automatically (editable in the preview).

### Fixed
- AI generation could return prose instead of JSON (and act on local files).
  The Claude CLI is now invoked as a pure text transformer: proper system
  prompt, all tools disabled, and a neutral working directory.

## [1.1.0] - 2026-06-25

### Added
- Dark mode toggle with saved preference.
- Screenshots and repository links in the README / package metadata.

## [1.0.0] - 2026-06-25

### Added
- Initial release: local kanban board (To Do / In Progress / Done) with one
  JSON file per day, automatic carry-over of unfinished cards, manual card
  editing, and AI card generation from plain-language plans via the Claude
  Code CLI.

[1.4.0]: https://github.com/qapitall/Prompt2Issue/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/qapitall/Prompt2Issue/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/qapitall/Prompt2Issue/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/qapitall/Prompt2Issue/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/qapitall/Prompt2Issue/releases/tag/v1.0.0

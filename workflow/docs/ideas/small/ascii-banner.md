# Idea — ASCII banner

Turn a short phrase into a large ASCII-art banner using a fixed figlet-style
font baked into the repo. One line in, banner out. Optional `--width` to wrap
long phrases across multiple banner rows.

## Seed non-goals (for refine-idea)
- No custom font files or Google Fonts.
- No color, ANSI gradients, or image export.
- No multi-line input paragraphs — single phrase only.
- No web API or HTTP server.

## Why this idea fits sad-wf
Fixed font data keeps scope bounded; stories split cleanly between glyph
rendering and CLI. Good for testing Touch scope on a tiny `src/` tree.

## Rough capabilities (hint for SAD#3)
- `banner.font` — character glyph lookup
- `banner.render` — layout and line assembly
- `cli.print` — stdin/arg input, stdout banner

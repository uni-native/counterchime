# Counterchime visual specification

Working surface, not a marketing page. The generated full-screen concept in design-concept.png established the layout before implementation: simple brand/header, one brief headline, a left rule editor, right counterexample/replay, and a bottom voice workbench.

## Tokens

- Canvas: true white #ffffff
- Main text: #17191c
- Muted text: #656970
- Fine separators: #dfe1e5
- Quiet workbench: #f8f9fb
- Single functional accent: cobalt #214fdb
- DM Sans Variable for content and controls; IBM Plex Mono for inventories and evidence numbers
- Corners 4–6px, no decorative shadows or gradients
- Open pane layout and table rows, not decorative card grids

The implementation follows the concept hierarchy and controls. Required model updates replace gold with stars and use depth8/10,000 states/30 units. Original monochrome token glyphs honor the requested black/white plus one-accent direction instead of the concept generator's brown token color. Additional required controls include undo, import, revision/stale markers, model assumptions, explicit privacy, and unsupported-live state.

Desktop uses a38% editor and flexible evidence pane. Below800px the panes stack in task order. Voice controls remain directly accessible after the rule/evidence work area. Reduced-motion preference disables incidental animation.

All runtime artwork is code-native original SVG. The generated concept is a design reference, not a screenshot or evidence of functioning software.

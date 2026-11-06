/** Reconstructed from the read-only Codex diff presentation and global tokens.
 * Evidence and intentional Web adaptations: rich composer contract, section 21.
 * This stylesheet is scoped to Pierre's shadow root; it contains no user data.
 */
export const reviewDiffCSS = `
  :is([data-diff], [data-file]) {
    --codex-diffs-surface: var(--surface);
    --codex-diffs-context-surface: color-mix(in srgb, var(--codex-diffs-surface) 94%, var(--surface));
    --codex-diffs-separator-surface: color-mix(in srgb, var(--codex-diffs-surface) 94%, var(--accent));
    --codex-diffs-hover-surface: color-mix(in srgb, var(--codex-diffs-surface) 92%, var(--surface));
    --codex-diffs-context-number: color-mix(in lab, var(--codex-diffs-surface) 98.5%, var(--diffs-mixer));
    --codex-diffs-addition-number: light-dark(
      color-mix(in lab, var(--diffs-light-bg, #fff) 91%, var(--diffs-addition-base)),
      color-mix(in lab, var(--diffs-dark-bg, #000) 85%, var(--diffs-addition-base)));
    --codex-diffs-deletion-number: light-dark(
      color-mix(in lab, var(--diffs-light-bg, #fff) 91%, var(--diffs-deletion-base)),
      color-mix(in lab, var(--diffs-dark-bg, #000) 85%, var(--diffs-deletion-base)));
    --codex-diffs-addition-hover: light-dark(
      color-mix(in lab, var(--diffs-light-bg, #fff) 80%, var(--diffs-addition-base)),
      color-mix(in lab, var(--diffs-dark-bg, #000) 70%, var(--diffs-addition-base)));
    --codex-diffs-deletion-hover: light-dark(
      color-mix(in lab, var(--diffs-light-bg, #fff) 80%, var(--diffs-deletion-base)),
      color-mix(in lab, var(--diffs-dark-bg, #000) 75%, var(--diffs-deletion-base)));
    --diffs-dark: var(--text);
    --diffs-light: var(--text);
    --diffs-bg-context-override: var(--codex-diffs-context-surface);
    --diffs-bg-separator-override: var(--codex-diffs-separator-surface);
    --diffs-bg-hover-override: var(--codex-diffs-hover-surface);
    --diffs-bg: var(--codex-diffs-surface) !important;
    background-color: var(--codex-diffs-surface) !important;
  }
  [data-code] { scrollbar-gutter: auto; }
  [data-line-type='change-addition']:is([data-line], [data-no-newline]) {
    --diffs-computed-diff-line-bg: var(--diffs-bg-addition);
  }
  [data-line-type='change-addition']:is([data-column-number], [data-gutter-buffer]) {
    --diffs-computed-diff-line-bg: var(--codex-diffs-addition-number);
  }
  [data-line-type='change-deletion']:is([data-line], [data-no-newline]) {
    --diffs-computed-diff-line-bg: var(--diffs-bg-deletion);
  }
  [data-line-type='change-deletion']:is([data-column-number], [data-gutter-buffer]) {
    --diffs-computed-diff-line-bg: var(--codex-diffs-deletion-number);
  }
  [data-line-type='change-addition'][data-hovered]:not([data-selected-line]) {
    --diffs-computed-hovered-line-bg: var(--codex-diffs-addition-hover);
  }
  [data-line-type='change-deletion'][data-hovered]:not([data-selected-line]) {
    --diffs-computed-hovered-line-bg: var(--codex-diffs-deletion-hover);
  }
  [data-column-number][data-line-type='change-deletion']::before {
    background-color: var(--diffs-deletion-base);
    background-image: none;
  }
  [data-column-number][data-line-type='change-addition'] + [data-column-number][data-line-type='change-addition']::before,
  [data-column-number][data-line-type='change-deletion'] + [data-column-number][data-line-type='change-deletion']::before {
    contain: none;
    top: -1px;
    height: calc(100% + 1px);
  }
  [data-separator]:empty { background-color: transparent; }
  [data-separator]:empty::after {
    content: '';
    grid-column: 2 / 3;
    align-self: center;
    margin-inline: 1ch;
    border-top: 1px solid color-mix(in srgb, var(--diffs-fg) 18%, transparent);
  }
`;

// controls.js — "Controls" tab in the left sidebar. Holds:
//   - View section (Reset View button + keyboard hints)
//   - (Future: Theme + Advanced sections — to be rebuilt against the
//     new src/config/* nanostores so the Settings UI can mutate
//     stores via .setKey() and the renderer auto-reapplies via
//     subscribe() listeners.)

import { UI_TEXT } from '../config/index.js';

// buildControlsPane(opts) -> HTMLElement
//
// opts:
//   onResetView — fn() called when the user clicks "Reset View".
//   applyTheme  — fn() the Settings UI calls after mutating any config
//                 store; flushes the change through to live materials.
//                 (Reserved for the upcoming Theme/Advanced sections.)
export function buildControlsPane(opts) {
  opts = opts || {};
  var onReset = opts.onResetView || function () {};

  var pane = document.createElement('div');
  pane.className = 'left-pane controls-pane';

  var header = document.createElement('div');
  header.className = 'controls-header';

  var title = document.createElement('h3');
  title.className = 'controls-title';
  title.textContent = UI_TEXT.get().CONTROLS_TITLE;
  header.appendChild(title);
  pane.appendChild(header);

  var body = document.createElement('div');
  body.className = 'controls-body';

  body.appendChild(_buildViewSection(onReset));

  pane.appendChild(body);
  return pane;
}


function _buildViewSection(onReset) {
  var section = document.createElement('div');
  section.className = 'controls-section';

  var label = document.createElement('div');
  label.className = 'controls-section-label';
  label.textContent = 'View';
  section.appendChild(label);

  var hint = document.createElement('div');
  hint.className = 'controls-section-hint';
  hint.innerHTML =
    'Double-click or press <kbd>F</kbd> to pivot rotation on what your cursor is over. ' +
    'Press <kbd>R</kbd> to reset the view.';
  section.appendChild(hint);

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'controls-button';
  btn.textContent = 'Reset View';
  btn.addEventListener('click', function () { onReset(); });
  section.appendChild(btn);

  return section;
}

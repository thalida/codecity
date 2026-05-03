// controls.js — "Controls" tab in the left sidebar. Hosts view-mode toggles.
// Future toggles (color mode, label density, etc.) should be added here as
// new sections beside the existing View section.

// buildControlsPane(opts) -> HTMLElement
//
// opts:
//   onResetView — fn() called when the user clicks "Reset View".
//                 Should restore the default camera pose.
export function buildControlsPane(opts) {
  opts = opts || {};
  var onReset = opts.onResetView || function () {};

  var pane = document.createElement('div');
  pane.className = 'left-pane controls-pane';

  var header = document.createElement('div');
  header.className = 'controls-header';

  var title = document.createElement('h3');
  title.className = 'controls-title';
  title.textContent = 'Controls';
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

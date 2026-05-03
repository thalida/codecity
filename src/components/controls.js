// controls.js — "Controls" tab in the left sidebar. Hosts view-mode toggles
// (currently just height mode; future toggles like color mode or label
// density should be added here as new sections).

// buildControlsPane(opts) -> HTMLElement
//
// opts:
//   initialHeightMode  — 'compact' | 'exact' (current active mode)
//   onHeightModeChange — fn(newMode) called when the user picks a different
//                        mode. The handler is responsible for applying the
//                        change to the scene.
//   onResetView        — fn() called when the user clicks "Reset View".
//                        Should restore the default camera pose.
export function buildControlsPane(opts) {
  opts = opts || {};
  var initialMode = (opts.initialHeightMode === 'exact') ? 'exact' : 'compact';
  var onChange    = opts.onHeightModeChange || function () {};
  var onReset     = opts.onResetView        || function () {};

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

  body.appendChild(_buildHeightModeSection(initialMode, onChange));
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


function _buildHeightModeSection(initialMode, onChange) {
  var section = document.createElement('div');
  section.className = 'controls-section';

  var label = document.createElement('div');
  label.className = 'controls-section-label';
  label.textContent = 'Height';
  section.appendChild(label);

  var hint = document.createElement('div');
  hint.className = 'controls-section-hint';
  hint.textContent = 'Compact: sqrt-scaled across project. Exact: floors per line count.';
  section.appendChild(hint);

  var seg = document.createElement('div');
  seg.className = 'segmented-control';
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', 'Building height mode');

  var modes = [
    { value: 'compact', label: 'Compact' },
    { value: 'exact',   label: 'Exact'   }
  ];

  for (var i = 0; i < modes.length; i++) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'segmented-option';
    btn.dataset.value = modes[i].value;
    btn.textContent = modes[i].label;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(modes[i].value === initialMode));
    if (modes[i].value === initialMode) btn.classList.add('active');

    (function (value) {
      btn.addEventListener('click', function () {
        var current = seg.querySelector('.segmented-option.active');
        if (current && current.dataset.value === value) return;
        var options = seg.querySelectorAll('.segmented-option');
        for (var k = 0; k < options.length; k++) {
          var isActive = options[k].dataset.value === value;
          options[k].classList.toggle('active', isActive);
          options[k].setAttribute('aria-checked', String(isActive));
        }
        onChange(value);
      });
    })(modes[i].value);

    seg.appendChild(btn);
  }

  section.appendChild(seg);
  return section;
}

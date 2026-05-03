// tree.js — Left sidebar tree view. Renders a collapsible folder/file tree.

import { NODE_KIND } from '../constants.js';
import { makeLucideIcon } from './icon.js';

export function buildTree(node) {
  var ul = document.createElement('ul');
  ul.className = 'tree-list';

  var children = node.children || [];
  // Sort: directories first, then files, alphabetically within each group
  var sorted = children.slice().sort(function(a, b) {
    if (a.type === NODE_KIND.DIRECTORY && b.type !== NODE_KIND.DIRECTORY) return -1;
    if (a.type !== NODE_KIND.DIRECTORY && b.type === NODE_KIND.DIRECTORY) return 1;
    return (a.name || '').localeCompare(b.name || '');
  });

  for (var i = 0; i < sorted.length; i++) {
    var child = sorted[i];
    var li = document.createElement('li');
    li.className = 'tree-item';

    if (child.type === NODE_KIND.DIRECTORY) {
      li.classList.add('tree-dir');
      li.classList.add('tree-collapsed');

      var toggle = document.createElement('span');
      toggle.className = 'tree-toggle';

      // Chevron flips between right (collapsed) and down (expanded). Both
      // share the same icon span so we just swap the mask URL on toggle.
      var icon = makeLucideIcon('chevron-right', { class: 'tree-icon tree-icon-dir' });

      var label = document.createElement('span');
      label.className = 'tree-label';
      label.textContent = child.name || '';

      toggle.appendChild(icon);
      toggle.appendChild(label);
      li.appendChild(toggle);

      // Build subtree (hidden by default)
      var subtree = buildTree(child);
      subtree.style.display = 'none';
      li.appendChild(subtree);

      // Click handler for expand/collapse
      (function(toggleEl, subtreeEl, iconEl, liEl) {
        toggleEl.addEventListener('click', function(e) {
          e.stopPropagation();
          var isCollapsed = liEl.classList.contains('tree-collapsed');
          if (isCollapsed) {
            liEl.classList.remove('tree-collapsed');
            liEl.classList.add('tree-expanded');
            subtreeEl.style.display = '';
            _setIcon(iconEl, 'chevron-down');
          } else {
            liEl.classList.add('tree-collapsed');
            liEl.classList.remove('tree-expanded');
            subtreeEl.style.display = 'none';
            _setIcon(iconEl, 'chevron-right');
          }
        });
      })(toggle, subtree, icon, li);
    } else {
      // File leaf node — small file icon next to the name.
      li.classList.add('tree-file');

      var fileIcon = makeLucideIcon('file', { class: 'tree-icon tree-icon-file' });

      var fileLabel = document.createElement('span');
      fileLabel.className = 'tree-label';
      fileLabel.textContent = child.name || '';

      li.appendChild(fileIcon);
      li.appendChild(fileLabel);
    }

    ul.appendChild(li);
  }

  return ul;
}


// _setIcon(span, name) — swap the mask-image URL of an existing lucide-icon
// span so we don't have to rebuild the DOM node on every toggle.
function _setIcon(span, name) {
  var base = span.style.maskImage || span.style.webkitMaskImage;
  // Both URLs share the prefix up through ".../icons/"; swap the last segment.
  var u = base.replace(/[^/]+\.svg/, name + '.svg');
  span.style.maskImage = u;
  span.style.webkitMaskImage = u;
}


// buildTreePane(manifest) -> HTMLElement
//
// Returns the Tree tab's content as a single DOM element, ready to be
// inserted into the left sidebar's panel area. Owned by the parent shell
// (leftSidebar.js) — this function does not touch #tree-sidebar directly.
export function buildTreePane(manifest) {
  var pane = document.createElement('div');
  pane.className = 'left-pane tree-pane';

  var header = document.createElement('div');
  header.className = 'tree-header';

  var title = document.createElement('h3');
  title.className = 'tree-title';
  var tree = manifest.tree || manifest;
  title.textContent = tree.name || 'Project';
  header.appendChild(title);

  pane.appendChild(header);

  var treeEl = buildTree(tree);
  treeEl.className = 'tree-list tree-root';
  pane.appendChild(treeEl);

  return pane;
}

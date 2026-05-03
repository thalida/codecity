// tree.js — Left sidebar tree view. Renders a collapsible folder/file tree.

import { GLYPHS, UI_TEXT } from '../config/index.js';
import { NODE_KIND } from '../constants.js';

export function buildTree(node) {
  var ul = document.createElement('ul');
  ul.className = 'tree-list';
  var glyphs = GLYPHS.get();

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

      var icon = document.createElement('span');
      icon.className = 'tree-icon tree-icon-dir';
      icon.textContent = glyphs.TREE_COLLAPSED;

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
          var g = GLYPHS.get();
          var isCollapsed = liEl.classList.contains('tree-collapsed');
          if (isCollapsed) {
            liEl.classList.remove('tree-collapsed');
            liEl.classList.add('tree-expanded');
            subtreeEl.style.display = '';
            iconEl.textContent = g.TREE_EXPANDED;
          } else {
            liEl.classList.add('tree-collapsed');
            liEl.classList.remove('tree-expanded');
            subtreeEl.style.display = 'none';
            iconEl.textContent = g.TREE_COLLAPSED;
          }
        });
      })(toggle, subtree, icon, li);
    } else {
      // File leaf node
      li.classList.add('tree-file');

      var fileIcon = document.createElement('span');
      fileIcon.className = 'tree-icon tree-icon-file';
      fileIcon.textContent = glyphs.TREE_FILE;

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
  title.textContent = tree.name || UI_TEXT.get().DEFAULT_PROJECT_NAME;
  header.appendChild(title);

  pane.appendChild(header);

  var treeEl = buildTree(tree);
  treeEl.className = 'tree-list tree-root';
  pane.appendChild(treeEl);

  return pane;
}

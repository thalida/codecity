// info.js — "Info" tab in the left sidebar. Shows the rendered markdown
// of the project's root README (if any) — README.md, README.markdown,
// README, etc. Re-fetches and re-renders whenever the manifest is
// re-applied (which happens on live-update polling), so an edit to the
// README on disk shows up here without a page reload.

import { marked } from 'marked';
import { makeLucideIcon } from './icon.js';

// Match README, README.md, readme.markdown, README.txt — any file whose
// stem (case-insensitive) is "readme". GitHub/VSCode use the same rule.
function _findRootReadme(manifest) {
  var tree = (manifest && manifest.tree) || manifest;
  if (!tree || !tree.children) return null;
  for (var i = 0; i < tree.children.length; i++) {
    var c = tree.children[i];
    if (c.type !== 'file') continue;
    var name = (c.name || '').toLowerCase();
    if (name === 'readme' || name.indexOf('readme.') === 0) return c;
  }
  return null;
}

// buildInfoPane(manifest, opts) -> { pane, api }
//
// opts.onClose      — fn() when the user clicks the × in the header.
//
// api.setManifest(manifest) — caller pushes the latest manifest in (e.g.
//   on cityScene.onChange after a live-update rebuild). The pane re-runs
//   the README lookup; if the root README's path or fullPath changes, it
//   re-fetches and re-renders. If only the contents changed (same path),
//   we still re-fetch — the manifest signature already proved something
//   on disk moved.
export function buildInfoPane(manifest, opts) {
  opts = opts || {};
  var pane = document.createElement('div');
  pane.className = 'left-pane info-pane';

  var header = document.createElement('div');
  header.className = 'info-header pane-header';
  var title = document.createElement('h3');
  title.className = 'info-title';
  title.textContent = 'Info';
  header.appendChild(title);
  if (typeof opts.onClose === 'function') {
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'pane-header-close';
    closeBtn.title = 'Hide sidebar';
    closeBtn.setAttribute('aria-label', 'Hide sidebar');
    closeBtn.appendChild(makeLucideIcon('x'));
    closeBtn.addEventListener('click', function () { opts.onClose(); });
    header.appendChild(closeBtn);
  }
  pane.appendChild(header);

  var body = document.createElement('div');
  body.className = 'info-body';
  pane.appendChild(body);

  // Track the current fetch so a stale response from a previous manifest
  // can't overwrite the latest render. Each render() bumps reqId; the
  // fetch handler only commits if its captured id still matches.
  var reqId = 0;

  function _renderEmptyState() {
    body.replaceChildren();
    var box = document.createElement('div');
    box.className = 'preview-state';
    box.appendChild(makeLucideIcon('book-open'));
    var h = document.createElement('p');
    h.className = 'preview-state-title';
    h.textContent = 'No README';
    box.appendChild(h);
    var sub = document.createElement('p');
    sub.className = 'preview-state-sub';
    sub.textContent = 'Add a README at the project root to fill this panel.';
    box.appendChild(sub);
    body.appendChild(box);
  }

  function _renderError(message) {
    body.replaceChildren();
    var box = document.createElement('div');
    box.className = 'preview-state';
    box.appendChild(makeLucideIcon('file-warning'));
    var h = document.createElement('p');
    h.className = 'preview-state-title';
    h.textContent = 'Couldn’t load README';
    box.appendChild(h);
    if (message) {
      var sub = document.createElement('p');
      sub.className = 'preview-state-sub';
      sub.textContent = message;
      box.appendChild(sub);
    }
    body.appendChild(box);
  }

  function _renderMarkdown(text) {
    var article = document.createElement('article');
    article.className = 'info-markdown';
    // marked.parse is synchronous when given a string and produces a
    // self-contained HTML fragment (no <html>/<head> wrapper). The
    // sandbox is the local file's own contents — nothing the renderer
    // injects that the user didn't already have on disk — so we render
    // as-is.
    article.innerHTML = marked.parse(text);
    body.replaceChildren(article);
  }

  function render(currentManifest) {
    var readme = _findRootReadme(currentManifest);
    if (!readme || !readme.fullPath) {
      _renderEmptyState();
      return;
    }
    var myReq = ++reqId;
    var url = '/api/file?path=' + encodeURIComponent(readme.fullPath);
    fetch(url).then(function (resp) {
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return resp.text();
    }).then(function (text) {
      if (myReq !== reqId) return;          // stale — newer render in flight
      _renderMarkdown(text);
    }).catch(function (err) {
      if (myReq !== reqId) return;
      _renderError((err && err.message) || 'Unknown error');
    });
  }

  render(manifest);

  return {
    pane: pane,
    api: {
      setManifest: function (m) { render(m); }
    }
  };
}

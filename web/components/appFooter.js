// appFooter.js — Sitewide bottom status bar. Shows the current
// selection's metadata (language · lines · size · created · modified
// for files; file/dir counts + size for directories). Empty when there
// is no selection.

/**
 * Initialise the sitewide footer. Returns a tiny API:
 *   setSelection({ ... }) — render the footer for a file or directory
 *                           selection. Pass null to clear it.
 *
 * sel shape (file):
 *   { kind:'file', language, lines, size, modified, created, dateSource }
 * sel shape (directory):
 *   { kind:'directory', files, dirs, size }
 */
export function initAppFooter() {
  var footer = document.getElementById('app-footer');
  if (!footer) return { setSelection: function () {} };

  function setSelection(sel) {
    footer.replaceChildren();
    if (!sel) return;

    if (sel.kind === 'file') {
      if (sel.language)         footer.appendChild(_item(sel.language));
      if (sel.lines != null)    footer.appendChild(_item(sel.lines + ' lines'));
      if (sel.size != null)     footer.appendChild(_item(_formatBytes(sel.size)));
      if (sel.modified)         footer.appendChild(_item('modified ' + _formatDate(sel.modified), sel.dateSource));
      if (sel.created)          footer.appendChild(_item('created '  + _formatDate(sel.created),  sel.dateSource));
    } else if (sel.kind === 'directory') {
      footer.appendChild(_item('Directory'));
      if (sel.files != null)    footer.appendChild(_item(sel.files + ' files'));
      if (sel.dirs  != null)    footer.appendChild(_item(sel.dirs  + ' dirs'));
      if (sel.size  != null)    footer.appendChild(_item(_formatBytes(sel.size)));
    }
  }

  return { setSelection: setSelection };
}

function _item(text, source) {
  var span = document.createElement('span');
  span.className = 'app-footer-item';
  span.textContent = text;
  if (source) {
    var src = document.createElement('span');
    src.className = 'app-footer-source';
    src.textContent = '(' + source + ')';
    span.appendChild(src);
  }
  return span;
}

var BYTES_PER_KB = 1024;
var BYTES_PER_MB = 1024 * 1024;
function _formatBytes(bytes) {
  if (bytes < BYTES_PER_KB) return bytes + ' B';
  if (bytes < BYTES_PER_MB) return (bytes / BYTES_PER_KB).toFixed(1) + ' KB';
  return (bytes / BYTES_PER_MB).toFixed(1) + ' MB';
}

var DATE_FORMAT_OPTIONS = { year: 'numeric', month: 'short', day: 'numeric' };
function _formatDate(isoString) {
  if (!isoString) return '—';
  var d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;
  return d.toLocaleDateString('en-US', DATE_FORMAT_OPTIONS);
}

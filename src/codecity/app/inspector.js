// src/codecity/app/inspector.js

export class Inspector {
    constructor() {
        this.panel = document.getElementById('inspector');
        this.closeBtn = document.getElementById('inspector-close');
        this.openEditorBtn = document.getElementById('btn-open-editor');
        this.viewRemoteBtn = document.getElementById('btn-view-remote');

        this.currentBuilding = null;
        this.editorUrl = null;
        this.remoteUrl = null;

        this.setupEventListeners();
    }

    setupEventListeners() {
        this.closeBtn.addEventListener('click', () => this.hide());

        this.openEditorBtn.addEventListener('click', () => {
            if (this.editorUrl) {
                window.open(this.editorUrl, '_blank');
            }
        });

        this.viewRemoteBtn.addEventListener('click', () => {
            if (this.remoteUrl) {
                window.open(this.remoteUrl, '_blank');
            }
        });
    }

    show(building) {
        this.currentBuilding = building;

        // Update content
        document.getElementById('inspector-title').textContent = building.file_path.split('/').pop();
        document.getElementById('inspector-path').textContent = building.file_path;
        document.getElementById('inspector-loc').textContent = Math.round(building.height * 10);
        document.getElementById('inspector-avg-line').textContent = (building.width * 5).toFixed(1);
        document.getElementById('inspector-language').textContent = building.language;
        document.getElementById('inspector-created').textContent = this.formatDate(building.created_at);
        document.getElementById('inspector-modified').textContent = this.formatDate(building.last_modified);

        // Get repo path from URL
        const params = new URLSearchParams(window.location.search);
        const repoPath = params.get('repo') || '.';

        // Set editor URL (VS Code by default)
        const fullPath = `${repoPath}/${building.file_path}`;
        this.editorUrl = `vscode://file/${fullPath}:1`;

        // Remote URL would be set from API response
        this.remoteUrl = null;
        this.viewRemoteBtn.style.display = this.remoteUrl ? 'block' : 'none';

        // Show panel
        this.panel.classList.remove('hidden');
    }

    hide() {
        this.panel.classList.add('hidden');
        this.currentBuilding = null;
    }

    formatDate(isoString) {
        const date = new Date(isoString);
        return date.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        });
    }
}

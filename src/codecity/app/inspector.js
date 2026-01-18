// src/codecity/app/inspector.js

export class Inspector {
    constructor() {
        this.panel = document.getElementById('inspector');
        this.closeBtn = document.getElementById('inspector-close');

        this.currentBuilding = null;
        this.editorUrl = null;
        this.remoteUrl = null;

        this.setupEventListeners();
    }

    setupEventListeners() {
        this.closeBtn.addEventListener('click', () => this.hide());
    }

    show(building) {
        this.currentBuilding = building;

        // Update content
        document.getElementById('inspector-path').textContent = building.file_path;
        document.getElementById('inspector-language').textContent = building.language;

        // Lines of code (height * 10 reverses the /10 scaling in city-renderer)
        document.getElementById('inspector-lines').textContent = Math.round(building.height);

        // Complexity (if available, otherwise show dash)
        const complexityEl = document.getElementById('inspector-complexity');
        if (complexityEl) {
            complexityEl.textContent = building.complexity || '-';
        }

        // Functions count (if available)
        const functionsEl = document.getElementById('inspector-functions');
        if (functionsEl) {
            functionsEl.textContent = building.functions ?? '-';
        }

        // Classes count (if available)
        const classesEl = document.getElementById('inspector-classes');
        if (classesEl) {
            classesEl.textContent = building.classes ?? '-';
        }

        // Imports count (if available)
        const importsEl = document.getElementById('inspector-imports');
        if (importsEl) {
            importsEl.textContent = building.imports ?? '-';
        }

        // Get repo path from URL
        const params = new URLSearchParams(window.location.search);
        const repoPath = params.get('repo') || '.';

        // Set editor URL (VS Code by default)
        const fullPath = `${repoPath}/${building.file_path}`;
        this.editorUrl = `vscode://file/${fullPath}:1`;

        // Remote URL would be set from API response
        this.remoteUrl = null;

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

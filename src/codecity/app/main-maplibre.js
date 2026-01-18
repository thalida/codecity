// CodeCity MapLibre Entry Point

import { CityMap } from './city-map.js';

/**
 * Initialize the CodeCity map application
 */
async function init() {
    const loadingOverlay = document.getElementById('loading-overlay');
    const inspector = document.getElementById('inspector');
    const inspectorClose = document.getElementById('inspector-close');
    const inspectorTitle = document.getElementById('inspector-title');
    const inspectorContent = document.getElementById('inspector-content');
    const tooltip = document.getElementById('tooltip');

    // Get repo path from URL if provided
    const urlParams = new URLSearchParams(window.location.search);
    const repoPath = urlParams.get('repo');

    // Build API URL
    const apiUrl = repoPath
        ? `/api/city.geojson?repo_path=${encodeURIComponent(repoPath)}`
        : '/api/city.geojson';

    try {
        // Initialize map
        const cityMap = new CityMap(document.getElementById('map-container'), {
            theme: 'default'
        });

        await cityMap.init(apiUrl);

        // Hide loading overlay
        loadingOverlay.classList.add('hidden');

        // Setup building click handler
        cityMap.map.on('click', 'buildings', (e) => {
            if (e.features && e.features.length > 0) {
                const feature = e.features[0];
                const props = feature.properties;

                inspectorTitle.textContent = props.name || 'File Info';
                inspectorContent.innerHTML = `
                    <div class="field">
                        <div class="label">Path</div>
                        <div class="value">${props.path || ''}</div>
                    </div>
                    <div class="field">
                        <div class="label">Language</div>
                        <div class="value">${props.language || 'Unknown'}</div>
                    </div>
                    <div class="field">
                        <div class="label">Lines of Code</div>
                        <div class="value">${props.lines_of_code || 0}</div>
                    </div>
                    <div class="field">
                        <div class="label">Avg Line Length</div>
                        <div class="value">${(props.avg_line_length || 0).toFixed(1)}</div>
                    </div>
                    <div class="field">
                        <div class="label">Created</div>
                        <div class="value">${props.created_at || ''}</div>
                    </div>
                    <div class="field">
                        <div class="label">Last Modified</div>
                        <div class="value">${props.last_modified || ''}</div>
                    </div>
                `;
                inspector.classList.remove('hidden');
            }
        });

        // Setup building hover for tooltip
        cityMap.map.on('mouseenter', 'buildings', (e) => {
            cityMap.map.getCanvas().style.cursor = 'pointer';

            if (e.features && e.features.length > 0) {
                const props = e.features[0].properties;
                tooltip.textContent = props.name || props.path || '';
                tooltip.classList.remove('hidden');
            }
        });

        cityMap.map.on('mousemove', 'buildings', (e) => {
            tooltip.style.left = `${e.originalEvent.clientX + 10}px`;
            tooltip.style.top = `${e.originalEvent.clientY + 10}px`;
        });

        cityMap.map.on('mouseleave', 'buildings', () => {
            cityMap.map.getCanvas().style.cursor = '';
            tooltip.classList.add('hidden');
        });

        // Setup inspector close
        inspectorClose.addEventListener('click', () => {
            inspector.classList.add('hidden');
        });

        // Close inspector on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                inspector.classList.add('hidden');
            }
        });

    } catch (error) {
        console.error('Failed to initialize city map:', error);
        loadingOverlay.querySelector('p').textContent = 'Failed to load city';
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);

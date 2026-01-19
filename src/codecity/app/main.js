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

                // Get all tiers for this building
                const tiers = cityMap.getBuildingTiers(props.path);
                const numTiers = tiers.length;
                const totalHeight = numTiers > 0 ? tiers[numTiers - 1].topHeight : 0;

                inspectorTitle.textContent = props.name || 'File Info';

                let html = `
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
                        <div class="value">${(props.lines_of_code || 0).toLocaleString()}</div>
                    </div>
                    <div class="field">
                        <div class="label">Avg Line Length</div>
                        <div class="value">${(props.avg_line_length || 0).toFixed(1)}</div>
                    </div>
                    <div class="field">
                        <div class="label">Total Height</div>
                        <div class="value">${totalHeight.toFixed(1)}</div>
                    </div>
                    <div class="field">
                        <div class="label">Number of Tiers</div>
                        <div class="value">${numTiers}</div>
                    </div>
                `;

                // Show tier details (dimensions for each tier)
                if (numTiers >= 1) {
                    html += `
                        <div class="field tier-details">
                            <div class="label">Tier Dimensions</div>
                            <table class="tier-table">
                                <thead>
                                    <tr>
                                        <th>Tier</th>
                                        <th>Height</th>
                                        <th>Width</th>
                                    </tr>
                                </thead>
                                <tbody>
                    `;
                    for (const tier of tiers) {
                        const tierHeight = tier.topHeight - tier.baseHeight;
                        html += `
                                    <tr>
                                        <td>${tier.tier + 1}</td>
                                        <td>${tierHeight.toFixed(1)}</td>
                                        <td>${tier.width.toFixed(1)}</td>
                                    </tr>
                        `;
                    }
                    html += `
                                </tbody>
                            </table>
                        </div>
                    `;
                }

                html += `
                    <div class="field">
                        <div class="label">Created</div>
                        <div class="value">${props.created_at || ''}</div>
                    </div>
                    <div class="field">
                        <div class="label">Last Modified</div>
                        <div class="value">${props.last_modified || ''}</div>
                    </div>
                `;

                inspectorContent.innerHTML = html;
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

        // Setup street click handler
        cityMap.map.on('click', 'streets', (e) => {
            if (e.features && e.features.length > 0) {
                const props = e.features[0].properties;
                // Skip unnamed connector streets
                if (!props.name) return;

                inspectorTitle.textContent = props.name || 'Street';
                inspectorContent.innerHTML = `
                    <div class="field">
                        <div class="label">Full Path</div>
                        <div class="value">${props.path || ''}</div>
                    </div>
                    <div class="field">
                        <div class="label">Files in Folder</div>
                        <div class="value">${props.file_count || 0}</div>
                    </div>
                    <div class="field">
                        <div class="label">Total Descendants</div>
                        <div class="value">${props.descendant_count || 0}</div>
                    </div>
                    <div class="field">
                        <div class="label">Road Class</div>
                        <div class="value">${props.road_class || ''}</div>
                    </div>
                `;
                inspector.classList.remove('hidden');
            }
        });

        // Setup street hover for cursor
        cityMap.map.on('mouseenter', 'streets', (e) => {
            if (e.features && e.features[0].properties.name) {
                cityMap.map.getCanvas().style.cursor = 'pointer';
            }
        });

        cityMap.map.on('mouseleave', 'streets', () => {
            cityMap.map.getCanvas().style.cursor = '';
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

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Inspector } from '../inspector.js';

describe('Inspector', () => {
    let mockPanel;
    let mockCloseBtn;
    let mockOpenEditorBtn;
    let mockViewRemoteBtn;
    let mockElements;
    let inspector;

    beforeEach(() => {
        mockPanel = {
            classList: {
                add: vi.fn(),
                remove: vi.fn(),
            },
        };

        mockCloseBtn = {
            addEventListener: vi.fn(),
        };

        mockOpenEditorBtn = {
            addEventListener: vi.fn(),
        };

        mockViewRemoteBtn = {
            addEventListener: vi.fn(),
            style: { display: '' },
        };

        mockElements = {
            'inspector': mockPanel,
            'inspector-close': mockCloseBtn,
            'btn-open-editor': mockOpenEditorBtn,
            'btn-view-remote': mockViewRemoteBtn,
            'inspector-title': { textContent: '' },
            'inspector-path': { textContent: '' },
            'inspector-loc': { textContent: '' },
            'inspector-avg-line': { textContent: '' },
            'inspector-language': { textContent: '' },
            'inspector-created': { textContent: '' },
            'inspector-modified': { textContent: '' },
        };

        document.getElementById = vi.fn((id) => mockElements[id] || null);

        Object.defineProperty(window, 'location', {
            value: {
                protocol: 'http:',
                host: 'localhost:8000',
                search: '',
            },
            writable: true,
        });

        window.open = vi.fn();

        inspector = new Inspector();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('constructor', () => {
        it('gets panel element by ID', () => {
            expect(document.getElementById).toHaveBeenCalledWith('inspector');
        });

        it('gets close button by ID', () => {
            expect(document.getElementById).toHaveBeenCalledWith('inspector-close');
        });

        it('gets open editor button by ID', () => {
            expect(document.getElementById).toHaveBeenCalledWith('btn-open-editor');
        });

        it('gets view remote button by ID', () => {
            expect(document.getElementById).toHaveBeenCalledWith('btn-view-remote');
        });

        it('initializes currentBuilding as null', () => {
            expect(inspector.currentBuilding).toBeNull();
        });

        it('initializes editorUrl as null', () => {
            expect(inspector.editorUrl).toBeNull();
        });

        it('initializes remoteUrl as null', () => {
            expect(inspector.remoteUrl).toBeNull();
        });
    });

    describe('setupEventListeners', () => {
        it('adds click listener to close button', () => {
            expect(mockCloseBtn.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
        });

        it('adds click listener to open editor button', () => {
            expect(mockOpenEditorBtn.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
        });

        it('adds click listener to view remote button', () => {
            expect(mockViewRemoteBtn.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
        });

        it('close button calls hide()', () => {
            const hideSpy = vi.spyOn(inspector, 'hide');
            const clickHandler = mockCloseBtn.addEventListener.mock.calls[0][1];
            clickHandler();
            expect(hideSpy).toHaveBeenCalled();
        });

        it('open editor button opens editorUrl if set', () => {
            inspector.editorUrl = 'vscode://file/test.py:1';
            const clickHandler = mockOpenEditorBtn.addEventListener.mock.calls[0][1];
            clickHandler();
            expect(window.open).toHaveBeenCalledWith('vscode://file/test.py:1', '_blank');
        });

        it('open editor button does nothing if editorUrl not set', () => {
            inspector.editorUrl = null;
            const clickHandler = mockOpenEditorBtn.addEventListener.mock.calls[0][1];
            clickHandler();
            expect(window.open).not.toHaveBeenCalled();
        });

        it('view remote button opens remoteUrl if set', () => {
            inspector.remoteUrl = 'https://github.com/user/repo/blob/main/test.py';
            const clickHandler = mockViewRemoteBtn.addEventListener.mock.calls[0][1];
            clickHandler();
            expect(window.open).toHaveBeenCalledWith('https://github.com/user/repo/blob/main/test.py', '_blank');
        });

        it('view remote button does nothing if remoteUrl not set', () => {
            inspector.remoteUrl = null;
            const clickHandler = mockViewRemoteBtn.addEventListener.mock.calls[0][1];
            clickHandler();
            expect(window.open).not.toHaveBeenCalled();
        });
    });

    describe('show', () => {
        const mockBuilding = {
            file_path: 'src/utils/helpers.py',
            height: 10,  // Scaled from LOC: will display as height * 10 = 100
            width: 8,    // Scaled from avg line: will display as width * 5 = 40.0
            language: 'python',
            created_at: '2024-01-15T10:30:00Z',
            last_modified: '2024-06-20T14:45:00Z',
        };

        it('stores building as currentBuilding', () => {
            inspector.show(mockBuilding);
            expect(inspector.currentBuilding).toBe(mockBuilding);
        });

        it('sets inspector title to filename', () => {
            inspector.show(mockBuilding);
            expect(mockElements['inspector-title'].textContent).toBe('helpers.py');
        });

        it('extracts filename from nested path', () => {
            inspector.show({ ...mockBuilding, file_path: 'a/b/c/d/deep.js' });
            expect(mockElements['inspector-title'].textContent).toBe('deep.js');
        });

        it('handles simple filename (no path)', () => {
            inspector.show({ ...mockBuilding, file_path: 'simple.py' });
            expect(mockElements['inspector-title'].textContent).toBe('simple.py');
        });

        it('sets inspector path to full file path', () => {
            inspector.show(mockBuilding);
            expect(mockElements['inspector-path'].textContent).toBe('src/utils/helpers.py');
        });

        it('sets LOC by scaling height back', () => {
            inspector.show(mockBuilding);
            // LOC = Math.round(height * 10) = Math.round(10 * 10) = 100
            expect(mockElements['inspector-loc'].textContent).toBe(100);
        });

        it('sets average line length by scaling width back', () => {
            inspector.show(mockBuilding);
            // avg line = (width * 5).toFixed(1) = (8 * 5).toFixed(1) = "40.0"
            expect(mockElements['inspector-avg-line'].textContent).toBe('40.0');
        });

        it('sets language', () => {
            inspector.show(mockBuilding);
            expect(mockElements['inspector-language'].textContent).toBe('python');
        });

        it('formats and sets created date', () => {
            inspector.show(mockBuilding);
            // Date formatting depends on locale, just check it's not empty
            expect(mockElements['inspector-created'].textContent).not.toBe('');
        });

        it('formats and sets modified date', () => {
            inspector.show(mockBuilding);
            expect(mockElements['inspector-modified'].textContent).not.toBe('');
        });

        it('generates VS Code editor URL', () => {
            inspector.show(mockBuilding);
            expect(inspector.editorUrl).toBe('vscode://file/./src/utils/helpers.py:1');
        });

        it('includes repo path in editor URL when provided', () => {
            window.location.search = '?repo=/home/user/project';
            // Recreate inspector to pick up new location
            inspector = new Inspector();
            inspector.show(mockBuilding);
            expect(inspector.editorUrl).toBe('vscode://file//home/user/project/src/utils/helpers.py:1');
        });

        it('sets remoteUrl to null (no remote configured)', () => {
            inspector.show(mockBuilding);
            expect(inspector.remoteUrl).toBeNull();
        });

        it('hides remote button when no remote URL', () => {
            inspector.show(mockBuilding);
            expect(mockViewRemoteBtn.style.display).toBe('none');
        });

        it('removes hidden class from panel', () => {
            inspector.show(mockBuilding);
            expect(mockPanel.classList.remove).toHaveBeenCalledWith('hidden');
        });
    });

    describe('hide', () => {
        it('adds hidden class to panel', () => {
            inspector.hide();
            expect(mockPanel.classList.add).toHaveBeenCalledWith('hidden');
        });

        it('clears currentBuilding', () => {
            inspector.currentBuilding = { file_path: 'test.py' };
            inspector.hide();
            expect(inspector.currentBuilding).toBeNull();
        });
    });

    describe('formatDate', () => {
        it('formats ISO date string', () => {
            const result = inspector.formatDate('2024-01-15T10:30:00Z');
            // Result depends on locale, just check it's a non-empty string
            expect(typeof result).toBe('string');
            expect(result.length).toBeGreaterThan(0);
        });

        it('includes year in formatted date', () => {
            const result = inspector.formatDate('2024-01-15T10:30:00Z');
            expect(result).toContain('2024');
        });

        it('handles different date formats', () => {
            // ISO format
            const result1 = inspector.formatDate('2024-06-20T14:45:00Z');
            expect(result1).toContain('2024');

            // Another date
            const result2 = inspector.formatDate('2023-12-31T23:59:59Z');
            expect(result2).toContain('2023');
        });
    });

    describe('edge cases', () => {
        it('handles very long file paths', () => {
            const longPath = 'a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q/r/s/t/u/v/w/x/y/z/file.py';
            const building = {
                file_path: longPath,
                height: 10,
                width: 8,
                language: 'python',
                created_at: '2024-01-15T10:30:00Z',
                last_modified: '2024-06-20T14:45:00Z',
            };

            inspector.show(building);
            expect(mockElements['inspector-title'].textContent).toBe('file.py');
            expect(mockElements['inspector-path'].textContent).toBe(longPath);
        });

        it('handles buildings with zero height', () => {
            const building = {
                file_path: 'empty.py',
                height: 0,
                width: 8,
                language: 'python',
                created_at: '2024-01-15T10:30:00Z',
                last_modified: '2024-06-20T14:45:00Z',
            };

            inspector.show(building);
            expect(mockElements['inspector-loc'].textContent).toBe(0);
        });

        it('handles buildings with zero width', () => {
            const building = {
                file_path: 'narrow.py',
                height: 10,
                width: 0,
                language: 'python',
                created_at: '2024-01-15T10:30:00Z',
                last_modified: '2024-06-20T14:45:00Z',
            };

            inspector.show(building);
            expect(mockElements['inspector-avg-line'].textContent).toBe('0.0');
        });

        it('handles unknown language', () => {
            const building = {
                file_path: 'mystery.xyz',
                height: 10,
                width: 8,
                language: 'unknown',
                created_at: '2024-01-15T10:30:00Z',
                last_modified: '2024-06-20T14:45:00Z',
            };

            inspector.show(building);
            expect(mockElements['inspector-language'].textContent).toBe('unknown');
        });

        it('handles special characters in file path', () => {
            const building = {
                file_path: 'src/my file (1).py',
                height: 10,
                width: 8,
                language: 'python',
                created_at: '2024-01-15T10:30:00Z',
                last_modified: '2024-06-20T14:45:00Z',
            };

            inspector.show(building);
            expect(mockElements['inspector-title'].textContent).toBe('my file (1).py');
        });
    });
});

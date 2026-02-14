/**
 * Global Navigation Component
 * Injects a navigation bar into the page and handles active state.
 */

class GlobalNav {
    constructor() {
        this.basePath = this.determineBasePath();
        this.init();
    }

    determineBasePath() {
        // Use import.meta.url to find the script's location
        // The script is in /js/global-nav.js, so the root is ../
        const scriptUrl = new URL(import.meta.url);
        // Go up one level from /js/ to get root
        return new URL('../', scriptUrl).href;
    }

    init() {
        // Create Nav Element
        const nav = document.createElement('nav');
        nav.className = 'global-nav';
        nav.innerHTML = `
            <div class="global-nav-container">
                <a href="${this.basePath}index.html" class="global-nav-logo">
                    <div class="logo-icon">🥟</div>
                    <div class="logo-text">Dim Sum Ma</div>
                </a>
                
                <div class="nav-tray">
                    <ul class="global-nav-links">
                        <li class="global-nav-item">
                            <a href="${this.basePath}index.html" class="global-nav-link" data-page="home">
                                <span class="global-nav-icon">🏠</span>
                                <span class="link-label">Home</span>
                            </a>
                        </li>
                        <li class="global-nav-item">
                            <a href="${this.basePath}games/canto-feud/index.html" class="global-nav-link" data-page="canto-feud">
                                <span class="global-nav-icon">🎤</span>
                                <span class="link-label">Canto Feud</span>
                            </a>
                        </li>
                    </ul>
                </div>

                <div class="global-nav-actions">
                    <!-- Settings Dropdown -->
                    <div class="settings-dropdown-container">
                        <button class="settings-toggle-btn" id="settings-toggle" aria-label="Settings">
                            <svg class="settings-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="3"></circle>
                                <path d="M12 1v6m0 6v6m5.196-13.196l-4.242 4.242m-2.828 2.828l-4.242 4.242M23 12h-6m-6 0H1m18.196 5.196l-4.242-4.242m-2.828-2.828l-4.242-4.242"></path>
                            </svg>
                        </button>
                        <div class="settings-dropdown" id="settings-dropdown">
                            <div class="settings-dropdown-header">
                                <span class="settings-title">⚙️ Game Settings</span>
                            </div>
                            <div class="settings-dropdown-content">
                                <!-- Speed Toggle -->
                                <div class="setting-item">
                                    <span class="setting-label">🐰 Rabbit Mode</span>
                                    <label class="switch">
                                        <input type="checkbox" id="speed-switch">
                                        <span class="slider round slider-green"></span>
                                    </label>
                                </div>
                                <!-- Voice Selection -->
                                <div class="setting-item">
                                    <span class="setting-label">🗣️ Voice</span>
                                    <select id="voice-select" class="voice-select">
                                        <option value="auto">Auto (Default)</option>
                                    </select>
                                </div>
                                <!-- Auto Answer Toggle -->
                                <div class="setting-item">
                                    <span class="setting-label">🗣️ Auto Answer</span>
                                    <label class="switch">
                                        <input type="checkbox" id="global-auto-answer">
                                        <span class="slider round"></span>
                                    </label>
                                </div>
                                <!-- Tiger Mom Toggle -->
                                <div class="setting-item">
                                    <span class="setting-label">🐯 Tiger Mom</span>
                                    <label class="switch">
                                        <input type="checkbox" id="tiger-switch">
                                        <span class="slider round slider-red"></span>
                                    </label>
                                </div>
                                <!-- Waveform Toggle -->
                                <div class="setting-item">
                                    <span class="setting-label">🌊 Show Waves</span>
                                    <label class="switch">
                                        <input type="checkbox" id="waveform-switch">
                                        <span class="slider round slider-primary"></span>
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Prepend to body
        document.body.prepend(nav);

        // Highlight active link
        this.highlightActiveLink();

        // Init Settings Dropdown
        this.initSettingsDropdown();

        // Init All Settings
        this.initAutoAnswer();
        this.initSpeedToggle();
        this.initVoiceSelect();
        this.initTigerToggle();
        this.initWaveformToggle();
    }

    initAutoAnswer() {
        const toggle = document.getElementById('global-auto-answer');
        if (!toggle) return;

        // Restore state
        const savedState = localStorage.getItem('dimsum_auto_answer') === 'true';
        toggle.checked = savedState;

        // Handle Change
        toggle.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            localStorage.setItem('dimsum_auto_answer', isChecked);

            // Dispatch event for games to listen to
            window.dispatchEvent(new CustomEvent('auto-answer-changed', {
                detail: { enabled: isChecked }
            }));
        });
    }

    highlightActiveLink() {
        const currentPath = window.location.pathname;
        let activePage = 'home';

        if (currentPath.includes('games/canto-feud')) {
            activePage = 'canto-feud';
        } else if (currentPath.includes('games/panda-palace')) {
            activePage = 'panda-palace';
        }

        const activeLink = document.querySelector(`.global-nav-link[data-page="${activePage}"]`);
        if (activeLink) {
            activeLink.classList.add('active');
        }
    }

    initSettingsDropdown() {
        const toggleBtn = document.getElementById('settings-toggle');
        const dropdown = document.getElementById('settings-dropdown');

        if (!toggleBtn || !dropdown) return;

        // Toggle dropdown
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('open');
            toggleBtn.classList.toggle('active');
        });

        // Close on click outside
        document.addEventListener('click', (e) => {
            if (!dropdown.contains(e.target) && !toggleBtn.contains(e.target)) {
                dropdown.classList.remove('open');
                toggleBtn.classList.remove('active');
            }
        });
    }

    initSpeedToggle() {
        const toggle = document.getElementById('speed-switch');
        if (!toggle) return;

        const savedState = localStorage.getItem('dimsum_speed_mode') === 'true';
        toggle.checked = savedState;

        toggle.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            localStorage.setItem('dimsum_speed_mode', isChecked);
            window.dispatchEvent(new CustomEvent('speed-mode-changed', {
                detail: { enabled: isChecked }
            }));
        });
    }

    initVoiceSelect() {
        const select = document.getElementById('voice-select');
        if (!select) return;

        const savedVoice = localStorage.getItem('dimsum_voice_preference') || 'auto';
        select.value = savedVoice;

        select.addEventListener('change', (e) => {
            const voice = e.target.value;
            localStorage.setItem('dimsum_voice_preference', voice);
            window.dispatchEvent(new CustomEvent('voice-changed', {
                detail: { voice }
            }));
        });
    }

    initTigerToggle() {
        const toggle = document.getElementById('tiger-switch');
        if (!toggle) return;

        const savedState = localStorage.getItem('dimsum_tiger_mode') === 'true';
        toggle.checked = savedState;

        toggle.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            localStorage.setItem('dimsum_tiger_mode', isChecked);
            window.dispatchEvent(new CustomEvent('tiger-mode-changed', {
                detail: { enabled: isChecked }
            }));
        });
    }

    initWaveformToggle() {
        const toggle = document.getElementById('waveform-switch');
        if (!toggle) return;

        const savedState = localStorage.getItem('dimsum_waveform') === 'true';
        toggle.checked = savedState;

        toggle.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            localStorage.setItem('dimsum_waveform', isChecked);
            window.dispatchEvent(new CustomEvent('waveform-changed', {
                detail: { enabled: isChecked }
            }));
        });
    }
}

// Initialize on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new GlobalNav());
} else {
    new GlobalNav();
}

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
                    <!-- Placeholder for future actions like user profile or settings -->
                </div>
            </div>
        `;

        // Prepend to body
        document.body.prepend(nav);

        // Highlight active link
        this.highlightActiveLink();

        // Init Auto Answer
        this.initAutoAnswer();
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
}

// Initialize on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new GlobalNav());
} else {
    new GlobalNav();
}

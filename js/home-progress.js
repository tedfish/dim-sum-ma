// Home Progress Dashboard
// Displays user's learning progress from localStorage

const DIFFICULTY_LABELS = {
    0: "Just A Baby 👶",
    1: "Learning Manners 🍵",
    2: "Ordering For Family 🥢",
    3: "No More Embarrassment 😳",
    4: "Getting A Discount 💸",
    5: "Impressing Aunties 🥟",
    6: "Marriage Material 💍",
    7: "Family Pride 🦁",
    8: "Mom's Favorite ❤️",
    9: "Better Than Cousin 🏆",
    10: "Ancestors Smiling ✨"
};

function loadProgressData() {
    const saved = localStorage.getItem('dimSumData');
    if (!saved) {
        return null;
    }

    try {
        return JSON.parse(saved);
    } catch (e) {
        console.error("Failed to load progress data:", e);
        return null;
    }
}

function renderProgressDashboard() {
    const container = document.getElementById('progress-dashboard');
    if (!container) return;

    const data = loadProgressData();

    if (!data || data.totalScore === 0) {
        // Show "Get Started" state
        container.innerHTML = `
            <div class="progress-empty-state">
                <div class="empty-icon">🥟</div>
                <h3>Start Your Journey!</h3>
                <p>Begin playing to track your progress</p>
                <a href="games/canto-feud/index.html" class="cta-button">Play Canto Feud</a>
            </div>
        `;
        return;
    }

    // Extract stats
    const totalScore = data.totalScore || 0;
    const currentLevel = data.currentLevel || 0;
    const playedRounds = data.playedRounds || [];
    const dumplingDollars = data.dumplingDollars || 0;
    const questionHistory = data.questionHistory || {};

    // Calculate derived stats
    const totalAttempts = Object.values(questionHistory).reduce((sum, attempts) => sum + attempts.length, 0);
    const levelLabel = DIFFICULTY_LABELS[currentLevel] || `Level ${currentLevel}`;

    // Render dashboard
    container.innerHTML = `
        <div class="progress-header">
            <h2>Your Learning Progress</h2>
        </div>
        
        <div class="progress-stats-grid">
            <div class="stat-card score-card">
                <div class="stat-icon">🏆</div>
                <div class="stat-content">
                    <div class="stat-value">${totalScore.toLocaleString()}</div>
                    <div class="stat-label">Total Score</div>
                </div>
            </div>
            
            <div class="stat-card level-card">
                <div class="stat-icon">📊</div>
                <div class="stat-content">
                    <div class="stat-value">${currentLevel}</div>
                    <div class="stat-label">${levelLabel}</div>
                </div>
            </div>
            
            <div class="stat-card rounds-card">
                <div class="stat-icon">✅</div>
                <div class="stat-content">
                    <div class="stat-value">${playedRounds.length}</div>
                    <div class="stat-label">Rounds Completed</div>
                </div>
            </div>
            
            <div class="stat-card currency-card">
                <div class="stat-icon">💰</div>
                <div class="stat-content">
                    <div class="stat-value">${dumplingDollars}</div>
                    <div class="stat-label">Dumpling Dollars</div>
                </div>
            </div>
        </div>
        
        <div class="progress-actions">
            <a href="games/canto-feud/index.html" class="action-btn primary">
                <span class="btn-icon">🎤</span>
                <span>Continue Playing</span>
            </a>
            <a href="games/canto-feud/index.html#shop" class="action-btn secondary">
                <span class="btn-icon">🛒</span>
                <span>Visit Shop</span>
            </a>
        </div>
    `;
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    renderProgressDashboard();
});

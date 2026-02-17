import { gameData } from './chapters.js';
import { ITEMS, ITEM_ASSETS } from './items.js';
import { pinyinMap, toPhoneticEnglish, comparePronunciation, convertToPinyin, getToneAndBase, calculateGradingMetrics } from './pinyinHelper.js';
import { TTS_CONFIG } from './tts-config.js';

// State
let currentRound = null;
let totalScore = 0;
let currentRoundScore = 0; // Track score just for this round
let currentLevel = 0; // The difficulty level (0-10)
let revealedAnswers = []; // IDs of answers "completed"
let questionHistory = {}; // Track all attempts: { questionKey: [{ timestamp, score, userInput, grade }] }
let isListening = false;
let recognition = null;
let synthesis = window.speechSynthesis;
let voices = [];
let finalVoice = null;
let selectedVoiceURI = 'auto'; // Default to auto
let speechRate = 1.0; // Default: Rabbit Mode (Normal)
let audioContext = null;
let analyser = null;
let dataArray = null;
let animationId = null;
let waveformCanvas = null;
let waveformCtx = null;
let waveformEnabled = true;
let micStream = null;
let volumeSmoothed = 0; // For visibility smoothing

// DOM Elements
const chapterNav = document.getElementById('chapter-nav');
const scoreDisplays = document.querySelectorAll('.total-score-display');
const roundScoreDisplay = document.getElementById('current-round-display');
const gameBoard = document.getElementById('game-board');
const questionText = document.getElementById('question-text');
const questionSub = document.getElementById('question-sub');
let micBtn = document.getElementById('mic-btn');


const statusText = document.getElementById('status-text');
const liveSubtitle = document.getElementById('live-subtitle');
const liveSubtitleText = document.getElementById('live-subtitle-text');
const avatarMouth = document.getElementById('mouth');
const avatarBubble = document.getElementById('avatar-bubble');
const avatarContainer = document.querySelector('.avatar-container');
// Language switching removed - Cantonese only
const manualInput = document.getElementById('manual-input');
const voiceSelect = document.getElementById('voice-select');

// Difficulty DOM
const DIFF_BTNS = document.querySelectorAll('.diff-btn');
const DIFF_DESC = document.getElementById('difficulty-desc');
const LEVEL_DISPLAY = document.getElementById('current-level-display');

// Auto Answer State
let autoAnswerEnabled = localStorage.getItem('dimsum_auto_answer') !== 'false'; // Default to true

// Listen for global toggle
window.addEventListener('auto-answer-changed', (e) => {
    autoAnswerEnabled = e.detail.enabled;
    console.log("Auto Answer Toggled:", autoAnswerEnabled);
    if (autoAnswerEnabled && practiceTarget && !isListening) {
        // If we toggled ON while waiting, start listening!
        startListening();
    }
});

const DIFFICULTY_DESCS = {
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

// Initialize
// Initialize (moved to bottom)
// ... logic continues ...

function loadVoices() {
    voices = synthesis.getVoices();
    if (voices.length === 0) return; // Wait for voices to load

    // 1. Populate Dropdown
    if (voiceSelect) {
        voiceSelect.innerHTML = '<option value="auto">Auto (Default)</option>';

        // Filter for relevant voices (Cantonese, Chinese, or English if needed?)
        // Let's list mostly Chinese/Cantonese voices, maybe others for fun?
        // Let's stick to Chinese/Cantonese + English (for fallback debug)
        const relevantVoices = voices.filter(v =>
            v.lang.startsWith('zh') ||
            v.lang.includes('HK') ||
            v.lang.includes('TW') ||
            v.lang.startsWith('en') // Include English for accessibility/debug
        ).sort((a, b) => a.lang.localeCompare(b.lang));

        relevantVoices.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.voiceURI;
            opt.textContent = `${v.name} (${v.lang})`;
            voiceSelect.appendChild(opt);
        });

        // Set selected value
        voiceSelect.value = selectedVoiceURI || 'auto';

        // Handler
        voiceSelect.onchange = () => {
            selectedVoiceURI = voiceSelect.value;
            console.log("User selected voice:", selectedVoiceURI);
            updateFinalVoice();
            saveProgress();
            speak("Testing voice. 測試語音。", false, null, true); // Test speak
        };
    }

    updateFinalVoice();
}

function updateFinalVoice() {
    // If specific voice selected
    if (selectedVoiceURI && selectedVoiceURI !== 'auto') {
        const userVoice = voices.find(v => v.voiceURI === selectedVoiceURI);
        if (userVoice) {
            finalVoice = userVoice;
            console.log("Voice set to User Preference:", finalVoice.name);
            return;
        }
    }

    // Auto strategy
    // Strategy 1: Look for high-quality Cantonese voices (HK)
    // STRICT FILTER: Must be HK to be considered "Cantonese" first.
    const hkVoices = voices.filter(v => v.lang === 'zh-HK' || v.lang === 'zh_HK');

    if (hkVoices.length > 0) {
        // Priority within HK:
        // 1. "Sin-ji" (macOS high quality)
        // 2. "Neural" / "Natural" (Cloud/Edge)
        // 3. "Google" (Chrome)
        // 4. Any other HK
        finalVoice = hkVoices.find(v => v.name.includes('Sin-ji')) ||
            hkVoices.find(v => v.name.toLowerCase().includes('neural') || v.name.toLowerCase().includes('natural')) ||
            hkVoices.find(v => v.name.toLowerCase().includes('google')) ||
            hkVoices[0];
    } else {
        // Fallback only if NO HK voice exists
        console.warn("No zh-HK voice found! Falling back to other Chinese dialects.");

        // Strategy 2: Fallback to Taiwan (TW) if HK is missing
        const twVoices = voices.filter(v => v.lang.startsWith('zh-TW'));
        finalVoice = twVoices.find(v => v.name.toLowerCase().includes('google')) || twVoices[0];

        // Strategy 3: Fallback to any Chinese
        if (!finalVoice) {
            finalVoice = voices.find(v => v.lang.startsWith('zh'));
        }
    }



    if (finalVoice) {
        console.log("Optimal Cantonese Voice selected (Auto):", finalVoice.name, finalVoice.lang);
    } else {
        console.warn("No suitable Cantonese voice found on this device.");
    }
}

// OpenCC Converter
let converter = null;
try {
    if (window.OpenCC) {
        converter = window.OpenCC.Converter({ from: 'cn', to: 'hk' });
        console.log("OpenCC Converter initialized");
    }
} catch (e) {
    console.error("OpenCC Init Error:", e);
}

// Sidebar
function renderSidebar() {
    chapterNav.innerHTML = '';

    // Group by Difficulty
    const groups = {};
    gameData.forEach(round => {
        if (!groups[round.difficulty]) groups[round.difficulty] = [];
        groups[round.difficulty].push(round);
    });

    // Render Groups
    Object.keys(groups).sort((a, b) => a - b).forEach(diffLevel => {
        const rounds = groups[diffLevel];
        const groupWrapper = document.createElement('div');
        groupWrapper.className = 'level-group-wrapper';

        const header = document.createElement('div');
        header.className = 'group-header';

        // Chevron Icon
        const chevron = document.createElement('span');
        chevron.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
        chevron.className = 'group-chevron';

        const titleSpan = document.createElement('span');
        // Use custom name or fallback
        const customName = DIFFICULTY_DESCS[diffLevel];
        titleSpan.textContent = customName ? customName : `Level ${diffLevel}`;

        header.appendChild(titleSpan);
        header.appendChild(chevron);

        // Content Container
        const contentDiv = document.createElement('div');
        contentDiv.className = 'group-content';

        // Determine if this group should be open
        // Open if it matches current level OR if it's Level 0 and we haven't started yet
        const isActiveLevel = parseInt(diffLevel) === currentLevel;
        if (isActiveLevel) {
            contentDiv.classList.add('open');
            header.classList.add('active');
        }

        // Click Handler
        header.onclick = () => {
            const isOpen = contentDiv.classList.contains('open');

            // Close all others (optional - mimics accordion)
            document.querySelectorAll('.group-content').forEach(el => el.classList.remove('open'));
            document.querySelectorAll('.group-header').forEach(el => el.classList.remove('active'));

            if (!isOpen) {
                contentDiv.classList.add('open');
                header.classList.add('active');
            }
        };

        groupWrapper.appendChild(header);

        rounds.forEach((round, index) => {
            const btn = document.createElement('div');
            btn.className = 'round-card';

            // Check status
            const isPlayed = playedRounds.includes(round.id);
            const isCurrent = currentRound && currentRound.id === round.id;

            if (isPlayed) btn.classList.add('completed');
            if (isCurrent) btn.classList.add('active');

            // Card Content
            btn.innerHTML = `
                <div class="round-info">
                    <span class="round-title">${round.title}</span>
                </div>
                <div class="round-status">
                    ${isPlayed ? '✅' : '○'}
                </div>
            `;

            btn.onclick = () => {
                startRound(round.id);
                renderSidebar();

                // Auto-close sidebar on mobile
                if (window.innerWidth < 768) {
                    const sidebar = document.querySelector('.sidebar');
                    if (sidebar) sidebar.classList.remove('open');
                }
            };

            contentDiv.appendChild(btn);
        });

        groupWrapper.appendChild(contentDiv);
        chapterNav.appendChild(groupWrapper);
    });
}

// Game Control
let playedRounds = [];

function startRound(id, isGameStart = false) {
    currentRound = gameData.find(r => r.id === id);
    if (!playedRounds.includes(id)) {
        playedRounds.push(id);
        saveProgress(); // Save that we started/played this round
    }

    revealedAnswers = [];
    currentRoundScore = 0; // Reset for new round
    if (roundScoreDisplay) {
        roundScoreDisplay.textContent = '0';
        roundScoreDisplay.classList.remove('pulse');
    }
    if (micBtn) micBtn.classList.add('hidden'); // Ensure mic is hidden at start of round


    // UI Updates
    questionText.textContent = currentRound.question.canto;
    questionText.style.cursor = 'pointer';
    questionText.onclick = () => speak(currentRound.question.canto, false, null, true);
    const qPinyin = getAccentedPinyin(currentRound.question.canto, currentRound.question.pinyin);
    questionSub.textContent = `${qPinyin} — ${currentRound.question.english}`;

    // Speak the question, then start the first answer!
    // Intro Phrase first (Custom if first round of session)
    const intro = isGameStart ?
        "Welcome back to Dim Sum Ma! Let's see your skills." :
        getIntroPhrase();

    speak(intro, false, () => {
        // Then speak the actual question (Canto) - USE USER RATE
        speak(currentRound.question.canto, true, () => {
            // Then activate the board (Faster: 500 -> 200)
            setTimeout(activateNextAnswer, 300);
        }, false);
    });

    renderBoard();
    updateNextButton();
}

const INTRO_PHRASES = [
    "Alright, pay attention!", "Next question, don't mess it up.",
    "This one is easy... for me.", "Can you handle this?",
    "Let's see what you've got.", "Focus! No sleeping.",
    "Try not to embarrass your family.", "Listen carefully.",
    "Ready for the next challenge?", "Don't disappoint me.",
    "Here comes a tricky one.", "Moving on!",
    "Lets go! Baa-da-bop-bop-bop!", "Next round!"
];

// Tiger Mom Phrases
const TIGER_INTO_PHRASES = [
    "Aiya, are you even awake? Focus!", "Don't embarrass me in front of the neighbors.",
    "This one is easy. Even your cousin can do it.", "If you get this wrong, no dinner.",
    "Pay attention! I didn't raise a quitter.", "Stop dreaming, start listening!",
    "You call that effort? Try harder on this one.", "Make me proud... for once.",
    "Why are you so slow? Hurry up!", "Don't waste my time. Listen!"
];

function getIntroPhrase() {
    if (tigerMomMode) {
        return TIGER_INTO_PHRASES[Math.floor(Math.random() * TIGER_INTO_PHRASES.length)];
    }
    return INTRO_PHRASES[Math.floor(Math.random() * INTRO_PHRASES.length)];
}

const ENCOURAGEMENTS = [
    "Go on!",
    "Show me your best!",
    "Give it a try!",
    "Don't be shy!",
    "You can do it!",
    "Let's hear it!",
    "Talk to me!",
    "Speak up, dear!",
    "Ready when you are!",
    "Your turn to shine!"
];

function getRandomEncouragement() {
    return ENCOURAGEMENTS[Math.floor(Math.random() * ENCOURAGEMENTS.length)];
}

function nextRandomRound() {
    // Filter rounds by CURRENT DIFFICULTY LEVEL
    // Also include rounds from lower levels that haven't been played? 
    // Or just strictly current level for better progression.
    // Let's go with Current Level first, if empty, look lower.

    let available = gameData.filter(r =>
        r.difficulty === currentLevel &&
        !playedRounds.includes(r.id)
    );

    if (available.length === 0) {
        // Look at lower levels if current level is cleared
        available = gameData.filter(r =>
            r.difficulty < currentLevel &&
            !playedRounds.includes(r.id)
        );
    }

    if (available.length === 0) {
        // Look at ANY unplayed rounds
        available = gameData.filter(r => !playedRounds.includes(r.id));
    }

    if (available.length === 0) {
        // RESET if everything played
        playedRounds = [];
        available = gameData.filter(r => r.difficulty === currentLevel);
    }

    const random = available[Math.floor(Math.random() * available.length)];
    startRound(random.id);
}

// History & Score
function addToHistory(answer, metrics) {
    const score = metrics.finalScore;
    const timestamp = Date.now();

    // 1. Update History Data
    const questionKey = `${currentRound.id}_ans_${answer.id}`;
    if (!questionHistory[questionKey]) questionHistory[questionKey] = [];

    questionHistory[questionKey].push({
        timestamp: timestamp,
        score: score,
        metrics: metrics,
        grade: score
    });

    // 2. Update Scores
    currentRoundScore += score;
    totalScore += score;

    // Bonus for exceptional performance
    if (score >= 95) {
        totalScore += 10;
    }

    // 3. UI Updates
    scoreDisplays.forEach(el => {
        const start = parseInt(el.textContent) || 0;
        animateValue(el, start, totalScore, 1000);
    });

    if (roundScoreDisplay) {
        roundScoreDisplay.textContent = currentRoundScore;
        roundScoreDisplay.classList.add('pulse');
        setTimeout(() => roundScoreDisplay.classList.remove('pulse'), 500);
    }

    // 4. Level Up Logic
    // const newLevel = Math.min(10, Math.floor(totalScore / 400));
    // Level up logic can stay simple or call external if needed

    // 5. Save & Sound
    saveProgress();

    // Check if playDing exists, else ignore
    if (typeof playDing === 'function') playDing();
}

function animateValue(obj, start, end, duration) {
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.innerHTML = Math.floor(progress * (end - start) + start);
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}

function updateNextButton() {
    // Button removed per design update
    // Logic kept empty to prevent errors if called elsewhere

    if (totalScore >= 500) {
        showWinScreen();
    }
}

function showWinScreen() {
    // Check if distinct win screen exists
    if (document.getElementById('win-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'win-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.background = 'rgba(0,0,0,0.85)';
    overlay.style.zIndex = '999';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.backdropFilter = 'blur(10px)';

    overlay.innerHTML = `
        <h1 style="font-size: 4rem; color: #fbbf24; margin-bottom: 2rem;">YOU ARE FLUENT!</h1>
        <p style="font-size: 1.5rem; color: white; margin-bottom: 3rem;">Score: ${totalScore}</p>
        <button id="restart-btn" style="padding: 1rem 3rem; font-size: 1.5rem; border-radius: 50px; border: none; background: #fbbf24; cursor: pointer; font-weight: bold;">Play Again</button>
    `;

    document.body.appendChild(overlay);

    document.getElementById('restart-btn').onclick = () => {
        totalScore = 0;
        scoreDisplays.forEach(el => el.textContent = 0);
        playedRounds = []; // soft reset
        overlay.remove();
        nextRandomRound();
    };

    speak("Congratulations! You are officially fluent.");
}

// Redefined DOM Elements for Single View
const activeStage = document.getElementById('active-stage');
const completedGallery = document.getElementById('completed-gallery');

function renderBoard() {
    activeStage.innerHTML = '<div class="empty-stage-msg">Get Ready!</div>';
    completedGallery.innerHTML = '';

    // Render banquet table as background
    renderBanquetBackground();

    // Create Card Elements (Memory only first? Or append to Gallery hidden?)
    // Strategy: We will create the card elements when needed or pre-create them?
    // Let's pre-create them in memory or a hidden state to manage them easier.

    // Actually, let's just render the COMPLETED ones in gallery if any (none at start)
    // And render the ACTIVE one in stage.

    // We need to know which is active. 
    // In `startRound`, we called `activateNextAnswer`.

    // So renderBoard just clears the view basically.
    revealedAnswers.forEach(id => {
        // If we reloading state (future proof), render them in gallery.
        // For now, new round = empty.
    });
}

// Render Banquet Table as Background
function renderBanquetBackground() {
    // Create background container
    const bgContainer = document.createElement('div');
    bgContainer.className = 'banquet-background';
    bgContainer.id = 'banquet-bg';

    // Create the table element
    const table = document.createElement('div');
    table.className = 'banquet-table';

    // Add tablecloth
    const cloth = document.createElement('div');
    cloth.className = 'table-cloth';
    table.appendChild(cloth);

    // Render all placed items (non-interactable)
    placedItems.forEach(entity => {
        if (entity.type === 'basket') {
            renderBasketBackground(table, entity);
        } else {
            renderLooseItemBackground(table, entity);
        }
    });

    bgContainer.appendChild(table);

    // Insert as first child of completed gallery (behind cards)
    completedGallery.insertBefore(bgContainer, completedGallery.firstChild);
}

// Render basket in background mode (non-interactable)
function renderBasketBackground(container, basketData) {
    const wrapper = document.createElement('div');
    wrapper.className = 'placed-item basket-wrapper';

    // Position (scaled for background)
    const scale = 0.8; // Slightly smaller for background
    const left = 50 + (basketData.x * scale / 6); // Convert to percentage-based positioning
    const top = 50 + (basketData.y * scale / 6);

    wrapper.style.left = `${left}%`;
    wrapper.style.top = `${top}%`;
    wrapper.style.transform = `translate(-50%, -50%) rotate(${basketData.rotation}deg)`;

    // Visual State
    const itemCount = basketData.contents.length;
    if (itemCount >= BASKET_CAPACITY) {
        wrapper.classList.add('basket-full');
    } else {
        wrapper.classList.add('basket-dull');
    }

    // Render Basket SVG
    const basketSvg = ITEM_ASSETS.basket;
    wrapper.innerHTML = basketSvg;

    // Render Contents
    const contentContainer = document.createElement('div');
    contentContainer.style.position = 'absolute';
    contentContainer.style.top = '0';
    contentContainer.style.left = '0';
    contentContainer.style.width = '100%';
    contentContainer.style.height = '100%';
    contentContainer.style.pointerEvents = 'none';

    basketData.contents.forEach((c, index) => {
        const itemDef = ITEMS.find(i => i.id === c.itemId);
        if (!itemDef) return;

        const itemEl = document.createElement('div');
        itemEl.style.position = 'absolute';
        itemEl.style.width = '45px';
        itemEl.style.height = '45px';

        // Triforce pattern
        let dx = 0, dy = 0;
        const dist = 15;
        if (index === 0) { dx = 0; dy = -dist; }
        else if (index === 1) { dx = dist; dy = dist / 2; }
        else if (index === 2) { dx = -dist; dy = dist / 2; }

        const ix = 50 + dx - 22.5;
        const iy = 50 + dy - 22.5;

        itemEl.style.left = `${ix}%`;
        itemEl.style.top = `${iy}%`;
        itemEl.style.transform = `rotate(${c.rotation}deg)`;
        itemEl.innerHTML = itemDef.asset;

        contentContainer.appendChild(itemEl);
    });

    wrapper.appendChild(contentContainer);
    container.appendChild(wrapper);
}

// Render loose item in background mode (non-interactable)
function renderLooseItemBackground(container, itemData) {
    const itemDef = ITEMS.find(i => i.id === itemData.itemId);
    if (!itemDef) return;

    const el = document.createElement('div');
    el.className = 'placed-item';
    el.innerHTML = itemDef.asset;

    // Position (scaled for background)
    const scale = 0.8;
    const left = 50 + (itemData.x * scale / 6);
    const top = 50 + (itemData.y * scale / 6);

    el.style.left = `${left}%`;
    el.style.top = `${top}%`;
    el.style.transform = `translate(-50%, -50%) rotate(${itemData.rotation}deg)`;

    container.appendChild(el);
}

// Logic

// Logic
let practiceTarget = null; // Currently selected card to practice
let silenceTimer = null;
// let transcriptBuffer = ""; // (Already defined in setupSpeechRecognition block? No, restore it here)
// Actually, let's keep them global as they are used in multiple places
let fullTranscript = "";
let currentSessionText = "";
let ttsActive = false;
let transcriptBuffer = ""; // Restoring legacy name if used elsewhere
let tigerMomMode = false; // State for Tiger Mom Mode

function activateNextAnswer() {
    // Find the NEXT available card from DATA, not DOM
    // We want a random unrevealed answer? Or sequential?
    // Let's go sequential for now, or random from unrevealed.
    // Random is more fun for "Feud".

    const unrevealed = currentRound.answers.filter(a => !revealedAnswers.includes(a.id));

    if (unrevealed.length > 0) {
        // Pick random one
        const nextAns = unrevealed[Math.floor(Math.random() * unrevealed.length)];
        activateCard(nextAns);
    } else {
        // Round Complete
        showRoundSummary();
    }
}

function activateCard(ans) {
    if (revealedAnswers.includes(ans.id)) return;

    // 1. Create Card DOM
    activeStage.innerHTML = ''; // Clear stage

    const card = document.createElement('div');
    card.className = 'answer-card active';
    card.id = `ans-${ans.id}`;

    // Content
    const accentedPinyin = getAccentedPinyin(ans.canto, ans.pinyin);
    const phoneticEnglish = toPhoneticEnglish(ans.pinyin);

    card.innerHTML = `
        <div class="text-group">
            <div class="answer-row chinese">${ans.canto}</div>
            <div class="answer-row pinyin">${accentedPinyin} / ${phoneticEnglish}</div>
            <div class="answer-row english">${ans.english}</div>
        </div>
        <div class="card-score-container" id="score-${ans.id}">
            <div class="main-score">--</div>
        </div>
    `;

    // Add History Button if needed
    const questionKey = `${currentRound.id}_ans_${ans.id}`;
    if (questionHistory[questionKey] && questionHistory[questionKey].length > 0) {
        const progressBtn = document.createElement('button');
        progressBtn.className = 'progress-btn';
        progressBtn.innerHTML = '📊';
        progressBtn.onclick = (e) => {
            e.stopPropagation();
            showScoreHistory(ans, questionHistory[questionKey]);
        };
        card.appendChild(progressBtn);
    }

    activeStage.appendChild(card);

    // 2. Set State
    practiceTarget = ans;

    // Clear speech bubble for new question
    if (liveSubtitleText) {
        liveSubtitleText.innerHTML = "";
        liveSubtitle.classList.remove('has-text', 'wave-active');
    }

    // Hide Mic initially (while speaking)
    if (micBtn) micBtn.classList.add('hidden');

    // Speak it - USE USER RATE
    speak(ans.canto, false, () => {
        // Show Mic ONLY when done speaking
        if (micBtn) micBtn.classList.remove('hidden');

        statusText.textContent = getRandomEncouragement();

        // Auto Answer Logic
        if (autoAnswerEnabled) {
            setTimeout(() => {
                startListening();
            }, 500); // Small buffer after speaking
        }
    }, true);

    statusText.textContent = "Listen...";
}

function showRoundSummary() {
    const screen = document.getElementById('round-summary-screen');
    const roundScoreDisplay = document.getElementById('round-score-display');
    const totalScoreDisplay = document.getElementById('summary-total-score');
    const feedbackText = document.getElementById('round-feedback-text');
    const nextBtn = document.getElementById('next-round-btn');


    // Hide Mic
    if (micBtn) micBtn.classList.add('hidden');

    // Update scores

    roundScoreDisplay.textContent = currentRoundScore;
    if (totalScoreDisplay) totalScoreDisplay.textContent = totalScore;

    // Random Mom Feedback
    const feedbacks = [
        "Not bad, but can be better.",
        "You earned your dim sum today.",
        "Grandmother would be... satisfied.",
        "Keep practicing, dear.",
        "Aiya, at least you tried!",
        "Better than your cousin... maybe.",
        "Your tones are improving!",
        "Time for the next course!"
    ];

    // Tiger Mom Summary Feedbacks
    const tigerFeedbacks = [
        "Score is okay. But why not higher?",
        "Only this many points? Aiya.",
        "Your cousin got full marks. Just saying.",
        "You can eat... but study more later.",
        "Almost acceptable. Almost.",
        "I expected better from you.",
        "Lucky guess?",
        "Good. Now go practice piano."
    ];

    const pool = tigerMomMode ? tigerFeedbacks : feedbacks;

    if (feedbackText) {
        feedbackText.textContent = `"${pool[Math.floor(Math.random() * pool.length)]}"`;
    }

    // Show screen
    screen.classList.remove('hidden');

    // Speak
    speak(`Round complete! You earned ${currentRoundScore} points. Ready for the next course?`);

    // Handle click (ensure one listener replacement)
    nextBtn.onclick = () => {
        screen.classList.add('hidden');
        nextRandomRound();
    };

    // Show/hide history button based on whether any questions have history
    const historyBtn = document.getElementById('view-history-btn');
    if (historyBtn) {
        const hasAnyHistory = currentRound.answers.some(ans => {
            const questionKey = `${currentRound.id}_ans_${ans.id}`;
            return questionHistory[questionKey] && questionHistory[questionKey].length > 0;
        });
        historyBtn.style.display = hasAnyHistory ? 'block' : 'none';
    }
}

const FEEDBACK_PHRASES = {
    perfect: [
        "Wa! Better than my own son!", "So clear! You sounded local.",
        "Perfect tones! Have an extra dumpling.", "Impressive! You make me proud.",
        "Your Cantonese is delicious!", "100 marks! I'm telling the neighbors.",
        "Finally, someone who listens!", "Top quality! Like fresh Har Gow.",
        "Expert level! You are ready for Yam Cha.", "Aiya, you are too good!",
        "Music to my ears!", "Did you grow up in Hong Kong?"
    ],
    good: [
        "Very good! Keep it up.", "Not bad, distinct and clear.",
        "I understood you perfectly.", "Solid effort! Almost native.",
        "Good energy! Tones are getting there.", "Acceptable! You can order lunch.",
        "Nice work!", "You are learning fast!",
        "Respectable! I like it.", "Pretty smooth!",
        "Passable! Grandmother would smile.", "Strong effort!"
    ],
    okay: [
        "Getting there! Watch your tones.", "Okay, I understand... mostly.",
        "A little bit stiff, but acceptable.", "Try a bit more feeling next time.",
        "Not bad, but practice more.", "Distinct enough.",
        "Careful with the pitch, but good try.", "I give you a B for effort.",
        "You are trying, that is important.", "Almost there!"
    ],
    poor: [
        "Aiya, that was close! Don't be shy.", "Open your mouth wider!",
        "Tricky one? Listen to me again.", "Not quite! You can do better.",
        "Don't worry, Cantonese is hard!", "Speak up, dear!",
        "Almost! Try focusing on the tone.", "A little bit off. You'll get it next time!",
        "Keep practicing! I believe in you.", "Listen carefully and copy me.",
        "Don't give up! Eat a bun and keep fighting."
    ]
};

const TIGER_FEEDBACK_PHRASES = {
    perfect: [
        "Finally, you did it right.", "Good. Don't get cocky.",
        "About time you learned.", "Acceptable. Very acceptabe.",
        "See? Was that so hard?", "Okay, you have potential.",
        "Not embarrassing. Good job.", "You sound almost educated."
    ],
    good: [
        "Why not 100%? Lazy.", "It's okay. But okay is not nimble.",
        "You can do better. Try harder.", "70% effort, I can tell.",
        "Better than nothing, I guess.", "My friend's son speaks better.",
        "Just 'good'? Aim for perfect!", "Don't settle for average."
    ],
    okay: [
        "Aiya, make me headache.", "Are you even trying?",
        "My ears are hurting.", "So rigid! Relax your mouth.",
        "You sound like a tourist.", "Practice more! Less video games!",
        "I am judging you.", "Is that your best?"
    ],
    poor: [
        "What was that? Terrible.", "Aiya! You are dishonoring the family.",
        "Stop mumbling! Speak up!", "No dinner for you tonight.",
        "Did you learn nothing?", "Go study more!",
        "Hopeless... absolutely hopeless.", "I am closing my eyes in shame.",
        "Even the dog understands better."
    ]
};

function getFeedback(wordScore, toneScore) {
    const avg = (wordScore + toneScore) / 2;
    let category = 'poor';
    if (avg >= 90) category = 'perfect';
    else if (avg >= 70) category = 'good';
    else if (avg >= 40) category = 'okay';

    const phrases = tigerMomMode ? TIGER_FEEDBACK_PHRASES[category] : FEEDBACK_PHRASES[category];
    let feedback = phrases[Math.floor(Math.random() * phrases.length)];

    // Add specific advice
    if (wordScore < 80 && wordScore < toneScore) {
        feedback += tigerMomMode ? " Speak more clearly!" : " Try to pronounce the letters more clearly.";
    } else if (toneScore < 80 && toneScore < wordScore) {
        feedback += tigerMomMode ? " Your tones are flat like a pancake!" : " Your tones need a bit more practice.";
    }

    return feedback;
}

const DIGIT_MAP = {
    '0': '零', '1': '一', '2': '二', '3': '三', '4': '四',
    '5': '五', '6': '六', '7': '七', '8': '八', '9': '九', '10': '十'
};

function normalizeInput(text) {
    if (!text) return text;
    // Replace digits with Chinese characters
    return text.toString().replace(/\d+/g, (match) => {
        return DIGIT_MAP[match] || match;
    });
}

function handleInput(text) {
    if (!practiceTarget) return;

    // Filter noise/short sounds
    if (text.trim().length < 1) return;

    const lowerText = text.toLowerCase();

    // --- GRANULAR SCORING ENGINE ---
    const isCantoMode = recognition.lang !== 'en-US';

    // Convert input to Traditional Chinese if possible
    let processedText = normalizeInput(text); // Normalize digits first
    if (converter) {
        processedText = converter(processedText);
    }

    // Calculate Metrics
    const metrics = calculateGradingMetrics(practiceTarget.canto, processedText, 0.85);

    // Restore Rich Feedback (Tiger Mom)
    metrics.feedback = getFeedback(metrics.syllableScore, metrics.toneScore);

    // Generate Pinyin Tokens for User Input
    const userTokens = convertToPinyin(processedText);
    // Speak feedback, then trigger success
    const target = practiceTarget;

    // Always show what was heard in status, with Pinyin
    const userPinyinStr = userTokens.map(t => t.pinyin).join(' ');
    if (liveSubtitleText) {
        liveSubtitleText.innerHTML = `<span style="color:#a78bfa">${processedText}</span> <br> <span style="font-size:0.8em; color:#ddd">${userPinyinStr}</span>`;
        liveSubtitle.classList.add('has-text');
    }

    speak(`${metrics.finalScore} points. ${metrics.feedback}`, false, () => {
        success(target, metrics, processedText, userTokens);
    });

    practiceTarget = null;
}

function success(answer, metrics, spokenText = "", userTokens = []) {
    const wordScore = metrics.syllableScore || 0;
    const toneScore = metrics.toneScore || 0;

    revealedAnswers.push(answer.id);
    addToHistory(answer, metrics); // Add score to total

    // Find card in Stage
    const card = document.getElementById(`ans-${answer.id}`);

    if (card) {
        // Animation: Success State
        card.classList.add('completed');

        // Hide mic
        if (micBtn) micBtn.classList.add('hidden');

        // UPDATE THE CARD SCORE TO SHOW THE GRADE
        const scoreEl = document.getElementById(`score-${answer.id}`);
        if (scoreEl) {
            const metricsList = [
                { score: metrics.syllableScore, color: '#4ade80', label: 'Syl' },
                { score: metrics.toneScore, color: '#fbbf24', label: 'Tone' },
                { score: metrics.confidenceScore, color: '#a78bfa', label: 'Conf' },
                { score: metrics.spiritScore, color: '#f472b6', label: 'Spt' }
            ].map(item => `
                <div class="metric-row" title="${item.label}: ${item.score}%">
                    <span class="metric-label">${item.label[0]}</span>
                    <div class="metric-bar-bg">
                        <div class="metric-bar-fill" style="width: ${item.score}%; background-color: ${item.color};"></div>
                    </div>
                </div>
            `).join('');

            scoreEl.innerHTML = `
                <div class="card-score-compact">
                    <div class="main-score-circle">${metrics.finalScore}</div>
                    <div class="metrics-grid">
                        ${metricsList}
                    </div>
                </div>
            `;
        }

        // SHOW SPOKEN TEXT WITH PINYIN - ELEGANT UI
        if (spokenText && userTokens.length > 0) {
            const textGroup = card.querySelector('.text-group');
            if (textGroup) {
                const feedbackContainer = document.createElement('div');
                feedbackContainer.className = 'user-feedback-container';

                userTokens.forEach(token => {
                    const span = document.createElement('span');
                    span.className = 'feedback-token';
                    // Re-adding pinyin for "phonetic" version, styling will subdue it
                    span.innerHTML = `<span class="u-char">${token.char}</span><span class="u-pinyin">${token.pinyin}</span>`;
                    feedbackContainer.appendChild(span);
                });
                card.appendChild(feedbackContainer);
            }
        }

        // Move to Gallery after delay
        setTimeout(() => {
            // Move DOM element to Gallery
            completedGallery.prepend(card); // Add to start of gallery

            // Trigger Next Question
            setTimeout(activateNextAnswer, 500);
        }, 2000); // Wait 2s to see the results
    }
}


function animateScore(elements, start, end, duration) {
    if (!elements || elements.length === 0) return;
    let startTime = null;
    const step = (timestamp) => {
        if (!startTime) startTime = timestamp;
        const progress = Math.min((timestamp - startTime) / duration, 1);

        // EaseOutCubic
        const ease = 1 - Math.pow(1 - progress, 3);

        const current = Math.floor(start + (end - start) * ease);

        elements.forEach(el => el.textContent = current);

        if (progress < 1) {
            window.requestAnimationFrame(step);
        } else {
            elements.forEach(el => el.textContent = end);
        }
    };
    window.requestAnimationFrame(step);
}

// History Logic Removed (was here)

function fail(grade, feedback) {
    statusText.textContent = `${grade}% - ${feedback}`;
    statusText.style.color = 'orange';
    setTimeout(() => {
        statusText.style.color = 'var(--text-muted)';
        statusText.textContent = "Listening...";
    }, 2000);
}

// Language switching removed - Cantonese only

// Speech Recognition Setup
function setupSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'zh-HK'; // Cantonese (Hong Kong)

        recognition.onstart = () => {
            if (isListening) {
                const btn = document.getElementById('mic-btn');
                if (btn) btn.classList.add('listening');

                statusText.textContent = 'Listening...';
                statusText.style.color = '#22d3ee';
                statusText.style.fontWeight = 'bold';
            }
        };

        recognition.onresult = (event) => {
            // Safety check: ignore while Avatar is speaking
            if (ttsActive) return;

            let currentSessionText = '';

            // Iterate ALL results to rebuild the session transcript
            if (event.results && event.results.length > 0) {
                for (let i = 0; i < event.results.length; ++i) {
                    const res = event.results[i];
                    if (res && res.length > 0 && res[0].transcript) {
                        currentSessionText += res[0].transcript;
                    }
                }
            }

            // CRITICAL FIX: Only update buffer if we have valid text.
            // This prevents an empty "Final" result (Conf: 0) from wiping out 
            // a valid "Interim" result we just captured.
            if (currentSessionText.trim().length > 0) {
                // Determine if we need to convert (only if Cantonese mode)
                // Note: recognition.lang might be 'zh-HK' but browser can still return Simplified
                const isCantoMode = recognition.lang !== 'en-US';

                if (isCantoMode && converter) {
                    transcriptBuffer = converter(currentSessionText);
                } else {
                    transcriptBuffer = currentSessionText;
                }

                // Visual feedback
                if (liveSubtitleText) {
                    liveSubtitleText.textContent = transcriptBuffer;
                    if (transcriptBuffer.trim().length > 0) {
                        liveSubtitle.classList.add('has-text');
                    } else {
                        liveSubtitle.classList.remove('has-text');
                    }
                }
                statusText.textContent = "Listening...";
                statusText.style.color = '#22d3ee';

                // --- AUTO STOP LOGIC ---
                // Reset silence timer on every result
                if (silenceTimer) clearTimeout(silenceTimer);
                silenceTimer = setTimeout(() => {
                    console.log("Silence detected, auto-stopping.");
                    stopListening();
                }, 1500); // 1.5s of silence = stop

            } else {
                // We received an empty result. Ignore it to preserve our buffer.
                // This often happens when the browser finalizes a "noise" input.
            }
        };

        recognition.onerror = (e) => {
            console.log("Mic Error", e);
            if (e.error === 'no-speech') {
                // Ignore
            } else if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
                isListening = false;
                updateMicUI(false);
                statusText.textContent = "Mic Denied";
            }
        };

        recognition.onend = () => {
            console.log("Recognition END. Buffer:", transcriptBuffer, "isListening:", isListening);

            // If we stopped naturally?
            // If isListening is TRUE, it means we didn't release button yet => Restart
            if (isListening) {
                console.log("End but still holding - Restarting");
                try { recognition.start(); } catch (e) { }
            } else {
                // We stopped because we released button.
                // SUBMIT NOW!
                if (transcriptBuffer.trim().length > 0) {
                    statusText.textContent = "Processing...";
                    console.log("Submitting:", transcriptBuffer);
                    handleInput(transcriptBuffer);
                } else {
                    console.log("Buffer empty, ignoring.");
                    updateMicUI(false);
                }
                transcriptBuffer = ""; // Clear
            }
        };

    } else {
        alert("Browser does not support Speech API.");
    }
}

function updateMicUI(listening) {
    const btn = document.getElementById('mic-btn');
    if (btn) {
        if (listening) btn.classList.add('listening');
        else btn.classList.remove('listening');
    }

    if (!listening) {
        statusText.textContent = getRandomEncouragement();
        statusText.style.color = 'var(--text-muted)';
        statusText.style.fontWeight = 'normal';
    }
}

function toggleListening() {
    if (isListening) {
        stopListening();
    } else {
        startListening();
    }
}

// function toggleListening() { ... } // DEPRECATED

function startListening() {
    // TOGGLE: Start listening
    if (!recognition) return;
    if (isListening) return;

    // 1. Play "Bong" Sound immediately
    playBong(600, 0.1);

    // 2. Set UI to "Starting" state
    statusText.textContent = "Adjusting mic...";

    // 3. Delay recognition start to avoid capturing the "bong"
    // (Wait 300ms)
    setTimeout(() => {
        isListening = true;
        transcriptBuffer = ""; // Reset buffer

        // Clear old silence timer just in case
        if (silenceTimer) clearTimeout(silenceTimer);

        // 2. Set UI to "Starting" state
        isListening = true;
        updateMicUI(true);

        if (waveformEnabled) {
            startWaveform();
        }

        try {
            recognition.start();
        } catch (e) {
            console.error("Recognition Start Error:", e);
        }
    }, 300);
}

function stopListening() {
    // Stop listening
    if (!isListening) return;

    isListening = false;
    updateMicUI(false);
    stopWaveform();

    if (silenceTimer) clearTimeout(silenceTimer);

    if (recognition) {
        try {
            recognition.stop();
        } catch (e) { }
    }

    // Let's create a different subtle sound for stop/processing.
    playDing();
}

// Waveform Logic
function startWaveform() {
    if (!waveformEnabled) return;

    waveformCanvas = document.getElementById('waveform-canvas');
    if (!waveformCanvas) return;

    // Do NOT add wave-active here, we will add it in drawWaveform based on volume

    waveformCanvas.classList.remove('hidden');
    waveformCtx = waveformCanvas.getContext('2d');

    if (!audioContext) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioContext = new AudioContext();
    }

    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            micStream = stream;
            const source = audioContext.createMediaStreamSource(stream);
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);

            const bufferLength = analyser.frequencyBinCount;
            dataArray = new Uint8Array(bufferLength);

            drawWaveform();
        })
        .catch(err => {
            console.error("Microphone access denied for waveform:", err);
            waveformCanvas.classList.add('hidden');
        });
}

function stopWaveform() {
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
    if (micStream) {
        micStream.getTracks().forEach(track => track.stop());
        micStream = null;
    }

    // Remove wave-active class
    if (liveSubtitle) {
        liveSubtitle.classList.remove('wave-active');
        // Do NOT clear text here if we want to show processing state, 
        // but user says "don't show empty bubble", so maybe we clear it.
        // Actually, onend handles the final transcript.
    }

    const canvas = document.getElementById('waveform-canvas');
    if (canvas) canvas.classList.add('hidden');
}

function drawWaveform() {
    if (!analyser || !waveformCtx || !waveformCanvas) return;

    animationId = requestAnimationFrame(drawWaveform);

    // Use Frequency Data for more "prominent" and "cute" movement
    analyser.getByteFrequencyData(dataArray);

    const width = waveformCanvas.width;
    const height = waveformCanvas.height;

    // 1. Calculate Volume (Average Frequency)
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
    }
    const averageVolume = sum / dataArray.length;

    // 2. Control Bubble Visibility based on Volume with Smoothing
    // Threshold: 10 (very quiet) to 20 (normal speaking)
    const threshold = 12;
    const hasText = liveSubtitleText && liveSubtitleText.textContent.trim().length > 0;

    // Decay/Smoothing: Keep it high if loud, slowly decrease
    if (averageVolume > threshold) {
        volumeSmoothed = 0.8 * volumeSmoothed + 0.2 * averageVolume;
    } else {
        volumeSmoothed *= 0.85; // Faster decay for better responsiveness
    }

    if (volumeSmoothed > 8 || hasText) {
        liveSubtitle.classList.add('wave-active');
    } else {
        liveSubtitle.classList.remove('wave-active');
    }

    waveformCtx.clearRect(0, 0, width, height);

    // Cute Branded Waveform Style: "Dim Sum Aura / Steam"
    const barCount = 12; // Fewer bars = chunkier/cuter
    const barSpacing = 6;
    const barWidth = (width / barCount) - barSpacing;
    const step = Math.floor(dataArray.length / 2 / barCount);

    for (let i = 0; i < barCount; i++) {
        // Average frequency in this chunk
        let chunkSum = 0;
        for (let j = 0; j < step; j++) {
            chunkSum += dataArray[i * step + j];
        }
        const val = chunkSum / step;
        const barHeight = Math.max(6, (val / 255) * height * 0.9);

        // Colors: Gold to Pink (Branded)
        const mix = i / barCount;
        const color = `rgba(${Math.floor(251 * (1 - mix) + 244 * mix)}, ${Math.floor(191 * (1 - mix) + 114 * mix)}, ${Math.floor(36 * (1 - mix) + 182 * mix)}, 0.85)`;

        waveformCtx.fillStyle = color;

        // Draw Symmetrical Rounded Bars
        const centerX = i * (barWidth + barSpacing) + barSpacing / 2;
        const centerY = height / 2;

        waveformCtx.beginPath();
        waveformCtx.roundRect(centerX, centerY - barHeight / 2, barWidth, barHeight, 12);
        waveformCtx.fill();

        // Pulsing Glow
        waveformCtx.shadowBlur = val / 8;
        waveformCtx.shadowColor = color;
    }
    waveformCtx.shadowBlur = 0;
}



// Music System
const MusicPlayer = {
    ctx: null,
    isPlaying: false,
    interval: null,
    toggleBtn: null,
    NoteFreqs: {
        'C4': 261.63, 'D4': 293.66, 'E4': 329.63, 'G4': 392.00, 'A4': 440.00,
        'C5': 523.25, 'D5': 587.33, 'E5': 659.25, 'G5': 783.99, 'A5': 880.00
    },
    melody: ['C4', 'E4', 'G4', 'A4', 'G4', 'E4', 'D4', 'C4', 'D4', 'E4', 'C4', null],

    init() {
        this.toggleBtn = document.getElementById('music-toggle');
        if (this.toggleBtn) {
            this.toggleBtn.onclick = () => this.toggle();
        }
    },

    toggle() {
        if (this.isPlaying) {
            this.stop();
        } else {
            this.start();
        }
    },

    start() {
        if (!this.ctx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContext();
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();

        this.isPlaying = true;
        if (this.toggleBtn) {
            this.toggleBtn.classList.add('playing');
            this.toggleBtn.innerHTML = '🎵 ON';
        }

        let noteIndex = 0;
        const noteDuration = 0.4; // seconds

        this.interval = setInterval(() => {
            if (!this.isPlaying) return;
            const note = this.melody[noteIndex];
            if (note) this.playNote(this.NoteFreqs[note], noteDuration);
            noteIndex = (noteIndex + 1) % this.melody.length;
        }, noteDuration * 1000);
    },

    stop() {
        this.isPlaying = false;
        clearInterval(this.interval);
        if (this.toggleBtn) {
            this.toggleBtn.classList.remove('playing');
            this.toggleBtn.innerHTML = '🎵 OFF';
        }
    },

    playNote(freq, duration) {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.frequency.value = freq;
        osc.type = 'sine'; // Soft sine wave

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        // Envelope
        gain.gain.setValueAtTime(0, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.05, this.ctx.currentTime + 0.05); // Attack (Soft volume 0.05)
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration); // Release

        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    }
};

function getAccentedPinyin(canto, fallback) {
    if (pinyinMap[canto]) return pinyinMap[canto];
    // Simple logic to attempt mapping parts if whole not found (for phrases)
    let result = [];
    let chars = canto.split('');
    let allFound = true;
    for (let char of chars) {
        if (pinyinMap[char]) {
            result.push(pinyinMap[char]);
        } else if (char === ' ' || char === '，' || char === '？' || char === '！') {
            result.push(char);
        } else {
            allFound = false;
            break;
        }
    }
    if (allFound && result.length > 0) return result.join(' ');
    return fallback;
}

function playBong(freq = 500, duration = 0.5) {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!audioContext && AudioContext) {
            audioContext = new AudioContext();
        }

        if (audioContext) {
            if (audioContext.state === 'suspended') audioContext.resume();

            const ctx = audioContext;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.connect(gain);
            gain.connect(ctx.destination);

            // "Bong" sound synthesis
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(freq * 0.5, ctx.currentTime + duration);

            gain.gain.setValueAtTime(0.3, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

            osc.start();
            osc.stop(ctx.currentTime + duration);
        }
    } catch (e) {
        console.error("Audio Context Error", e);
    }
}

// Avatar & TTS
async function speak(text, showBubble = false, onComplete = null, useUserRate = false) {
    if (showBubble && avatarBubble) {
        avatarBubble.textContent = text;
        avatarBubble.classList.add('visible');
        setTimeout(() => avatarBubble.classList.remove('visible'), 4000);
    }

    // Cloud TTS Path
    if (TTS_CONFIG.useCloudTts && TTS_CONFIG.proxyEndpoint) {
        try {
            await speakCloud(text, onComplete, useUserRate);
            return;
        } catch (err) {
            console.error("Cloud TTS failed, falling back to native:", err);
        }
    }

    // Native Web Speech Path
    if (!synthesis) {
        if (onComplete) onComplete();
        return;
    }

    const utter = new SpeechSynthesisUtterance(text);

    // CRITICAL FIX: Cancel previous speech to prevent queue backup and lag
    synthesis.cancel();

    if (finalVoice) {
        utter.voice = finalVoice;
        utter.rate = useUserRate ? speechRate : 1.0;
        utter.pitch = 1.0;
    }

    utter.onstart = () => {
        avatarMouth.classList.add('talking');
        if (avatarContainer) avatarContainer.classList.add('speaking');
        ttsActive = true;
    };

    utter.onboundary = (event) => {
        if (event.name === 'word') {
            avatarMouth.classList.add('pop');
            setTimeout(() => avatarMouth.classList.remove('pop'), 100);
        }
    };

    utter.onend = () => {
        avatarMouth.classList.remove('talking');
        if (avatarContainer) avatarContainer.classList.remove('speaking');
        ttsActive = false;
        if (onComplete) onComplete();
        else statusText.textContent = getRandomEncouragement();
    };

    utter.onerror = (e) => {
        if (e.error !== 'interrupted' && e.error !== 'canceled') {
            console.error("TTS Error:", e);
            if (synthesis.paused) synthesis.resume();
        }
        ttsActive = false;
    };

    synthesis.speak(utter);
}

/**
 * Cloud TTS implementation using secure Cloudflare Worker proxy
 */
async function speakCloud(text, onComplete, useUserRate) {
    const rate = useUserRate ? speechRate : 1.0;

    // Use the secure proxy endpoint instead of calling Google Cloud directly
    const url = TTS_CONFIG.proxyEndpoint;

    const body = {
        text: text,
        voice: TTS_CONFIG.google.voice,
        languageCode: TTS_CONFIG.google.languageCode,
        speakingRate: rate
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(`TTS Proxy error: ${errorData.error || response.statusText}`);
    }

    const data = await response.json();
    const audioData = Uint8Array.from(atob(data.audioContent), c => c.charCodeAt(0));

    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(audioData.buffer);

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);

    source.onended = () => {
        avatarMouth.classList.remove('talking');
        if (avatarContainer) avatarContainer.classList.remove('speaking');
        ttsActive = false;
        if (onComplete) onComplete();
    };

    // Start UI feedback
    avatarMouth.classList.add('talking');
    if (avatarContainer) avatarContainer.classList.add('speaking');
    ttsActive = true;

    source.start(0);
}

function playDing() {
    // Simple oscillator beep for reliability
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!audioContext && AudioContext) {
            audioContext = new AudioContext();
        }

        if (audioContext) {
            if (audioContext.state === 'suspended') audioContext.resume();

            const ctx = audioContext;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 500 + Math.random() * 200;
            gain.gain.value = 0.1;
            osc.start();
            gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.5);
            osc.stop(ctx.currentTime + 0.5);
        }
    } catch (e) {
        console.log("Audio Error", e);
    }
}


// Economy & Shop Logic
let dumplingDollars = 500;
let placedItems = []; // {id, x, y, type}

function updateShopUI() {
    // Balances
    const balEl = document.getElementById('shop-balance');
    const scoreEl = document.getElementById('shop-score-val');
    const convBtn = document.getElementById('convert-btn');

    if (balEl) balEl.textContent = dumplingDollars;
    if (scoreEl) scoreEl.textContent = totalScore;
    if (convBtn) convBtn.disabled = totalScore < 100;
}

let previousView = 'game'; // Track where we came from

function switchView(viewName) {
    const banquetArea = document.getElementById('banquet-area');
    const shopModal = document.getElementById('shop-modal');
    const startScreen = document.getElementById('start-screen');
    const summaryScreen = document.getElementById('round-summary-screen');

    // Reset buttons
    document.querySelectorAll('.sidebar-btn').forEach(btn => btn.classList.remove('active'));

    if (viewName === 'game') {
        banquetArea.classList.remove('full-mode');
        // Ensure it's still visible as mini-mode if meaningful, 
        // but 'visible' class was used for opacity previously. 
        // We now rely on default CSS being visible. 
        // Maybe we just ensure it's not hidden if we ever hide it.
        banquetArea.style.display = 'flex';

        shopModal.classList.remove('visible');
        document.getElementById('nav-home-btn').classList.add('active');

        // If returning to game, ensure overlays are handled correctly
        if (previousView === 'start') {
            startScreen.style.display = 'flex';
            startScreen.style.opacity = '1';
        } else if (previousView === 'summary') {
            summaryScreen.classList.remove('hidden');
        }

    } else if (viewName === 'banquet') {
        banquetArea.classList.add('full-mode');
        shopModal.classList.remove('visible');
        document.getElementById('view-banquet-btn').classList.add('active');
        renderBanquet();
    } else if (viewName === 'shop') {
        updateShopUI();
        shopModal.classList.add('visible');
        // Shop is an overlay, so we might want to keep banquet in full mode if we were there?
        // But simplifying: just show shop.
        document.getElementById('nav-shop-btn').classList.add('active');
    }
}

// Helper to open shop/banquet keeping context
function openShopFrom(source) {
    previousView = source;

    // If coming from start/summary, we might want to hide them temporarily?
    // Or just let the shop modal overlaid on top (z-index is high).
    // Let's rely on Z-Index overlay for simplicity, but if we switch to 'banquet' (full screen),
    // we need to make sure the start screen doesn't block clicks if it's below.

    // Actually, banquet-area is absolute/fixed top 0.
    // If start-screen is z-index 2000, banquet needs to be higher?
    // Let's checking CSS.

    // For now, let's switch to 'banquet' view directly for "Customize Banquet"
    switchView('banquet');
}

// BASKET LOGIC
const BASKET_CAPACITY = 3;

function initShop() {
    // 1. Convert Logic
    const convBtn = document.getElementById('convert-btn');
    if (convBtn) {
        convBtn.onclick = () => {
            if (totalScore >= 10) {
                totalScore -= 10;
                dumplingDollars += 1;
                updateShopUI();
                saveProgress();

                // Updates Scoreboard
                scoreDisplays.forEach(el => el.textContent = totalScore);
                playBong(800, 0.1); // Success sound
            } else {
                speak("Not enough score! Practice more.");
            }
        };
    }

    // 2. Render Shop Grid with Tabs
    let activeCategory = 'steamed'; // Default tab

    // Tab click handlers
    const setupTabs = () => {
        document.querySelectorAll('.shop-tab').forEach(tab => {
            tab.onclick = () => {
                activeCategory = tab.dataset.category;
                document.querySelectorAll('.shop-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                renderShopGrid();
            };
        });
    };

    // Render grid based on active category
    const renderShopGrid = () => {
        const grid = document.getElementById('shop-grid');
        if (!grid) return;

        grid.innerHTML = '';

        // Filter items by active category
        const filteredItems = ITEMS.filter(item => item.category === activeCategory);

        // Render filtered items
        filteredItems.forEach(item => {
            const el = document.createElement('div');
            el.className = 'shop-item';
            el.id = `shop-item-${item.id}`;
            el.innerHTML = `
                <div class="item-visual">${item.asset}</div>
                <span class="item-name">${item.name}</span>
                <span class="item-price">${item.price} 🥟</span>
            `;
            el.onclick = () => buyItem(item, el);
            grid.appendChild(el);
        });
    };

    // Initialize tabs and render
    setupTabs();
    renderShopGrid();

    // 3. Navigation
    const navHomeBtn = document.getElementById('nav-home-btn');
    const viewBanquetBtn = document.getElementById('view-banquet-btn');
    const navShopBtn = document.getElementById('nav-shop-btn');

    const closeBanquetBtn = document.getElementById('close-banquet-btn');
    const openShopBtn = document.getElementById('open-shop-btn'); // Button inside banquet
    const closeShopBtn = document.getElementById('close-shop-btn');

    if (navHomeBtn) navHomeBtn.onclick = () => switchView('game');
    if (viewBanquetBtn) viewBanquetBtn.onclick = () => switchView('banquet');
    if (navShopBtn) navShopBtn.onclick = () => switchView('shop');

    if (closeBanquetBtn) closeBanquetBtn.onclick = () => switchView('game');
    if (openShopBtn) openShopBtn.onclick = () => switchView('shop');
    if (closeShopBtn) closeShopBtn.onclick = () => {
        // Return to whoever called us? or just banquet
        switchView('banquet');
    };

    const autoOrgBtn = document.getElementById('auto-organize-btn');
    if (autoOrgBtn) autoOrgBtn.onclick = () => autoOrganizeBanquet();
}

function buyItem(item, el) {
    if (dumplingDollars >= item.price) {
        dumplingDollars -= item.price;

        // Visual Feedback on Item
        if (el) {
            el.classList.add('purchased-anim');
            setTimeout(() => el.classList.remove('purchased-anim'), 500);
        }

        if (item.type === 'dimsum') {
            addDimSumToBasket(item);
        } else {
            addLooseItem(item);
        }

        updateShopUI();
        saveProgress();
        playDing(); // Cha-ching!
        // speak(`Excellent choice! ${item.name} added to your banquet.`);
        triggerShopAnnouncer(item);
    } else {
        speak("Aiya! Too expensive. Practice more, earn more!");
    }
}

// Shop Announcer Logic
let shopAnnouncementTimer = null;
let shopAnnouncementQueue = {}; // { itemName: count }

function triggerShopAnnouncer(item) {
    // 1. Add to queue
    if (!shopAnnouncementQueue[item.name]) {
        shopAnnouncementQueue[item.name] = 0;
    }
    shopAnnouncementQueue[item.name]++;

    // 2. Clear existing timer
    if (shopAnnouncementTimer) {
        clearTimeout(shopAnnouncementTimer);
    }

    // 3. Set new timer (debounce)
    shopAnnouncementTimer = setTimeout(() => {
        const message = generateShopMessage();
        speak(message);

        // Reset
        shopAnnouncementQueue = {};
        shopAnnouncementTimer = null;
    }, 1000); // 1 second debounce
}

function generateShopMessage() {
    const items = Object.keys(shopAnnouncementQueue);
    if (items.length === 0) return "";

    // Case 1: Single Type of Item
    if (items.length === 1) {
        const name = items[0];
        const count = shopAnnouncementQueue[name];
        return getShopAnnouncement(name, count);
    }

    // Case 2: Multiple Types
    // "A mixture of X, Y and Z! A bold strategy."
    const totalCount = Object.values(shopAnnouncementQueue).reduce((a, b) => a + b, 0);
    return `A delicious variety! ${totalCount} new items for the banquet. Impressive!`;
}

function getShopAnnouncement(name, count) {
    const item = ITEMS.find(i => i.name === name);
    const fact = item ? item.fact : null;

    // Chance to show fact if available (70% chance for single items, 30% for multiples)
    const showFact = fact && (count === 1 ? Math.random() < 0.7 : Math.random() < 0.3);

    if (count === 1) {
        if (showFact) {
            return `Excellent choice! ${name}. ${fact}`;
        }
        const phrases = [
            `Excellent choice! ${name} is a classic!`,
            `Ooh, ${name}! One of my favorites.`,
            `${name}? You have impeccable taste!`,
            `Fresh ${name}, coming right up!`,
            `A single ${name}, handled with care.`
        ];
        return phrases[Math.floor(Math.random() * phrases.length)];
    } else if (count === 2) {
        if (showFact) return `Double trouble! Two orders of ${name}! ${fact}`;
        return `Double trouble! Two orders of ${name}!`;
    } else if (count === 3) {
        if (showFact) return `A triple threat of ${name}! ${fact}`;
        return `A triple threat of ${name}! You are hungry!`;
    } else if (count >= 4) {
        if (showFact) return `Whoa! A mountain of ${name}! ${count} orders confirmed! ${fact}`;
        return `Whoa! A mountain of ${name}! ${count} orders confirmed!`;
    }

    return `${count} ${name}s added.`;
}

function addDimSumToBasket(item) {
    // 1. Find a basket with space AND same item type (or empty)
    let targetBasket = null;

    // Search backwards to fill most recent suitable basket first
    for (let i = placedItems.length - 1; i >= 0; i--) {
        if (placedItems[i].type === 'basket' && placedItems[i].contents.length < BASKET_CAPACITY) {
            // Check content compatibility
            if (placedItems[i].contents.length === 0) {
                targetBasket = placedItems[i];
                break;
            } else {
                // Check if existing items match the new item
                const firstItem = placedItems[i].contents[0];
                if (firstItem.itemId === item.id) {
                    targetBasket = placedItems[i];
                    break;
                }
            }
        }
    }

    if (!targetBasket) {
        // Create NEW Basket
        targetBasket = createBasket();
        placedItems.push(targetBasket);
    }

    // Add item to basket
    targetBasket.contents.push({
        itemId: item.id,
        rotation: Math.random() * 360
    });

    // Re-render
    renderBanquet();
}

function createBasket() {
    // Random position logic, but maybe cascading?
    const angle = Math.random() * Math.PI * 2;
    const radius = 50 + Math.random() * 180; // keep somewhat central
    return {
        id: 'basket-' + Date.now() + Math.random(),
        type: 'basket',
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        rotation: Math.random() * 360,
        contents: []
    };
}

function addLooseItem(item) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 50 + Math.random() * 200;

    placedItems.push({
        id: 'item-' + Date.now(),
        type: 'loose',
        itemId: item.id,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        rotation: Math.random() * 360
    });

    renderBanquet();
}

function renderBanquet() {
    const table = document.querySelector('.banquet-table');
    if (!table) return;

    // Clear old items (keep tablecloth if it was part of HTML, but here we clear all placed-items)
    const existing = table.querySelectorAll('.placed-item');
    existing.forEach(e => e.remove());

    placedItems.forEach(entity => {
        if (entity.type === 'basket') {
            renderBasket(table, entity);
        } else {
            renderLooseItem(table, entity);
        }
    });
}

function renderBasket(container, basketData) {
    const wrapper = document.createElement('div');
    wrapper.className = 'placed-item basket-wrapper';

    // Position
    const left = 300 + basketData.x - 50; // Basket is approx 100x100? SVG is 100x100
    const top = 300 + basketData.y - 50;

    wrapper.style.left = `${left}px`;
    wrapper.style.top = `${top}px`;
    wrapper.style.width = '100px';
    wrapper.style.height = '100px';
    wrapper.style.transform = `rotate(${basketData.rotation}deg)`;
    wrapper.style.cursor = 'grab';

    // Visual State Logic
    const itemCount = basketData.contents.length;
    if (itemCount >= BASKET_CAPACITY) {
        wrapper.classList.add('basket-full');
    } else {
        wrapper.classList.add('basket-dull');
    }

    // 1. Render Basket SVG
    const basketSvg = ITEM_ASSETS.basket; // Assuming this exists now
    // We want the basket BG, then items, then basket rim? 
    // The current SVG likely has BG and Rim in one. 
    // Simply placing items on top is fine for 2D.

    wrapper.innerHTML = basketSvg;

    // 2. Render Contents
    const contentContainer = document.createElement('div');
    contentContainer.style.position = 'absolute';
    contentContainer.style.top = '0';
    contentContainer.style.left = '0';
    contentContainer.style.width = '100%';
    contentContainer.style.height = '100%';
    contentContainer.style.pointerEvents = 'none'; // Click through to basket for dragging

    basketData.contents.forEach((c, index) => {
        const itemDef = ITEMS.find(i => i.id === c.itemId);
        if (!itemDef) return;

        const itemEl = document.createElement('div');
        itemEl.style.position = 'absolute';
        itemEl.style.width = '60px'; // Items are smaller inside basket
        itemEl.style.height = '60px';

        // Calculate offset based on triforce pattern
        let dx = 0, dy = 0;
        const dist = 20;
        if (index === 0) { dx = 0; dy = -dist; }
        else if (index === 1) { dx = dist; dy = dist / 2; }
        else if (index === 2) { dx = -dist; dy = dist / 2; }

        // Center is 50,50. Item center is 30,30
        const ix = 50 + dx - 30;
        const iy = 50 + dy - 30;

        itemEl.style.left = `${ix}px`;
        itemEl.style.top = `${iy}px`;
        itemEl.style.transform = `rotate(${c.rotation}deg)`;
        itemEl.innerHTML = itemDef.asset;

        contentContainer.appendChild(itemEl);
    });

    wrapper.appendChild(contentContainer);

    // Drag Logic
    enableDrag(wrapper, basketData);

    container.appendChild(wrapper);
}

function renderLooseItem(container, itemData) {
    const itemDef = ITEMS.find(i => i.id === itemData.itemId);
    if (!itemDef) return;

    const el = document.createElement('div');
    el.className = 'placed-item';
    el.innerHTML = itemDef.asset;

    // Sizing
    const size = 80;
    const offset = size / 2;

    const left = 300 + itemData.x - offset;
    const top = 300 + itemData.y - offset;

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.transform = `rotate(${itemData.rotation}deg)`;
    el.style.cursor = 'grab';

    enableDrag(el, itemData);

    container.appendChild(el);
}

function autoOrganizeBanquet() {
    if (placedItems.length === 0) {
        speak("Table is empty! Buy something first.");
        return;
    }

    // 1. Recover all items
    let allDimSum = [];
    let allTableware = [];

    placedItems.forEach(entity => {
        if (entity.type === 'basket') {
            // Extract contents
            entity.contents.forEach(c => {
                // We need to look up the item def to check type? 
                // Actually we stored itemId. Let's assume all in basket were dimsum.
                // But better to check.
                const def = ITEMS.find(i => i.id === c.itemId);
                if (def) allDimSum.push(def);
            });
        } else {
            // Loose item
            const def = ITEMS.find(i => i.id === entity.itemId);
            if (def) {
                if (def.type === 'dimsum') allDimSum.push(def);
                else allTableware.push(def);
            }
        }
    });

    // 2. Clear current
    placedItems = [];

    // 3. Re-distribute Dim Sum into Baskets (groups of 3)
    // Sort by Item ID to group identical items
    allDimSum.sort((a, b) => a.id.localeCompare(b.id));

    while (allDimSum.length > 0) {
        const currentType = allDimSum[0].id;
        // Get all items of this type
        const typeBatch = allDimSum.filter(i => i.id === currentType);
        // Remove them from main list
        allDimSum = allDimSum.filter(i => i.id !== currentType);

        // Retrieve chunks of BASKET_CAPACITY
        while (typeBatch.length > 0) {
            const chunk = typeBatch.splice(0, BASKET_CAPACITY);
            const basket = createBasket();
            chunk.forEach(item => {
                basket.contents.push({
                    itemId: item.id,
                    rotation: Math.random() * 360
                });
            });
            placedItems.push(basket);
        }
    }

    // 4. Re-add Tableware
    allTableware.forEach(item => {
        placedItems.push({
            id: 'item-' + Date.now() + Math.random(),
            type: 'loose',
            itemId: item.id,
            x: 0, y: 0, // Placeholder
            rotation: Math.random() * 360
        });
    });

    // 5. Layout Algorithm (Spiral or Grid)
    // Center of table is 0,0 (relative to 300,300 center point in our coord system? 
    // No, our stored x,y are offsets from center 300,300.

    // Arrange Baskets in inner circle/grid
    const baskets = placedItems.filter(i => i.type === 'basket');
    const loose = placedItems.filter(i => i.type !== 'basket');

    // Layout Baskets
    if (baskets.length > 0) {
        // Spiral layout
        let angle = 0;
        let radius = 0;
        const step = 0.5; // Angle step
        const dist = 110; // Distance between items approx

        baskets.forEach((b, i) => {
            if (i === 0) {
                b.x = 0; b.y = 0; // Center first one
            } else {
                // Simple circle packing or just random rings?
                // Let's do a simple ring placement logic
                // Max 6 in first ring (radius 120), then rest in second (radius 220)

                if (i <= 6) {
                    const ringAngle = ((i - 1) / 6) * Math.PI * 2;
                    b.x = Math.cos(ringAngle) * 120;
                    b.y = Math.sin(ringAngle) * 120;
                } else {
                    const ringAngle = ((i - 7) / 12) * Math.PI * 2;
                    b.x = Math.cos(ringAngle) * 220;
                    b.y = Math.sin(ringAngle) * 220;
                }
            }
        });
    }

    // Layout Loose Items (in gaps or outer ring)
    if (loose.length > 0) {
        loose.forEach((l, i) => {
            // Place in outer ring
            const ringAngle = (i / loose.length) * Math.PI * 2;
            const r = 240 + (i % 2) * 40; // Zigzag radius 240-280
            l.x = Math.cos(ringAngle) * r;
            l.y = Math.sin(ringAngle) * r;
        });
    }

    saveProgress();
    renderBanquet();
    playDing();
    speak("Table organized! So tidy.");
}

function enableDrag(el, itemData) {
    let isDragging = false;
    let startX, startY;
    let initialLeft, initialTop;

    const onMouseDown = (e) => {
        // Support touch?
        const clientX = e.clientX || e.touches[0].clientX;
        const clientY = e.clientY || e.touches[0].clientY;

        isDragging = true;
        startX = clientX;
        startY = clientY;

        initialLeft = parseFloat(el.style.left);
        initialTop = parseFloat(el.style.top);

        el.style.cursor = 'grabbing';
        el.style.zIndex = 1000;
        document.body.style.userSelect = 'none';

        e.stopPropagation(); // Prevent bg click
    };

    const onMouseMove = (e) => {
        if (!isDragging) return;

        const clientX = e.clientX || (e.touches ? e.touches[0].clientX : 0);
        const clientY = e.clientY || (e.touches ? e.touches[0].clientY : 0);

        const dx = clientX - startX;
        const dy = clientY - startY;

        let newLeft = initialLeft + dx;
        let newTop = initialTop + dy;

        el.style.left = `${newLeft}px`;
        el.style.top = `${newTop}px`;
    };

    const onMouseUp = (e) => {
        if (!isDragging) return;
        isDragging = false;
        el.style.cursor = 'grab';
        el.style.zIndex = '';
        document.body.style.userSelect = '';

        // Save new position
        const finalLeft = parseFloat(el.style.left);
        const finalTop = parseFloat(el.style.top);

        // Calculate offset (Assuming 100 for basket, 80 for loose)
        // We know the offset used in render. 
        // We can just store 'x' as (finalLeft - 300 + offset)
        // Let's deduce offset from current size or re-calculate.
        const width = el.getBoundingClientRect().width;
        const offset = width / 2;

        itemData.x = finalLeft + offset - 300;
        itemData.y = finalTop + offset - 300;

        saveProgress();
    };

    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    // Touch support basic
    el.addEventListener('touchstart', onMouseDown);
    window.addEventListener('touchmove', onMouseMove);
    window.addEventListener('touchend', onMouseUp);
}

// Persistence
function saveProgress() {
    const data = {
        totalScore,
        playedRounds,
        revealedAnswers,
        dumplingDollars,
        placedItems,
        currentLevel, // Save level
        speechRate, // Save speech rate preference
        selectedVoiceURI, // Save voice preference
        questionHistory, // Save question attempt history
        waveformEnabled // Save waveform preference
    };
    localStorage.setItem('dimSumData', JSON.stringify(data));
}

function loadProgress() {
    const saved = localStorage.getItem('dimSumData');
    if (saved) {
        try {
            const data = JSON.parse(saved);
            totalScore = data.totalScore || 0;
            playedRounds = data.playedRounds || [];
            revealedAnswers = data.revealedAnswers || [];
            dumplingDollars = (data.dumplingDollars !== undefined) ? data.dumplingDollars : 500;
            placedItems = data.placedItems || [];
            currentLevel = (data.currentLevel !== undefined) ? data.currentLevel : 0; // Load level
            speechRate = (data.speechRate !== undefined) ? data.speechRate : 1.0; // Load rate
            selectedVoiceURI = data.selectedVoiceURI || 'auto'; // Load voice
            questionHistory = data.questionHistory || {}; // Load question history
            waveformEnabled = (data.waveformEnabled !== undefined) ? data.waveformEnabled : true; // Load waveform preference, default to true
            return true;
        } catch (e) {
            console.error("Save Load Error", e);
            return false;
        }
    }
    return false;
}

function init() {
    // Load Save Data
    const hasSave = loadProgress();

    MusicPlayer.init(); // Init Music
    initShop(); // Init Shop
    renderBanquet(); // Init Banquet (Mini Mode)

    // Hide mic initially
    if (micBtn) micBtn.classList.add('hidden');


    // Banquet Table Click -> Full Mode
    const banquetArea = document.getElementById('banquet-area');
    if (banquetArea) {
        banquetArea.onclick = (e) => {
            // Only expand if clicking the AREA or TABLE, not buttons inside
            if (e.target.closest('button') || e.target.closest('.placed-item')) return;

            // If already full mode, do nothing (buttons handle exit)
            // Or maybe click background to exit?
            if (!banquetArea.classList.contains('full-mode')) {
                switchView('banquet');
            }
        };
    }

    loadVoices();
    renderSidebar(); // This renders the list but doesn't auto-start

    // Update score displays with loaded values
    if (hasSave && totalScore > 0) {
        scoreDisplays.forEach(el => el.textContent = totalScore);
    }
    // Update level display
    if (LEVEL_DISPLAY) {
        LEVEL_DISPLAY.textContent = currentLevel;
    }

    // Home Button logic
    const homeBtn = document.getElementById('home-btn');

    // Speed Toggle Logic
    const speedSwitch = document.getElementById('speed-switch');
    const speedLabel = document.getElementById('speed-label');

    if (speedSwitch) {
        // Set initial state based on loaded data
        const isTurtle = speechRate < 1.0;
        speedSwitch.checked = isTurtle;
        if (speedLabel) speedLabel.textContent = isTurtle ? 'Turtle Mode 🐢' : 'Rabbit Mode 🐰';

        speedSwitch.onchange = () => {
            if (speedSwitch.checked) {
                speechRate = 0.7; // Slow
                if (speedLabel) speedLabel.textContent = 'Turtle Mode 🐢';
                speak("Turtle mode activated. Slow and steady, dear.");
            } else {
                speechRate = 1.0; // Normal
                if (speedLabel) speedLabel.textContent = 'Rabbit Mode 🐰';
                speak("Rabbit mode activated. Hop hop hop!");
            }
            saveProgress();
        };
    }

    // Tiger Mom Toggle Logic
    const tigerSwitch = document.getElementById('tiger-switch');
    const tigerLabel = document.getElementById('tiger-label');
    if (tigerSwitch) {
        tigerSwitch.onchange = () => {
            tigerMomMode = tigerSwitch.checked;
            if (tigerMomMode) {
                if (tigerLabel) tigerLabel.textContent = 'Tiger Mode 🐯';
                speak("Aiya. Finally. Now we play seriously.", false, null, false);
            } else {
                if (tigerLabel) tigerLabel.textContent = 'Tiger Mom 🐯';
                speak("Okay, back to nice mode.", false, null, false);
            }
        };
    }

    // Waveform Toggle Logic
    const waveformSwitch = document.getElementById('waveform-switch');
    if (waveformSwitch) {
        waveformSwitch.checked = waveformEnabled;
        waveformSwitch.onchange = () => {
            waveformEnabled = waveformSwitch.checked;
            saveProgress();
            if (waveformEnabled) {
                speak("Waveform visualizer enabled! 🌊");
            } else {
                stopWaveform();
            }
        };
    }

    if (homeBtn) {
        homeBtn.onclick = () => {
            const startScreen = document.getElementById('start-screen');
            if (startScreen) {
                startScreen.style.display = 'flex';
                setTimeout(() => {
                    startScreen.style.opacity = '1';
                }, 10);
            }
        };
    }

    // UI Events
    // Language switching removed - Cantonese only
    if (manualInput) {
        manualInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                handleInput(manualInput.value);
                manualInput.value = '';
            }
        });
    }

    setupSpeechRecognition();
    if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = loadVoices;
    }

    // Sidebar Toggle Logic
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebarClose = document.getElementById('sidebar-close');
    const sidebar = document.querySelector('.sidebar');

    if (sidebarToggle && sidebar) {
        sidebarToggle.onclick = () => {
            sidebar.classList.toggle('open');
            playBong(600, 0.1);
        };
    }

    if (sidebarClose && sidebar) {
        sidebarClose.onclick = () => {
            sidebar.classList.remove('open');
            playBong(400, 0.1);
        };
    }

    // Auto-close sidebar on click outside
    document.addEventListener('click', (e) => {
        if (sidebar && sidebar.classList.contains('open')) {
            // Check if click was outside sidebar AND outside the toggle button
            if (!sidebar.contains(e.target) && !sidebarToggle.contains(e.target)) {
                sidebar.classList.remove('open');
                playBong(400, 0.1);
            }
        }
    });

    // Toggle Mic -> Hold Mic
    if (micBtn) {
        const newBtn = micBtn.cloneNode(true);
        micBtn.parentNode.replaceChild(newBtn, micBtn);
        micBtn = newBtn; // Update reference


        // CLICK TOGGLE (Replaces Press & Hold)
        newBtn.onclick = (e) => {
            e.preventDefault();
            toggleListening();
        };

        // Remove old hold listeners (Clean up just in case, though replacements wiped them)
        // No need to add mousedown/mouseup listeners

    }



    // Start Screen Logic
    const startBtn = document.getElementById('start-game-btn');
    const startScreen = document.getElementById('start-screen');
    const welcomeBackMsg = document.getElementById('welcome-back-msg');
    const careerScoreVal = document.getElementById('career-score-val');

    // Update Start Screen if Returning User
    if (hasSave && totalScore > 0 && welcomeBackMsg) {
        welcomeBackMsg.classList.remove('hidden');
        if (careerScoreVal) careerScoreVal.textContent = totalScore;
        if (startBtn) startBtn.textContent = "Continue Lunch";
    }

    if (startBtn) {
        startBtn.onclick = () => {
            // 1. Hide Screen (Faster fade)
            startScreen.style.opacity = '0';
            setTimeout(() => {
                startScreen.style.display = 'none';
            }, 300); // 500 -> 300ms

            // 2. Resume Audio Context
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
                const ctx = new AudioContext();
                ctx.resume();
            }

            // 3. Play Start Sound (Shorter)
            playBong(600, 0.2);

            // Open Sidebar - REMOVED per user request
            // const sidebar = document.querySelector('.sidebar');
            // if (sidebar) sidebar.classList.add('open');

            // Set Level from UI
            const activeDiff = document.querySelector('.diff-btn.active');
            if (activeDiff) {
                currentLevel = parseInt(activeDiff.getAttribute('data-level'));
                updateLevelUI();
            }

            // 4. Start Game Logic
            nextRandomRound(); // Use nextRandomRound to respect difficulty
        };
    }

    // New: Start Screen Shop Button
    const startShopBtn = document.getElementById('start-shop-btn');
    if (startShopBtn) {
        startShopBtn.onclick = () => {
            // Hide start screen temporarily or just overlay?
            // Since banquet is full screen opaque, we can just show it.
            // But we need z-index > start-screen (2000).
            openShopFrom('start');
        };
    }

    // New: Summary Screen Shop Button
    const summaryShopBtn = document.getElementById('summary-shop-btn');
    if (summaryShopBtn) {
        summaryShopBtn.onclick = () => {
            openShopFrom('summary');
        };
    }

    // Difficulty Button Listeners
    if (DIFF_BTNS) {
        DIFF_BTNS.forEach(btn => {
            btn.addEventListener('click', () => {
                DIFF_BTNS.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const level = parseInt(btn.getAttribute('data-level'));
                updateStartScreenDesc(level);
                playBong(500 + (level * 50), 0.1);
            });
        });
    }

    // Avatar Blink Loop
    setInterval(() => {
        const eyes = document.querySelectorAll('.eyes circle');
        eyes.forEach(eye => {
            eye.style.transform = 'scaleY(0.1)';
            eye.style.transition = 'transform 0.1s';
            setTimeout(() => {
                eye.style.transform = 'scaleY(1)';
            }, 100);
        });
    }, 4000 + Math.random() * 2000); // Random blink every 4-6s

    // Attach View Progress Listener
    const historyBtn = document.getElementById('view-history-btn');
    if (historyBtn) {
        historyBtn.onclick = showProgressHistoryList;
    }
}

function updateLevelUI() {
    if (LEVEL_DISPLAY) {
        LEVEL_DISPLAY.textContent = currentLevel;
        LEVEL_DISPLAY.classList.add('pop');
        setTimeout(() => LEVEL_DISPLAY.classList.remove('pop'), 500);
    }
}

function updateStartScreenDesc(level) {
    if (DIFF_DESC) {
        DIFF_DESC.textContent = DIFFICULTY_DESCS[level];
    }
}

function handleResponsiveLayout() {
    const leftControls = document.querySelector('.left-controls');
    const sidebarSettings = document.getElementById('sidebar-settings');
    const commandBar = document.querySelector('.command-bar');

    if (!leftControls || !sidebarSettings || !commandBar) return;

    if (window.innerWidth <= 640) {
        if (!sidebarSettings.contains(leftControls)) {
            sidebarSettings.appendChild(leftControls);
        }
    } else {
        if (!commandBar.contains(leftControls)) {
            // Re-insert before the mic button
            const micBtn = document.getElementById('mic-btn');
            commandBar.insertBefore(leftControls, micBtn);
        }
    }
}

// Start
init();
setTimeout(handleResponsiveLayout, 100);
window.addEventListener('resize', handleResponsiveLayout);

// Auto-open shop if hash present
if (window.location.hash === '#shop') {
    // Wait a moment for init to settle
    setTimeout(() => {
        switchView('shop');
    }, 500);
}

// ========================================================================
// SCORE HISTORY & PROGRESSION CHART
// ========================================================================

function showScoreHistory(answer, history) {
    const modal = document.getElementById('score-history-modal');
    const titleEl = document.getElementById('history-title');
    const canvas = document.getElementById('progression-chart');
    const statsContainer = document.getElementById('history-stats');

    if (!modal || !canvas || !statsContainer) return;

    // Update title
    titleEl.textContent = `Progress: ${answer.canto}`;

    // Draw chart
    const ctx = canvas.getContext('2d');
    drawProgressionChart(ctx, history, canvas.width, canvas.height);

    // Display statistics
    const stats = calculateStats(history);
    const latestItem = history.length > 0 ? history[history.length - 1] : null;
    displayStats(statsContainer, stats, latestItem);

    // Show modal
    modal.classList.remove('hidden');

    // Setup close button
    const closeBtn = document.getElementById('close-history-modal');
    if (closeBtn) {
        closeBtn.onclick = () => modal.classList.add('hidden');
    }

    // Close on background click
    modal.onclick = (e) => {
        if (e.target === modal) {
            modal.classList.add('hidden');
        }
    };
}

function drawProgressionChart(ctx, history, width, height) {
    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    const padding = 50;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(0, 0, width, height);

    // Draw axes
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, height - padding);
    ctx.lineTo(width - padding, height - padding);
    ctx.stroke();

    // Y-axis labels (scores)
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '12px Outfit, sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 100; i += 25) {
        const y = height - padding - (i / 100) * chartHeight;
        ctx.fillText(i.toString(), padding - 10, y + 4);

        // Grid lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(width - padding, y);
        ctx.stroke();
    }

    // X-axis label
    ctx.textAlign = 'center';
    ctx.fillText('Attempts', width / 2, height - 10);

    // Y-axis label
    ctx.save();
    ctx.translate(15, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Score', 0, 0);
    ctx.restore();

    if (history.length === 0) return;

    // Plot data points
    const maxScore = 100;
    const points = history.map((h, i) => ({
        x: padding + (history.length === 1 ? chartWidth / 2 : (i / (history.length - 1)) * chartWidth),
        y: height - padding - (h.score / maxScore) * chartHeight,
        score: h.score
    }));

    // Draw line connecting points
    if (points.length > 1) {
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 3;
        ctx.beginPath();
        points.forEach((p, i) => {
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
    }

    // Draw points and labels
    points.forEach((p, i) => {
        // Point circle
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fill();

        // Inner highlight
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();

        // Score label above point
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px Outfit, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(p.score.toString(), p.x, p.y - 15);

        // Attempt number below
        ctx.fillStyle = '#94a3b8';
        ctx.font = '11px Outfit, sans-serif';
        ctx.fillText(`#${i + 1}`, p.x, height - padding + 20);
    });
}

function calculateStats(history) {
    const scores = history.map(h => h.score);
    const average = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const best = Math.max(...scores);
    const latest = scores[scores.length - 1];
    const improvement = scores.length > 1 ? latest - scores[0] : 0;

    return {
        attempts: history.length,
        average,
        best,
        latest,
        improvement
    };
}

function displayStats(container, stats, latestHistoryItem) {
    let html = `
        <div class="stat-card">
            <div class="stat-label">Attempts</div>
            <div class="stat-value">${stats.attempts}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Average</div>
            <div class="stat-value">${stats.average}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Best</div>
            <div class="stat-value">${stats.best}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Latest</div>
            <div class="stat-value">${stats.latest}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Progress</div>
            <div class="stat-value ${stats.improvement > 0 ? 'positive' : stats.improvement < 0 ? 'negative' : ''}">${stats.improvement > 0 ? '+' : ''}${stats.improvement}</div>
        </div>
    `;

    // Add Breakdown if available from the latest item
    if (latestHistoryItem && latestHistoryItem.metrics) {
        const m = latestHistoryItem.metrics;
        html += `
            <div class="stat-breakdown" style="grid-column: span 3; margin-top: 1rem; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 1rem; text-align: left;">
                <h4 style="margin: 0 0 0.8rem 0; color: #fbbf24; font-size: 0.95rem; font-weight: 600;">Latest Grade Analysis</h4>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem; font-size: 0.9rem;">
                    <div style="display:flex; justify-content:space-between;">
                        <span style="color: #cbd5e1;">Syllables (字準)</span>
                        <span style="color: ${getScoreColor(m.syllableScore)}; font-weight:bold;">${m.syllableScore}%</span>
                    </div>
                    <div style="display:flex; justify-content:space-between;">
                        <span style="color: #cbd5e1;">Tones (音準)</span>
                        <span style="color: ${getScoreColor(m.toneScore)}; font-weight:bold;">${m.toneScore}%</span>
                    </div>
                    <div style="display:flex; justify-content:space-between;">
                        <span style="color: #cbd5e1;">Completeness</span>
                        <span style="color: ${getScoreColor(m.completenessScore)}; font-weight:bold;">${m.completenessScore}%</span>
                    </div>
                    <div style="display:flex; justify-content:space-between;">
                        <span style="color: #cbd5e1;">Spirit (氣勢)</span>
                        <span style="color: ${getScoreColor(m.spiritScore)}; font-weight:bold;">${m.spiritScore}%</span>
                    </div>
                </div>

                <div style="background: rgba(255,255,255,0.05); padding: 0.8rem; border-radius: 8px; margin-top: 1rem; font-style: italic; color: #e2e8f0; border-left: 3px solid #fbbf24;">
                    "${m.feedback}"
                </div>
            </div>
        `;
    }

    container.innerHTML = html;
}

function getScoreColor(score) {
    if (score >= 90) return '#4ade80'; // Green
    if (score >= 70) return '#fbbf24'; // Yellow
    if (score >= 50) return '#f97316'; // Orange
    return '#ef4444'; // Red
}

// Show progress history list for current round
function showProgressHistoryList() {
    console.log("showProgressHistoryList called");
    const modal = document.getElementById('score-history-modal');
    const titleEl = document.getElementById('history-title');
    const canvas = document.getElementById('progression-chart');
    const statsContainer = document.getElementById('history-stats');

    if (!modal || !statsContainer) {
        console.error("Missing modal elements", { modal, statsContainer });
        return;
    }

    // Hide canvas, show list instead
    if (canvas) canvas.style.display = 'none';

    titleEl.textContent = 'Question Progress History';
    statsContainer.innerHTML = ''; // Clear existing

    const listContainer = document.createElement('div');
    listContainer.className = 'history-list';

    // Debug current round
    if (!currentRound) {
        console.error("Current round is undefined");
        return;
    }

    let hasHistory = false;
    currentRound.answers.forEach(ans => {
        const questionKey = `${currentRound.id}_ans_${ans.id}`;
        const history = questionHistory[questionKey];

        if (history && history.length > 0) {
            hasHistory = true;
            const latest = history[history.length - 1].score;
            const attempts = history.length;

            const btn = document.createElement('button');
            btn.className = 'history-list-item';

            btn.innerHTML = `
                <div class="history-item-text">
                    <div class="history-item-chinese">${ans.canto}</div>
                    <div class="history-item-english">${ans.english}</div>
                </div>
                <div class="history-item-stats">
                    <div class="history-item-score">${latest}</div>
                    <div class="history-item-attempts">${attempts} attempt${attempts > 1 ? 's' : ''}</div>
                </div>
            `;

            // Attach listener directly via closure
            btn.onclick = () => {
                showScoreHistory(ans, history);
            };

            listContainer.appendChild(btn);
        }
    });

    if (!hasHistory) {
        statsContainer.innerHTML = '<p style="text-align:center; padding: 2rem; color: #cbd5e1;">No attempts recorded for this round yet.</p>';
    } else {
        statsContainer.appendChild(listContainer);
    }

    modal.classList.remove('hidden');

    const closeBtn = document.getElementById('close-history-modal');
    if (closeBtn) {
        closeBtn.onclick = () => modal.classList.add('hidden');
    }

    modal.onclick = (e) => {
        if (e.target === modal) {
            modal.classList.add('hidden');
        }
    };
}

// Attach global listener for the View Progress button
// We'll also call this from init() just in case, but keeping it here for module load
const viewHistoryBtn = document.getElementById('view-history-btn');
if (viewHistoryBtn) {
    console.log("Attaching listener to view-history-btn");
    viewHistoryBtn.onclick = showProgressHistoryList;
} else {
    console.warn("view-history-btn not found at module load time");
}

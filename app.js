"use strict";

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const scoreValue = document.getElementById("scoreValue");
const levelValue = document.getElementById("levelValue");
const chapterValue = document.getElementById("chapterValue");
const statusBar = document.getElementById("statusBar");

const startModal = document.getElementById("startModal");
const pauseModal = document.getElementById("pauseModal");
const resultModal = document.getElementById("resultModal");

const playButton = document.getElementById("playButton");
const muteButton = document.getElementById("muteButton");
const pauseButton = document.getElementById("pauseButton");
const resumeButton = document.getElementById("resumeButton");
const pauseMenuButton = document.getElementById("pauseMenuButton");

const resultEyebrow = document.getElementById("resultEyebrow");
const resultTitle = document.getElementById("resultTitle");
const resultMessage = document.getElementById("resultMessage");
const resultStars = document.getElementById("resultStars");
const resultScore = document.getElementById("resultScore");

const nextButton = document.getElementById("nextButton");
const retryButton = document.getElementById("retryButton");
const menuButton = document.getElementById("menuButton");
const chapterTabs = document.getElementById("chapterTabs");
const levelSelect = document.getElementById("levelSelect");

const STORAGE_KEY = "colordominion";
const MAX_LEVEL = 105;

const CHAPTERS = [
    { name: "Awakening", color: "#4f8cff" },
    { name: "Ripple", color: "#42d887" },
    { name: "Cascade", color: "#ffd84d" },
    { name: "Aftershock", color: "#ff5364" },
    { name: "Monarch", color: "#ae6cff" },
    { name: "Vortex", color: "#ff8d55" },
    { name: "Dominion", color: "#ffd65a" }
];

const COLORS = [
    { name: "red", fill: "#ff5364", dark: "#a51f3b", glyph: "circle" },
    { name: "blue", fill: "#4f8cff", dark: "#1e4aa9", glyph: "triangle" },
    { name: "green", fill: "#42d887", dark: "#157446", glyph: "square" },
    { name: "yellow", fill: "#ffd84d", dark: "#a76e00", glyph: "diamond" },
    { name: "purple", fill: "#ae6cff", dark: "#6730a7", glyph: "cross" }
];

let width = 0;
let height = 0;
let dpr = 1;

let bubbleRadius = 20;
let bubbleDiameter = 40;
let rowHeight = 34;

let columns = 8;
let boardTop = 14;
let dangerLineY = 0;

let board = [];
let projectile = null;
let nextColor = 0;
let previousGeneratedColor = null;

let score = 0;
let currentLevel = 1;
let selectedLevel = 1;
let selectedChapter = 1;

let gameState = "menu";
let aimActive = false;
let aimX = 0;
let aimY = 0;

let popEffects = [];
let fallingBubbles = [];
let particles = [];

let celebrationActive = false;
let celebrationElapsed = 0;
const CELEBRATION_DURATION = 1.5;

let pendingWinResult = false;
let lastFrameTime = performance.now();

let audioContext = null;
let muted = false;

let saveData = loadSaveData();
muted = Boolean(saveData.muted);
selectedChapter = saveData.selectedChapter;

/* Create a safe default save object. */
function createDefaultSave() {
    return {
        highScore: 0,
        currentLevel: 1,
        levelHighScores: {},
        stars: {},
        muted: false,
        selectedChapter: 1
    };
}

/* Load saved progress from localStorage. */
function loadSaveData() {
    const fallback = createDefaultSave();

    try {
        const raw = localStorage.getItem(STORAGE_KEY);

        if (!raw) {
            return fallback;
        }

        const parsed = JSON.parse(raw);
        const savedChapter = Number(parsed.selectedChapter);

        return {
            highScore: Number(parsed.highScore) || 0,
            currentLevel: clamp(Number(parsed.currentLevel) || 1, 1, 105),
            levelHighScores: parsed.levelHighScores || {},
            stars: parsed.stars || {},
            muted: typeof parsed.muted === "boolean" ? parsed.muted : false,
            selectedChapter:
                Number.isInteger(savedChapter) &&
                savedChapter >= 1 &&
                savedChapter <= 7
                    ? savedChapter
                    : 1
        };
    } catch (error) {
        return fallback;
    }
}

/* Save progress to localStorage. */
function saveProgress() {
    try {
        saveData.muted = muted;
        saveData.selectedChapter = selectedChapter;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(saveData));
    } catch (error) {
        console.warn("Color Dominion progress could not be saved.", error);
    }
}

/* Restrict a number to a range. */
function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

/* Return a random integer below a maximum. */
function randomInt(maximum) {
    return Math.floor(Math.random() * maximum);
}

/* Lazily create the Web Audio context after a user gesture. */
function ensureAudioContext() {
    try {
        if (!audioContext) {
            const AudioContextClass =
                window.AudioContext ||
                window.webkitAudioContext;

            if (!AudioContextClass) {
                return;
            }

            audioContext = new AudioContextClass();
            if (navigator.audioSession) { navigator.audioSession.type = "playback"; }
        }

        if (audioContext.state === "suspended") {
            const resumePromise = audioContext.resume();

            if (
                resumePromise &&
                typeof resumePromise.catch === "function"
            ) {
                resumePromise.catch(function () {
                    return;
                });
            }
        }
    } catch (error) {
        console.warn("Color Dominion audio could not be initialized.", error);
    }
}

/* Play one bright cartoon spring "toiiiiiing" when a cluster pops. */
function playJellyBonk(clusterSize) {
    if (muted || !audioContext) {
        return;
    }

    try {
        if (audioContext.state !== "running") {
            return;
        }

        const now = audioContext.currentTime;
        const sizeAmount = clamp((clusterSize - 3) / 7, 0, 1);
        const pitchScale = 1 - sizeAmount * 0.12;
        const volumeScale = 0.85 + sizeAmount * 0.25;

        const out = audioContext.createGain();

        out.gain.setValueAtTime(0.55 * volumeScale, now);
        out.connect(audioContext.destination);

        createSpringPluck(now, pitchScale, out);
        createSpringRing(now + 0.01, pitchScale, out);
    } catch (error) {
        console.warn("Color Dominion spring sound could not play.", error);
    }
}

/* Bright plucked attack: quick upward bend into the note. */
function createSpringPluck(startTime, pitchScale, destination) {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = "triangle";

    oscillator.frequency.setValueAtTime(700 * pitchScale, startTime);
    oscillator.frequency.exponentialRampToValueAtTime(
        1100 * pitchScale,
        startTime + 0.07
    );

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(0.45, startTime + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.14);

    oscillator.connect(gain);
    gain.connect(destination);

    oscillator.start(startTime);
    oscillator.stop(startTime + 0.16);
}

/* Long ringing spring tail with vibrato — the "iiiiiing". */
function createSpringRing(startTime, pitchScale, destination) {
    const ringDuration = 0.5;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const shimmer = audioContext.createOscillator();
    const shimmerGain = audioContext.createGain();
    const lfo = audioContext.createOscillator();
    const lfoGain = audioContext.createGain();

    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(1100 * pitchScale, startTime);

    shimmer.type = "sine";
    shimmer.frequency.setValueAtTime(2200 * pitchScale, startTime);

    lfo.type = "sine";
    lfo.frequency.setValueAtTime(7, startTime);
    lfoGain.gain.setValueAtTime(18, startTime);
    lfo.connect(lfoGain);
    lfoGain.connect(oscillator.frequency);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(0.32, startTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(
        0.0001,
        startTime + ringDuration
    );

    shimmerGain.gain.setValueAtTime(0.0001, startTime);
    shimmerGain.gain.linearRampToValueAtTime(0.09, startTime + 0.01);
    shimmerGain.gain.exponentialRampToValueAtTime(
        0.0001,
        startTime + ringDuration * 0.8
    );

    oscillator.connect(gain);
    gain.connect(destination);
    shimmer.connect(shimmerGain);
    shimmerGain.connect(destination);

    oscillator.start(startTime);
    oscillator.stop(startTime + ringDuration + 0.05);
    shimmer.start(startTime);
    shimmer.stop(startTime + ringDuration + 0.05);
    lfo.start(startTime);
    lfo.stop(startTime + ringDuration + 0.05);
}

/* Play a soft rising whoosh when the player fires a bubble. */
function playShootSound() {
    if (muted || !audioContext || audioContext.state !== "running") {
        return;
    }

    try {
        const now = audioContext.currentTime;
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const filter = audioContext.createBiquadFilter();
        const airyOscillator = audioContext.createOscillator();
        const airyGain = audioContext.createGain();

        oscillator.type = "triangle";
        oscillator.frequency.setValueAtTime(220, now);
        oscillator.frequency.exponentialRampToValueAtTime(660, now + 0.09);

        filter.type = "lowpass";
        filter.frequency.setValueAtTime(1800, now);
        filter.frequency.exponentialRampToValueAtTime(4200, now + 0.09);

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.18, now + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

        airyOscillator.type = "sine";
        airyOscillator.frequency.setValueAtTime(440, now);
        airyOscillator.frequency.exponentialRampToValueAtTime(1320, now + 0.09);

        airyGain.gain.setValueAtTime(0.0001, now);
        airyGain.gain.linearRampToValueAtTime(0.072, now + 0.008);
        airyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

        oscillator.connect(filter);
        filter.connect(gain);
        gain.connect(audioContext.destination);

        airyOscillator.connect(airyGain);
        airyGain.connect(audioContext.destination);

        oscillator.start(now);
        oscillator.stop(now + 0.15);
        airyOscillator.start(now);
        airyOscillator.stop(now + 0.15);
    } catch (error) {
        console.warn("Color Dominion shoot sound could not play.", error);
    }
}

/* Play a light pitched tick when a fired bubble attaches to the grid. */
function playAttachSound() {
    if (muted || !audioContext || audioContext.state !== "running") {
        return;
    }

    try {
        const now = audioContext.currentTime;
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();

        oscillator.type = "triangle";
        oscillator.frequency.setValueAtTime(520, now);

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.22, now + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);

        oscillator.connect(gain);
        gain.connect(audioContext.destination);

        oscillator.start(now);
        oscillator.stop(now + 0.055);
    } catch (error) {
        console.warn("Color Dominion attach sound could not play.", error);
    }
}

/* Play a descending whoosh when unsupported bubbles drop away. */
function playDropSound(droppedCount) {
    if (muted || !audioContext || audioContext.state !== "running") {
        return;
    }

    try {
        const now = audioContext.currentTime;
        const pitchScale = droppedCount > 5 ? 1.15 : 1;
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const bodyOscillator = audioContext.createOscillator();
        const bodyGain = audioContext.createGain();

        oscillator.type = "triangle";
        oscillator.frequency.setValueAtTime(900 * pitchScale, now);
        oscillator.frequency.exponentialRampToValueAtTime(
            240 * pitchScale,
            now + 0.32
        );

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.2, now + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);

        bodyOscillator.type = "triangle";
        bodyOscillator.frequency.setValueAtTime(450 * pitchScale, now);
        bodyOscillator.frequency.exponentialRampToValueAtTime(
            120 * pitchScale,
            now + 0.32
        );

        bodyGain.gain.setValueAtTime(0.0001, now);
        bodyGain.gain.linearRampToValueAtTime(0.1, now + 0.005);
        bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);

        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        bodyOscillator.connect(bodyGain);
        bodyGain.connect(audioContext.destination);

        oscillator.start(now);
        oscillator.stop(now + 0.4);
        bodyOscillator.start(now);
        bodyOscillator.stop(now + 0.4);
    } catch (error) {
        console.warn("Color Dominion drop sound could not play.", error);
    }
}

/* Play a short happy three-note arpeggio when a level is won. */
function playWinSound() {
    if (muted || !audioContext || audioContext.state !== "running") {
        return;
    }

    try {
        const now = audioContext.currentTime;
        const notes = [523, 659, 784];
        const offsets = [0, 0.1, 0.2];

        for (let index = 0; index < notes.length; index += 1) {
            const startTime = now + offsets[index];
            const oscillator = audioContext.createOscillator();
            const gain = audioContext.createGain();

            oscillator.type = "triangle";
            oscillator.frequency.setValueAtTime(notes[index], startTime);

            gain.gain.setValueAtTime(0.0001, startTime);
            gain.gain.linearRampToValueAtTime(0.28, startTime + 0.006);
            gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.22);

            oscillator.connect(gain);
            gain.connect(audioContext.destination);

            oscillator.start(startTime);
            oscillator.stop(startTime + 0.24);
        }
    } catch (error) {
        console.warn("Color Dominion win sound could not play.", error);
    }
}

/* Play a soft descending two-note sigh when a level is lost. */
function playLossSound() {
    if (muted || !audioContext || audioContext.state !== "running") {
        return;
    }

    try {
        const now = audioContext.currentTime;
        const notes = [392, 294];
        const offsets = [0, 0.18];

        for (let index = 0; index < notes.length; index += 1) {
            const startTime = now + offsets[index];
            const oscillator = audioContext.createOscillator();
            const gain = audioContext.createGain();

            oscillator.type = "triangle";
            oscillator.frequency.setValueAtTime(notes[index], startTime);

            gain.gain.setValueAtTime(0.0001, startTime);
            gain.gain.linearRampToValueAtTime(0.22, startTime + 0.008);
            gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.3);

            oscillator.connect(gain);
            gain.connect(audioContext.destination);

            oscillator.start(startTime);
            oscillator.stop(startTime + 0.32);
        }
    } catch (error) {
        console.warn("Color Dominion loss sound could not play.", error);
    }
}

/* Update the mute button icon and accessibility state. */
function updateMuteButton() {
    muteButton.textContent = muted ? "🔇" : "🔊";
    muteButton.setAttribute(
        "aria-label",
        muted ? "Unmute sound" : "Mute sound"
    );
    muteButton.setAttribute(
        "aria-pressed",
        muted ? "true" : "false"
    );
    muteButton.classList.toggle("muted", muted);
}

/* Toggle sound on or off and persist the choice. */
function toggleMute() {
    muted = !muted;

    saveData.muted = muted;
    saveProgress();
    updateMuteButton();
}

/* Resize the canvas for its displayed size and device pixel ratio. */
function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();

    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    updateBoardMetrics();
}

/* Calculate responsive board dimensions. */
function updateBoardMetrics() {
    const targetColumns = width < 390 ? 8 : 9;

    columns = targetColumns;
    bubbleRadius = clamp((width - 16) / (columns * 2 + 1), 16, 22);
    bubbleDiameter = bubbleRadius * 2;
    rowHeight = bubbleRadius * 1.73;
    boardTop = bubbleRadius + 8;
    dangerLineY = height - bubbleRadius * 5.1;
}

/* Return chapter information for an absolute level number. */
function getChapterInfo(levelNumber) {
    const level = clamp(Number(levelNumber) || 1, 1, MAX_LEVEL);
    const chapter = Math.floor((level - 1) / 15) + 1;
    const chapterData = CHAPTERS[chapter - 1];

    return {
        chapter: chapter,
        name: chapterData.name,
        color: chapterData.color
    };
}

/* Return the active level configuration. */
function getLevelConfig() {
    const level = clamp(currentLevel, 1, MAX_LEVEL);
    const chapterInfo = getChapterInfo(level);
    const rowsByChapter = [4, 5, 6, 7, 8, 9, 10];
    const colorsByChapter = [3, 3, 4, 4, 5, 5, 5];
    const base = 900 + (level - 1) * 90;

    return {
        rows: rowsByChapter[chapterInfo.chapter - 1],
        colors: colorsByChapter[chapterInfo.chapter - 1],
        goal: base,
        medium: Math.round(base * 1.35),
        high: Math.round(base * 1.75),
        chapter: chapterInfo.chapter,
        chapterName: chapterInfo.name,
        chapterColor: chapterInfo.color
    };
}

/* Build the chapter tabs and level-selection buttons. */
function buildLevelSelect() {
    chapterTabs.innerHTML = "";
    levelSelect.innerHTML = "";

    for (let chapter = 1; chapter <= CHAPTERS.length; chapter += 1) {
        const chapterData = CHAPTERS[chapter - 1];
        const button = document.createElement("button");

        button.type = "button";
        button.className = "chapter-tab";
        button.textContent =
            "Ch. " +
            chapter +
            " — " +
            chapterData.name;

        if (chapter === selectedChapter) {
            button.classList.add("selected");
        }

        button.addEventListener("click", function () {
            selectedChapter = chapter;
            saveData.selectedChapter = selectedChapter;
            saveProgress();
            buildLevelSelect();
        });

        chapterTabs.appendChild(button);
    }

    const chapterStart = (selectedChapter - 1) * 15 + 1;

    for (let relativeLevel = 1; relativeLevel <= 15; relativeLevel += 1) {
        const absoluteLevel = chapterStart + relativeLevel - 1;
        const button = document.createElement("button");
        const stars =
            Number(saveData.stars[String(absoluteLevel)]) || 0;

        button.type = "button";
        button.className = "level-button";

        if (absoluteLevel === selectedLevel) {
            button.classList.add("selected");
        }

        button.innerHTML =
            '<span class="level-number">' +
            relativeLevel +
            '</span><span class="level-stars">' +
            formatStars(stars) +
            "</span>";

        button.addEventListener("click", function () {
            selectedLevel = absoluteLevel;
            selectedChapter = getChapterInfo(selectedLevel).chapter;
            buildLevelSelect();
        });

        levelSelect.appendChild(button);
    }
}

/* Format a three-star rating for the interface. */
function formatStars(stars) {
    let output = "";

    for (let index = 1; index <= 3; index += 1) {
        output += index <= stars ? "★" : "☆";

        if (index < 3) {
            output += " ";
        }
    }

    return output;
}

/* Start the selected level. */
function startSelectedLevel() {
    selectedChapter = getChapterInfo(selectedLevel).chapter;
    startLevel(selectedLevel);
}

/* Start or restart a level. */
function startLevel(levelNumber) {
    currentLevel = clamp(levelNumber, 1, MAX_LEVEL);
    selectedLevel = currentLevel;
    selectedChapter = getChapterInfo(currentLevel).chapter;

    score = 0;
    projectile = null;
    board = [];

    popEffects = [];
    fallingBubbles = [];
    particles = [];

    aimActive = false;
    celebrationActive = false;
    celebrationElapsed = 0;
    pendingWinResult = false;

    previousGeneratedColor = null;

    generateBoard();

    nextColor = chooseNextColor();

    gameState = "playing";

    startModal.classList.add("hidden");
    pauseModal.classList.add("hidden");
    resultModal.classList.add("hidden");

    updateHud();
    setStatus("Tap or drag to aim");
}

/* Generate the staggered starting board. */
function generateBoard() {
    const config = getLevelConfig();

    for (let row = 0; row < config.rows; row += 1) {
        const rowData = [];

        for (let col = 0; col < columns; col += 1) {
            const shouldLeaveGap =
                row >= 2 &&
                Math.random() < 0.09;

            if (shouldLeaveGap) {
                rowData.push(null);
                continue;
            }

            rowData.push({
                row: row,
                col: col,
                color: randomInt(config.colors)
            });
        }

        board.push(rowData);
    }

    removeImmediateStartingClusters();
}

/* Reduce accidental large starting matches. */
function removeImmediateStartingClusters() {
    for (let row = 0; row < board.length; row += 1) {
        for (let col = 0; col < columns; col += 1) {
            const bubble = getBubble(row, col);

            if (!bubble) {
                continue;
            }

            const cluster = findColorCluster(row, col, bubble.color);

            if (cluster.length >= 3) {
                bubble.color = (bubble.color + 1) % getLevelConfig().colors;
            }
        }
    }
}

/* Update score, level, and chapter labels. */
function updateHud() {
    const chapterInfo = getChapterInfo(currentLevel);

    scoreValue.textContent = String(score);
    levelValue.textContent = "Level " + currentLevel;
    chapterValue.textContent = chapterInfo.name;
}

/* Update the short gameplay instruction. */
function setStatus(message) {
    statusBar.textContent = message;
}

/* Return the board bubble at a coordinate. */
function getBubble(row, col) {
    if (row < 0 || col < 0) {
        return null;
    }

    if (!board[row]) {
        return null;
    }

    return board[row][col] || null;
}

/* Ensure a board row exists. */
function ensureBoardRow(row) {
    while (board.length <= row) {
        board.push(new Array(columns).fill(null));
    }

    if (!board[row]) {
        board[row] = new Array(columns).fill(null);
    }

    while (board[row].length < columns) {
        board[row].push(null);
    }
}

/* Convert a grid coordinate to a canvas position. */
function gridToPixel(row, col) {
    const offset = row % 2 === 1 ? bubbleRadius : 0;
    const usableWidth = columns * bubbleDiameter + bubbleRadius;
    const left = (width - usableWidth) / 2 + bubbleRadius;

    return {
        x: left + col * bubbleDiameter + offset,
        y: boardTop + row * rowHeight
    };
}

/* Find a likely grid cell for a canvas position. */
function pixelToGrid(x, y) {
    let row = Math.max(0, Math.round((y - boardTop) / rowHeight));
    const offset = row % 2 === 1 ? bubbleRadius : 0;
    const usableWidth = columns * bubbleDiameter + bubbleRadius;
    const left = (width - usableWidth) / 2 + bubbleRadius;

    let col = Math.round((x - left - offset) / bubbleDiameter);

    col = clamp(col, 0, columns - 1);

    return {
        row: row,
        col: col
    };
}

/* Return the six hex-grid neighbours of a cell. */
function getNeighborCoordinates(row, col) {
    if (row % 2 === 0) {
        return [
            { row: row, col: col - 1 },
            { row: row, col: col + 1 },
            { row: row - 1, col: col - 1 },
            { row: row - 1, col: col },
            { row: row + 1, col: col - 1 },
            { row: row + 1, col: col }
        ];
    }

    return [
        { row: row, col: col - 1 },
        { row: row, col: col + 1 },
        { row: row - 1, col: col },
        { row: row - 1, col: col + 1 },
        { row: row + 1, col: col },
        { row: row + 1, col: col + 1 }
    ];
}

/* Return all colours currently present on the board. */
function getPresentColors() {
    const present = new Set();

    for (const row of board) {
        for (const bubble of row) {
            if (bubble) {
                present.add(bubble.color);
            }
        }
    }

    return Array.from(present);
}

/* Pick the next projectile colour without unnecessary repeats. */
function chooseNextColor() {
    const presentColors = getPresentColors();

    if (presentColors.length === 0) {
        return randomInt(getLevelConfig().colors);
    }

    let choices = presentColors.slice();

    if (
        choices.length > 1 &&
        previousGeneratedColor !== null
    ) {
        const withoutRepeat = choices.filter(function (color) {
            return color !== previousGeneratedColor;
        });

        if (withoutRepeat.length > 0) {
            choices = withoutRepeat;
        }
    }

    const color = choices[randomInt(choices.length)];

    previousGeneratedColor = color;

    return color;
}

/* Return the shooter's centre position. */
function getShooterPosition() {
    return {
        x: width / 2,
        y: height - bubbleRadius * 2.05
    };
}

/* Convert a pointer event to canvas coordinates. */
function getPointerPosition(event) {
    const rect = canvas.getBoundingClientRect();

    return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
    };
}

/* Begin aiming on pointer down and unlock audio. */
function handlePointerDown(event) {
    ensureAudioContext();

    if (gameState !== "playing" || projectile || celebrationActive) {
        return;
    }

    const point = getPointerPosition(event);

    aimActive = true;
    aimX = point.x;
    aimY = point.y;

    canvas.setPointerCapture(event.pointerId);
}

/* Update the aim direction while dragging. */
function handlePointerMove(event) {
    if (!aimActive || gameState !== "playing") {
        return;
    }

    const point = getPointerPosition(event);

    aimX = point.x;
    aimY = point.y;
}

/* Fire when the player releases the pointer. */
function handlePointerUp(event) {
    if (!aimActive || gameState !== "playing") {
        return;
    }

    const point = getPointerPosition(event);

    aimX = point.x;
    aimY = point.y;
    aimActive = false;

    shootBubble(aimX, aimY);

    if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
    }
}

/* Cancel an unfinished aim gesture. */
function handlePointerCancel() {
    aimActive = false;
}

/* Launch the current bubble toward the selected point. */
function shootBubble(targetX, targetY) {
    if (projectile || celebrationActive) {
        return;
    }

    const shooter = getShooterPosition();

    let dx = targetX - shooter.x;
    let dy = targetY - shooter.y;

    if (dy > -20) {
        dy = -20;
    }

    const length = Math.hypot(dx, dy);

    if (length < 1) {
        return;
    }

    const speed = Math.max(430, height * 0.78);

    projectile = {
        x: shooter.x,
        y: shooter.y,
        vx: dx / length * speed,
        vy: dy / length * speed,
        color: nextColor
    };

    playShootSound();

    nextColor = chooseNextColor();

    setStatus("Match 3+ bubbles");
}

/* Update the moving projectile. */
function updateProjectile(deltaTime) {
    if (!projectile) {
        return;
    }

    projectile.x += projectile.vx * deltaTime;
    projectile.y += projectile.vy * deltaTime;

    if (projectile.x - bubbleRadius <= 0 && projectile.vx < 0) {
        projectile.x = bubbleRadius;
        projectile.vx *= -1;
    }

    if (projectile.x + bubbleRadius >= width && projectile.vx > 0) {
        projectile.x = width - bubbleRadius;
        projectile.vx *= -1;
    }

    if (projectile.y - bubbleRadius <= 0) {
        attachProjectile();
        return;
    }

    const collision = findProjectileCollision();

    if (collision) {
        attachProjectile(collision);
    }
}

/* Find whether the moving bubble has hit a board bubble. */
function findProjectileCollision() {
    const collisionDistance = bubbleDiameter * 0.91;

    for (let row = 0; row < board.length; row += 1) {
        for (let col = 0; col < columns; col += 1) {
            const bubble = getBubble(row, col);

            if (!bubble) {
                continue;
            }

            const position = gridToPixel(row, col);
            const distance = Math.hypot(
                projectile.x - position.x,
                projectile.y - position.y
            );

            if (distance <= collisionDistance) {
                return bubble;
            }
        }
    }

    return null;
}

/* Attach the projectile to the nearest valid empty grid cell. */
function attachProjectile(collidedBubble) {
    if (!projectile) {
        return;
    }

    const projectileColor = projectile.color;
    let target;

    if (collidedBubble) {
        target = findBestEmptyNeighbor(
            collidedBubble.row,
            collidedBubble.col,
            projectile.x,
            projectile.y
        );
    } else {
        target = pixelToGrid(projectile.x, projectile.y);
    }

    if (!target) {
        target = findNearestEmptyCell(projectile.x, projectile.y);
    }

    if (!target) {
        projectile = null;
        finishLoss();
        return;
    }

    ensureBoardRow(target.row);

    board[target.row][target.col] = {
        row: target.row,
        col: target.col,
        color: projectileColor
    };

    playAttachSound();

    projectile = null;

    resolveMatches(target.row, target.col);
}

/* Find the empty neighbour closest to the incoming projectile. */
function findBestEmptyNeighbor(row, col, x, y) {
    const neighbors = getNeighborCoordinates(row, col);
    let best = null;
    let bestDistance = Infinity;

    for (const neighbor of neighbors) {
        if (neighbor.row < 0) {
            continue;
        }

        if (neighbor.col < 0 || neighbor.col >= columns) {
            continue;
        }

        ensureBoardRow(neighbor.row);

        if (getBubble(neighbor.row, neighbor.col)) {
            continue;
        }

        const position = gridToPixel(neighbor.row, neighbor.col);
        const distance = Math.hypot(x - position.x, y - position.y);

        if (distance < bestDistance) {
            bestDistance = distance;
            best = neighbor;
        }
    }

    return best;
}

/* Find the nearest empty cell when direct snapping has no candidate. */
function findNearestEmptyCell(x, y) {
    const approximate = pixelToGrid(x, y);
    let best = null;
    let bestDistance = Infinity;

    const minRow = Math.max(0, approximate.row - 2);
    const maxRow = approximate.row + 2;

    for (let row = minRow; row <= maxRow; row += 1) {
        ensureBoardRow(row);

        for (let col = 0; col < columns; col += 1) {
            if (getBubble(row, col)) {
                continue;
            }

            const position = gridToPixel(row, col);
            const distance = Math.hypot(x - position.x, y - position.y);

            if (distance < bestDistance) {
                bestDistance = distance;
                best = { row: row, col: col };
            }
        }
    }

    return best;
}

/* Resolve matches and unsupported bubbles after a shot. */
function resolveMatches(row, col) {
    const placed = getBubble(row, col);

    if (!placed) {
        return;
    }

    const cluster = findColorCluster(row, col, placed.color);

    if (cluster.length >= 3) {
        popCluster(cluster);

        const dropped = removeDisconnectedBubbles();

        score += cluster.length * 100;
        score += dropped * 150;

        updateHud();
    }

    trimEmptyBottomRows();

    if (isBoardEmpty()) {
        beginWinCelebration();
        return;
    }

    if (hasCrossedDangerLine()) {
        finishLoss();
        return;
    }

    setStatus(cluster.length >= 3 ? "Great shot!" : "Find another match");
}

/* Find a connected cluster of one colour. */
function findColorCluster(startRow, startCol, color) {
    const start = getBubble(startRow, startCol);

    if (!start || start.color !== color) {
        return [];
    }

    const cluster = [];
    const queue = [{ row: startRow, col: startCol }];
    const visited = new Set();

    while (queue.length > 0) {
        const current = queue.shift();
        const key = current.row + ":" + current.col;

        if (visited.has(key)) {
            continue;
        }

        visited.add(key);

        const bubble = getBubble(current.row, current.col);

        if (!bubble || bubble.color !== color) {
            continue;
        }

        cluster.push(bubble);

        const neighbors = getNeighborCoordinates(current.row, current.col);

        for (const neighbor of neighbors) {
            queue.push(neighbor);
        }
    }

    return cluster;
}

/* Pop a matching cluster, create canvas effects, and play one spring sound. */
function popCluster(cluster) {
    try {
        playJellyBonk(cluster.length);
    } catch (error) {
        console.warn("Color Dominion spring sound failed safely.", error);
    }

    for (const bubble of cluster) {
        const position = gridToPixel(bubble.row, bubble.col);

        popEffects.push({
            x: position.x,
            y: position.y,
            color: bubble.color,
            age: 0,
            duration: 0.28
        });

        spawnPopParticles(position.x, position.y, bubble.color);

        board[bubble.row][bubble.col] = null;
    }
}

/* Find and remove bubbles no longer connected to the ceiling. */
function removeDisconnectedBubbles() {
    const connected = new Set();
    const queue = [];

    if (!board[0]) {
        return 0;
    }

    for (let col = 0; col < columns; col += 1) {
        if (getBubble(0, col)) {
            queue.push({ row: 0, col: col });
        }
    }

    while (queue.length > 0) {
        const current = queue.shift();
        const key = current.row + ":" + current.col;

        if (connected.has(key)) {
            continue;
        }

        const bubble = getBubble(current.row, current.col);

        if (!bubble) {
            continue;
        }

        connected.add(key);

        const neighbors = getNeighborCoordinates(current.row, current.col);

        for (const neighbor of neighbors) {
            if (getBubble(neighbor.row, neighbor.col)) {
                queue.push(neighbor);
            }
        }
    }

    let dropped = 0;

    for (let row = 0; row < board.length; row += 1) {
        for (let col = 0; col < columns; col += 1) {
            const bubble = getBubble(row, col);

            if (!bubble) {
                continue;
            }

            const key = row + ":" + col;

            if (!connected.has(key)) {
                const position = gridToPixel(row, col);

                fallingBubbles.push({
                    x: position.x,
                    y: position.y,
                    vy: 20 + Math.random() * 45,
                    rotation: 0,
                    rotationSpeed: (Math.random() - 0.5) * 4,
                    color: bubble.color
                });

                board[row][col] = null;
                dropped += 1;
            }
        }
    }

    if (dropped > 0) {
        playDropSound(dropped);
    }

    return dropped;
}

/* Remove empty rows from the bottom of the board array. */
function trimEmptyBottomRows() {
    while (board.length > 0) {
        const lastRow = board[board.length - 1];
        const hasBubble = lastRow.some(function (bubble) {
            return Boolean(bubble);
        });

        if (hasBubble) {
            break;
        }

        board.pop();
    }
}

/* Check whether the board contains no bubbles. */
function isBoardEmpty() {
    for (const row of board) {
        for (const bubble of row) {
            if (bubble) {
                return false;
            }
        }
    }

    return true;
}

/* Check whether a board bubble has reached the loss line. */
function hasCrossedDangerLine() {
    for (let row = 0; row < board.length; row += 1) {
        for (let col = 0; col < columns; col += 1) {
            if (!getBubble(row, col)) {
                continue;
            }

            const position = gridToPixel(row, col);

            if (position.y + bubbleRadius >= dangerLineY) {
                return true;
            }
        }
    }

    return false;
}

/* Create small particles for a normal bubble pop. */
function spawnPopParticles(x, y, color) {
    for (let index = 0; index < 5; index += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 35 + Math.random() * 70;

        particles.push({
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            color: color,
            age: 0,
            duration: 0.35 + Math.random() * 0.18,
            size: 2 + Math.random() * 3,
            gravity: 40
        });
    }
}

/* Begin the canvas-only win celebration. */
function beginWinCelebration() {
    if (celebrationActive) {
        return;
    }

    playWinSound();

    gameState = "celebrating";
    celebrationActive = true;
    celebrationElapsed = 0;
    pendingWinResult = true;

    spawnCelebrationParticles();

    setStatus("World restored!");
}

/* Spawn celebration particles entirely inside the canvas. */
function spawnCelebrationParticles() {
    const count = 70;

    for (let index = 0; index < count; index += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 55 + Math.random() * 180;

        particles.push({
            x: width / 2 + (Math.random() - 0.5) * width * 0.2,
            y: height * 0.55 + (Math.random() - 0.5) * 40,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 75,
            color: randomInt(COLORS.length),
            age: 0,
            duration: 0.8 + Math.random() * 0.65,
            size: 3 + Math.random() * 5,
            gravity: 150
        });
    }
}

/* Update the win celebration using the animation loop. */
function updateCelebration(deltaTime) {
    if (!celebrationActive) {
        return;
    }

    celebrationElapsed += deltaTime;

    if (celebrationElapsed >= CELEBRATION_DURATION) {
        celebrationActive = false;

        if (pendingWinResult) {
            pendingWinResult = false;
            finishWin();
        }
    }
}

/* Update shrinking bubble-pop effects. */
function updatePopEffects(deltaTime) {
    for (const effect of popEffects) {
        effect.age += deltaTime;
    }

    popEffects = popEffects.filter(function (effect) {
        return effect.age < effect.duration;
    });
}

/* Update unsupported bubbles falling from the board. */
function updateFallingBubbles(deltaTime) {
    for (const bubble of fallingBubbles) {
        bubble.vy += 620 * deltaTime;
        bubble.y += bubble.vy * deltaTime;
        bubble.rotation += bubble.rotationSpeed * deltaTime;
    }

    fallingBubbles = fallingBubbles.filter(function (bubble) {
        return bubble.y - bubbleRadius < height + 50;
    });
}

/* Update particle positions and lifetimes. */
function updateParticles(deltaTime) {
    for (const particle of particles) {
        particle.age += deltaTime;
        particle.vy += particle.gravity * deltaTime;
        particle.x += particle.vx * deltaTime;
        particle.y += particle.vy * deltaTime;
    }

    particles = particles.filter(function (particle) {
        return particle.age < particle.duration;
    });
}

/* Calculate the star rating for a completed level. */
function calculateStars() {
    const config = getLevelConfig();

    if (score >= config.high) {
        return 3;
    }

    if (score >= config.medium) {
        return 2;
    }

    return 1;
}

/* Save a successful level result. */
function saveWinResult(stars) {
    const levelKey = String(currentLevel);
    const oldHighScore = Number(saveData.levelHighScores[levelKey]) || 0;
    const oldStars = Number(saveData.stars[levelKey]) || 0;

    saveData.levelHighScores[levelKey] = Math.max(oldHighScore, score);
    saveData.stars[levelKey] = Math.max(oldStars, stars);
    saveData.highScore = Math.max(Number(saveData.highScore) || 0, score);

    if (currentLevel < MAX_LEVEL) {
        saveData.currentLevel = Math.max(
            Number(saveData.currentLevel) || 1,
            currentLevel + 1
        );
    } else {
        saveData.currentLevel = MAX_LEVEL;
    }

    saveProgress();
}

/* Finish a successful level and show its result modal. */
function finishWin() {
    const stars = calculateStars();

    saveWinResult(stars);

    gameState = "result";

    resultEyebrow.textContent = "LEVEL COMPLETE";
    resultTitle.textContent = "World Restored";
    resultStars.textContent = formatStars(stars);
    resultStars.style.display = "block";
    resultScore.textContent = String(score);

    if (stars === 3) {
        resultMessage.textContent =
            "Magnificent! You restored this world with a masterful score.";
    } else if (stars === 2) {
        resultMessage.textContent =
            "Excellent work. The Dominion is shining brighter.";
    } else {
        resultMessage.textContent =
            "World restored. Replay it anytime to chase more stars.";
    }

    if (currentLevel < MAX_LEVEL) {
        nextButton.textContent = "Next Level";
    } else {
        nextButton.textContent = "Play Again";
    }

    nextButton.style.display = "block";
    retryButton.textContent = "Retry";

    resultModal.classList.remove("hidden");

    buildLevelSelect();
}

/* Finish a failed level and show its result modal. */
function finishLoss() {
    playLossSound();

    gameState = "result";
    projectile = null;
    aimActive = false;

    saveData.highScore = Math.max(Number(saveData.highScore) || 0, score);

    const levelKey = String(currentLevel);
    const previous = Number(saveData.levelHighScores[levelKey]) || 0;

    saveData.levelHighScores[levelKey] = Math.max(previous, score);

    saveProgress();

    resultEyebrow.textContent = "TRY AGAIN";
    resultTitle.textContent = "Stage Lost";
    resultMessage.textContent =
        "The colours reached the danger line. Clear matches higher up and try again.";
    resultStars.textContent = "☆ ☆ ☆";
    resultStars.style.display = "block";
    resultScore.textContent = String(score);

    nextButton.style.display = "none";
    retryButton.textContent = "Retry";

    resultModal.classList.remove("hidden");
}

/* Continue after a successful level. */
function handleNextLevel() {
    if (currentLevel < MAX_LEVEL) {
        selectedChapter = getChapterInfo(currentLevel + 1).chapter;
        startLevel(currentLevel + 1);
    } else {
        selectedChapter = getChapterInfo(1).chapter;
        startLevel(1);
    }
}

/* Retry the current level. */
function retryCurrentLevel() {
    startLevel(currentLevel);
}

/* Pause active gameplay. */
function pauseGame() {
    if (gameState !== "playing") {
        return;
    }

    gameState = "paused";
    aimActive = false;
    pauseModal.classList.remove("hidden");
}

/* Resume paused gameplay. */
function resumeGame() {
    if (gameState !== "paused") {
        return;
    }

    gameState = "playing";
    pauseModal.classList.add("hidden");
}

/* Return to the start menu. */
function showMenu() {
    gameState = "menu";
    projectile = null;
    aimActive = false;
    celebrationActive = false;
    pendingWinResult = false;

    selectedLevel = clamp(
        Number(saveData.currentLevel) || currentLevel || 1,
        1,
        MAX_LEVEL
    );

    selectedChapter = getChapterInfo(selectedLevel).chapter;

    pauseModal.classList.add("hidden");
    resultModal.classList.add("hidden");
    startModal.classList.remove("hidden");

    buildLevelSelect();
    setStatus("Tap or drag to aim");
        }
/* Draw the game background. */
function drawBackground() {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);

    gradient.addColorStop(0, "#111b36");
    gradient.addColorStop(0.58, "#0c1429");
    gradient.addColorStop(1, "#101b38");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    drawAmbientGlow();
    drawWorldGradient();
}

/* Draw subtle ambient light behind the board. */
function drawAmbientGlow() {
    const glow = ctx.createRadialGradient(
        width / 2,
        height * 0.35,
        10,
        width / 2,
        height * 0.35,
        width * 0.65
    );

    glow.addColorStop(0, "rgba(93, 111, 255, 0.11)");
    glow.addColorStop(1, "rgba(93, 111, 255, 0)");

    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
}

/* Draw the faded world glow and its win-restoration animation. */
function drawWorldGradient() {
    const baseY = height * 0.7;
    let progress = 0;

    if (celebrationActive) {
        progress = clamp(
            celebrationElapsed / CELEBRATION_DURATION,
            0,
            1
        );
    }

    const radius = width * (0.42 + progress * 0.55);

    const worldGlow = ctx.createRadialGradient(
        width / 2,
        height + 15,
        5,
        width / 2,
        height + 15,
        radius
    );

    worldGlow.addColorStop(
        0,
        "rgba(255, 216, 77, " + (0.08 + progress * 0.34) + ")"
    );

    worldGlow.addColorStop(
        0.35,
        "rgba(93, 111, 255, " + (0.08 + progress * 0.25) + ")"
    );

    worldGlow.addColorStop(
        0.7,
        "rgba(66, 216, 135, " + (progress * 0.18) + ")"
    );

    worldGlow.addColorStop(1, "rgba(0, 0, 0, 0)");

    ctx.fillStyle = worldGlow;
    ctx.fillRect(0, baseY, width, height - baseY);
}

/* Draw the danger line near the shooter. */
function drawDangerLine() {
    ctx.save();

    ctx.setLineDash([7, 7]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255, 107, 117, 0.45)";

    ctx.beginPath();
    ctx.moveTo(10, dangerLineY);
    ctx.lineTo(width - 10, dangerLineY);
    ctx.stroke();

    ctx.restore();
}

/* Draw every fixed bubble on the board. */
function drawBoard() {
    for (let row = 0; row < board.length; row += 1) {
        for (let col = 0; col < columns; col += 1) {
            const bubble = getBubble(row, col);

            if (!bubble) {
                continue;
            }

            const position = gridToPixel(row, col);

            drawBubble(
                position.x,
                position.y,
                bubble.color,
                bubbleRadius,
                1,
                0
            );
        }
    }
}

/* Draw one plump shiny jelly candy bubble. */
function drawBubble(x, y, colorIndex, radius, alpha, rotation) {
    const color = COLORS[colorIndex];

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(rotation || 0);

    const body = ctx.createRadialGradient(
        -radius * 0.3,
        -radius * 0.35,
        radius * 0.1,
        0,
        0,
        radius
    );

    body.addColorStop(0, "#ffffff");
    body.addColorStop(0.14, color.fill);
    body.addColorStop(0.72, color.fill);
    body.addColorStop(1, color.dark);

    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fillStyle = body;
    ctx.fill();

    const bottomShadow = ctx.createRadialGradient(
        0,
        radius * 0.35,
        radius * 0.05,
        0,
        radius * 0.35,
        radius * 0.9
    );

    bottomShadow.addColorStop(0, "rgba(0, 0, 0, 0)");
    bottomShadow.addColorStop(1, "rgba(0, 0, 0, 0.3)");

    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.98, 0, Math.PI * 2);
    ctx.fillStyle = bottomShadow;
    ctx.fill();

    const shine = ctx.createRadialGradient(
        -radius * 0.35,
        -radius * 0.42,
        radius * 0.02,
        -radius * 0.35,
        -radius * 0.42,
        radius * 0.6
    );

    shine.addColorStop(0, "rgba(255, 255, 255, 0.95)");
    shine.addColorStop(0.3, "rgba(255, 255, 255, 0.4)");
    shine.addColorStop(0.65, "rgba(255, 255, 255, 0.08)");
    shine.addColorStop(1, "rgba(255, 255, 255, 0)");

    ctx.beginPath();
    ctx.arc(
        -radius * 0.35,
        -radius * 0.42,
        radius * 0.6,
        0,
        Math.PI * 2
    );
    ctx.fillStyle = shine;
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(
        0,
        0,
        radius * 0.88,
        Math.PI * 0.15,
        Math.PI * 0.85
    );
    ctx.lineWidth = Math.max(2, radius * 0.16);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.stroke();
    ctx.restore();

    ctx.lineWidth = Math.max(1, radius * 0.07);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";

    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.93, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(
        radius * 0.28,
        -radius * 0.08,
        radius * 0.12,
        0,
        Math.PI * 2
    );
    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    ctx.fill();

    ctx.lineWidth = Math.max(1.2, radius * 0.08);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.22)";

    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.98, 0, Math.PI * 2);
    ctx.stroke();

    drawBubbleGlyph(color.glyph, radius);

    ctx.restore();
}

/* Draw the unique high-contrast glyph for a bubble colour. */
function drawBubbleGlyph(glyph, radius) {
    const size = radius * 0.34;

    ctx.save();

    ctx.lineWidth = Math.max(2, radius * 0.12);
    ctx.strokeStyle = "rgba(20, 24, 38, 0.82)";
    ctx.fillStyle = "rgba(255, 255, 255, 0.82)";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (glyph === "circle") {
        ctx.beginPath();
        ctx.arc(0, 0, size, 0, Math.PI * 2);
        ctx.stroke();
    }

    if (glyph === "triangle") {
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.lineTo(size * 0.9, size * 0.7);
        ctx.lineTo(-size * 0.9, size * 0.7);
        ctx.closePath();
        ctx.stroke();
    }

    if (glyph === "square") {
        ctx.strokeRect(
            -size * 0.78,
            -size * 0.78,
            size * 1.56,
            size * 1.56
        );
    }

    if (glyph === "diamond") {
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.lineTo(size, 0);
        ctx.lineTo(0, size);
        ctx.lineTo(-size, 0);
        ctx.closePath();
        ctx.stroke();
    }

    if (glyph === "cross") {
        ctx.beginPath();
        ctx.moveTo(-size, -size);
        ctx.lineTo(size, size);
        ctx.moveTo(size, -size);
        ctx.lineTo(-size, size);
        ctx.stroke();
    }

    ctx.restore();
}

/* Draw shrinking bubbles after a match. */
function drawPopEffects() {
    for (const effect of popEffects) {
        const progress = clamp(effect.age / effect.duration, 0, 1);
        const scale = 1 - progress;
        const alpha = 1 - progress;

        drawBubble(
            effect.x,
            effect.y,
            effect.color,
            bubbleRadius * scale,
            alpha,
            0
        );
    }
}

/* Draw unsupported bubbles while they fall. */
function drawFallingBubbles() {
    for (const bubble of fallingBubbles) {
        drawBubble(
            bubble.x,
            bubble.y,
            bubble.color,
            bubbleRadius,
            1,
            bubble.rotation
        );
    }
}

/* Draw the moving projectile. */
function drawProjectile() {
    if (!projectile) {
        return;
    }

    drawBubble(
        projectile.x,
        projectile.y,
        projectile.color,
        bubbleRadius,
        1,
        0
    );
}

/* Draw the shooter and enlarged next-bubble preview. */
function drawShooter() {
    const shooter = getShooterPosition();

    ctx.save();

    const baseGradient = ctx.createRadialGradient(
        shooter.x,
        shooter.y + bubbleRadius * 0.9,
        2,
        shooter.x,
        shooter.y + bubbleRadius * 0.9,
        bubbleRadius * 2
    );

    baseGradient.addColorStop(0, "rgba(113, 128, 255, 0.3)");
    baseGradient.addColorStop(1, "rgba(113, 128, 255, 0)");

    ctx.fillStyle = baseGradient;
    ctx.beginPath();
    ctx.arc(
        shooter.x,
        shooter.y + bubbleRadius * 0.8,
        bubbleRadius * 2,
        0,
        Math.PI * 2
    );
    ctx.fill();

    if (!projectile && gameState === "playing") {
        drawBubble(
            shooter.x,
            shooter.y,
            nextColor,
            bubbleRadius * 1.08,
            1,
            0
        );
    }

    drawNextIndicator(shooter.x, shooter.y);

    ctx.restore();
}

/* Draw a pulsing ring and NEXT marker around the upcoming bubble. */
function drawNextIndicator(x, y) {
    if (projectile || gameState !== "playing") {
        return;
    }

    const pulse =
        0.5 +
        0.5 * Math.sin(performance.now() * 0.006);

    ctx.save();

    ctx.lineWidth = 2 + pulse * 1.5;
    ctx.strokeStyle =
        "rgba(255, 216, 77, " +
        (0.55 + pulse * 0.35) +
        ")";

    ctx.beginPath();
    ctx.arc(
        x,
        y,
        bubbleRadius * (1.35 + pulse * 0.08),
        0,
        Math.PI * 2
    );
    ctx.stroke();

    ctx.fillStyle = "rgba(255, 230, 130, 0.9)";
    ctx.font = "800 10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("NEXT", x, y + bubbleRadius * 1.85);

    ctx.beginPath();
    ctx.moveTo(x, y - bubbleRadius * 1.65);
    ctx.lineTo(x - 5, y - bubbleRadius * 1.95);
    ctx.lineTo(x + 5, y - bubbleRadius * 1.95);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
}

/* Draw the player's current aim guide. */
function drawAimLine() {
    if (!aimActive || projectile || gameState !== "playing") {
        return;
    }

    const shooter = getShooterPosition();

    let dx = aimX - shooter.x;
    let dy = aimY - shooter.y;

    if (dy > -20) {
        dy = -20;
    }

    const length = Math.hypot(dx, dy);

    if (length < 1) {
        return;
    }

    dx /= length;
    dy /= length;

    ctx.save();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 8]);

    ctx.beginPath();
    ctx.moveTo(
        shooter.x + dx * bubbleRadius * 1.3,
        shooter.y + dy * bubbleRadius * 1.3
    );

    ctx.lineTo(
        shooter.x + dx * Math.min(height * 0.35, 220),
        shooter.y + dy * Math.min(height * 0.35, 220)
    );

    ctx.stroke();

    ctx.restore();
}

/* Draw all active canvas particles. */
function drawParticles() {
    for (const particle of particles) {
        const progress = clamp(
            particle.age / particle.duration,
            0,
            1
        );

        const alpha = 1 - progress;
        const color = COLORS[particle.color];

        ctx.save();

        ctx.globalAlpha = alpha;
        ctx.fillStyle = color.fill;

        ctx.beginPath();
        ctx.arc(
            particle.x,
            particle.y,
            particle.size * (1 - progress * 0.3),
            0,
            Math.PI * 2
        );
        ctx.fill();

        ctx.restore();
    }
}

/* Draw an extra canvas-only glow during victory. */
function drawCelebrationGlow() {
    if (!celebrationActive) {
        return;
    }

    const progress = clamp(
        celebrationElapsed / CELEBRATION_DURATION,
        0,
        1
    );

    const fade =
        progress < 0.7
            ? 1
            : 1 - (progress - 0.7) / 0.3;

    const gradient = ctx.createRadialGradient(
        width / 2,
        height * 0.55,
        10,
        width / 2,
        height * 0.55,
        width * 0.75
    );

    gradient.addColorStop(
        0,
        "rgba(255, 225, 115, " + (0.22 * fade) + ")"
    );

    gradient.addColorStop(
        0.45,
        "rgba(100, 130, 255, " + (0.16 * fade) + ")"
    );

    gradient.addColorStop(1, "rgba(80, 220, 150, 0)");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
}

/* Render one complete gameplay frame. */
function drawGame() {
    ctx.clearRect(0, 0, width, height);

    drawBackground();
    drawDangerLine();
    drawBoard();
    drawPopEffects();
    drawFallingBubbles();
    drawProjectile();
    drawAimLine();
    drawShooter();
    drawParticles();
    drawCelebrationGlow();
}

/* Update all animation and gameplay state. */
function updateGame(deltaTime) {
    if (gameState === "playing") {
        updateProjectile(deltaTime);
    }

    if (gameState === "playing" || gameState === "celebrating") {
        updatePopEffects(deltaTime);
        updateFallingBubbles(deltaTime);
        updateParticles(deltaTime);
        updateCelebration(deltaTime);
    }
}

/* Run the requestAnimationFrame game loop. */
function gameLoop(timestamp) {
    const rawDelta = (timestamp - lastFrameTime) / 1000;
    const deltaTime = clamp(rawDelta, 0, 0.033);

    lastFrameTime = timestamp;

    updateGame(deltaTime);
    drawGame();

    requestAnimationFrame(gameLoop);
}

/* Handle page visibility so returning to the tab does not create a huge frame step. */
function handleVisibilityChange() {
    lastFrameTime = performance.now();

    if (
        document.hidden &&
        gameState === "playing"
    ) {
        pauseGame();
    }
}

/* Register all interface and input listeners. */
function registerEvents() {
    window.addEventListener("resize", resizeCanvas);

    document.addEventListener(
        "visibilitychange",
        handleVisibilityChange
    );

    canvas.addEventListener(
        "pointerdown",
        handlePointerDown
    );

    canvas.addEventListener(
        "pointermove",
        handlePointerMove
    );

    canvas.addEventListener(
        "pointerup",
        handlePointerUp
    );

    canvas.addEventListener(
        "pointercancel",
        handlePointerCancel
    );

    playButton.addEventListener(
        "click",
        startSelectedLevel
    );

    muteButton.addEventListener(
        "click",
        toggleMute
    );

    pauseButton.addEventListener(
        "click",
        pauseGame
    );

    resumeButton.addEventListener(
        "click",
        resumeGame
    );

    pauseMenuButton.addEventListener(
        "click",
        showMenu
    );

    nextButton.addEventListener(
        "click",
        handleNextLevel
    );

    retryButton.addEventListener(
        "click",
        retryCurrentLevel
    );

    menuButton.addEventListener(
        "click",
        showMenu
    );
}

/* Initialise Color Dominion. */
function initializeGame() {
    selectedLevel = clamp(
        Number(saveData.currentLevel) || 1,
        1,
        MAX_LEVEL
    );

    selectedChapter = getChapterInfo(selectedLevel).chapter;

    resizeCanvas();
    buildLevelSelect();
    registerEvents();
    updateHud();
    updateMuteButton();

    lastFrameTime = performance.now();

    requestAnimationFrame(gameLoop);
}

initializeGame();

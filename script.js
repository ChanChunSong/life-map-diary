// --- CDN Imports ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInWithCustomToken, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, query, orderBy, limit, onSnapshot, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
// ----------------------------------------------------------------------------------

// setLogLevel('Debug'); // Uncomment for detailed console logging

// ----------------------------------------------------------------------------------
// 🔥 PUBLIC CONFIGURATION REQUIRED FOR GITHUB PAGES (PLACE YOUR KEYS HERE) 🔥
const PUBLIC_FIREBASE_CONFIG = {
    apiKey: typeof FIREBASE_API_KEY_SECRET !== 'undefined' ? FIREBASE_API_KEY_SECRET : "YOUR_API_KEY_HERE",
    authDomain: "life-map-diary-logger.firebaseapp.com",
    projectId: "life-map-diary-logger",
    storageBucket: "life-map-diary-logger.firebasestorage.app",
    messagingSenderId: "957220017803",
    appId: "1:957220017803:web:fa3190aac407fd8c0b268e",
    measurementId: "G-Q9N5JKHTQ3"
};
// ----------------------------------------------------------------------------------

let db;
let auth;
let userId = null; 
let unsubscribeHistory = null; 
let loadedEntries = {}; // Global cache for loaded documents keyed by doc.id

// UI elements
const statusMessageEl = document.getElementById('status-message');
const authStatusDisplay = document.getElementById('auth-status-display');
const authButton = document.getElementById('auth-button');
const saveButton = document.getElementById('save-button');
const historyDropdownEl = document.getElementById('history-dropdown');
const historyStatusEl = document.getElementById('history-status');
const workItemsContainer = document.getElementById('work-items-container');
const completedWorkItemsContainer = document.getElementById('completed-work-items-container');
const completedTasksSummaryCount = document.getElementById('completed-tasks-summary-count'); // New UI element

// Check if running in the secure Canvas environment
const isRunningInCanvas = typeof __firebase_config !== 'undefined';

let finalFirebaseConfig = PUBLIC_FIREBASE_CONFIG; // Start with the public keys by default
let finalAppId = PUBLIC_FIREBASE_CONFIG.projectId;
let initialAuthToken = null;

if (isRunningInCanvas) {
    finalFirebaseConfig = JSON.parse(__firebase_config);
    finalAppId = (typeof __app_id !== 'undefined' ? __app_id : 'default-app-id');
    initialAuthToken = (typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null);
} else {
     // If outside canvas, use the provided public config
     finalFirebaseConfig = PUBLIC_FIREBASE_CONFIG;
}

/**
 * Updates the UI based on the user's authentication state.
 * @param {object | null} user - The authenticated Firebase user object or null.
 */
function updateUserUI(user) {
    if (user) {
        const name = user.displayName || user.email;
        authStatusDisplay.textContent = `Signed in as: ${name}`;
        authButton.textContent = "Sign Out";
        authButton.onclick = window.signOutUser;
        saveButton.textContent = "💾 Generate, Save & Copy Entry";
        saveButton.classList.remove('bg-gray-400');
        saveButton.classList.add('bg-green-600', 'hover:bg-green-700');
        saveButton.disabled = false;
        
        // 1. Auto-load the very latest entry immediately (one-time fetch)
        window.loadLatestEntry();
        
        // 2. Start the real-time listener for the history dropdown
        window.loadPastEntries();
    } else {
        authStatusDisplay.textContent = "Please sign in to save data.";
        authButton.textContent = "Sign in with Google";
        authButton.onclick = window.signInWithGoogle;
        saveButton.textContent = "🔐 Please Sign In to Save Entry";
        saveButton.classList.remove('bg-green-600', 'hover:bg-green-700');
        saveButton.classList.add('bg-gray-400');
        saveButton.disabled = true;
        
        // Stop listening and clear history on sign-out
        if (unsubscribeHistory) {
            unsubscribeHistory(); 
            unsubscribeHistory = null;
        }
        historyDropdownEl.innerHTML = '<option value="" disabled selected>Select a past entry...</option>';
        historyStatusEl.textContent = "Sign in to load history...";
        loadedEntries = {}; // Clear cache
    }
    authButton.disabled = false;
}

/**
 * Displays a status message to the user.
 */
function setStatus(message, type = 'info') {
    statusMessageEl.textContent = message;
    statusMessageEl.className = 'w-full max-w-3xl md:max-w-6xl p-3 text-center text-sm font-semibold rounded-t-none';

    if (type === 'success') {
        statusMessageEl.classList.add('bg-green-100', 'text-green-800');
    } else if (type === 'error') {
        statusMessageEl.classList.add('bg-red-100', 'text-red-800');
    } else {
        statusMessageEl.classList.add('bg-yellow-100', 'text-yellow-800');
    }
    statusMessageEl.classList.remove('hidden');
}

/**
 * Initializes Firebase and sets up the authentication listener.
 */
async function initializeFirebase() {
    // Check if public config is still the placeholder (only relevant when NOT in Canvas)
    if (!isRunningInCanvas && finalFirebaseConfig.apiKey === "YOUR_API_KEY_HERE") {
        const localMessage = "⚠️ Storage Disabled: Please replace the placeholder keys in the script with your actual Firebase configuration.";
        setStatus(localMessage, 'error');
        console.error("Firebase Initialization Skipped:", localMessage);
        return;
    }
    
    try {
        const app = initializeApp(finalFirebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        
        // Set up the listener for auth state changes
        onAuthStateChanged(auth, (user) => {
            if (user) {
                userId = user.uid;
                setStatus("Storage ready. Signed in.", 'success');
                updateUserUI(user);
            } else {
                userId = null;
                setStatus("Ready for sign-in.", 'info');
                updateUserUI(null);
            }
        });

        // Only sign in with custom token in the secure canvas environment
        if (isRunningInCanvas && initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        }
        
        // Enable the button and set the status explicitly after init
        authButton.disabled = false;
        if (!auth.currentUser) {
            authStatusDisplay.textContent = "Ready to sign in.";
        }

    } catch (error) {
        setStatus(`Initialization Failed: ${error.message}`, 'error');
        console.error("Firebase Init Error:", error);
        authButton.disabled = true;
        authStatusDisplay.textContent = "Authentication Failed.";
    }
}

/**
 * Handles selection change in the history dropdown.
 */
window.handleHistorySelect = function() {
    const docId = historyDropdownEl.value;
    if (docId && loadedEntries[docId]) {
        const data = loadedEntries[docId];
         // Use custom modal prompt instead of alert/confirm
        const loadConfirmed = window.confirm(`Load entry from ${data.fullDateString} into the current form? Any unsaved changes will be lost.`);
        if (loadConfirmed) {
            loadEntryIntoForm(data);
            setStatus(`Entry from ${data.fullDateString} loaded successfully.`, 'info');
        }
    }
}

/**
 * Loads the single most recent entry into the form (one-time fetch).
 */
window.loadLatestEntry = async function() {
    if (!db || !userId) return;

    try {
        // Query for only the newest entry
        const entriesRef = collection(db, `artifacts/${finalAppId}/users/${userId}/diary_entries`);
        const q = query(entriesRef, orderBy('timestamp', 'desc'), limit(1));
        
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
            const latestEntry = snapshot.docs[0].data();
            const latestDocId = snapshot.docs[0].id; // Get the ID to select in the dropdown
            
            loadEntryIntoForm(latestEntry);
            
            // Set the dropdown to the loaded item's ID
            historyDropdownEl.value = latestDocId;
            
            setStatus(`Latest entry from ${latestEntry.fullDateString} loaded automatically.`, 'info');
        } else {
            setStatus("No previous entries found. Starting fresh.", 'info');
        }
    } catch (error) {
        setStatus(`Error loading latest entry: ${error.message}`, 'error');
        console.error("Firestore Latest Load Error:", error);
    }
}

/**
 * Loads the last 10 entries from Firestore using a real-time listener (onSnapshot).
 */
window.loadPastEntries = function() {
    if (!db || !userId) return;

    // Clear previous listener if it exists
    if (unsubscribeHistory) {
        unsubscribeHistory();
    }

    // Clear dropdown and cache
    historyDropdownEl.innerHTML = '<option value="" disabled selected>Select a past entry...</option>';
    loadedEntries = {};
    historyStatusEl.textContent = "Loading past entries...";
    
    try {
        // 1. Create the query: collection -> order by timestamp descending -> limit to 10
        const entriesRef = collection(db, `artifacts/${finalAppId}/users/${userId}/diary_entries`);
        
        // Querying all docs, ordered by the built-in timestamp field.
        const q = query(entriesRef, orderBy('timestamp', 'desc'), limit(10));

        // 2. Set up the real-time listener
        unsubscribeHistory = onSnapshot(q, (snapshot) => {
            
            // Preserve selected value before clearing to handle real-time updates
            const selectedDocId = historyDropdownEl.value;

            historyDropdownEl.innerHTML = '<option value="" disabled selected>Select a past entry...</option>';
            historyDropdownEl.value = ""; // Ensure nothing is selected
            loadedEntries = {};
            
            if (snapshot.empty) {
                historyStatusEl.textContent = "No past entries found yet. Save one!";
                return;
            }

            historyStatusEl.textContent = `${snapshot.docs.length} recent entries loaded.`;
            
            snapshot.forEach((doc, index) => {
                const data = doc.data();
                const docId = doc.id;
                
                // Cache the data
                loadedEntries[docId] = data;

                // Create the dropdown option
                const option = document.createElement('option');
                option.value = docId;
                option.textContent = `${data.fullDateString} (Day ${data.consecutiveDay})`;
                historyDropdownEl.appendChild(option);
            });
            
            // Re-select the previously selected item, if it exists, or the item loaded by loadLatestEntry
            // Since loadLatestEntry runs first and sets the value, this restores it after the list rebuilds.
            if (loadedEntries[selectedDocId]) {
                historyDropdownEl.value = selectedDocId;
            } else if (historyDropdownEl.value === "") {
                 // Fallback: If nothing is selected, select the newest entry (first one in the list)
                 historyDropdownEl.value = snapshot.docs[0].id;
            }


        }, (error) => {
            historyStatusEl.textContent = `Error loading history: ${error.message}`;
            console.error("Firestore History Error:", error);
        });

    } catch (e) {
        historyStatusEl.textContent = `Error preparing history load: ${e.message}`;
        console.error("Load History Setup Error:", e);
    }
}

/**
 * Creates a single HTML element for a dynamic work item.
 */
function createWorkItemElement(task = { title: '', detail: '', isCompleted: false, createdAt: null, modifiedAt: null }) {
    const container = document.createElement('div');
    
    // Determine classes based on completion status
    let containerClasses = "work-item-container rounded-lg transition-all duration-200";
    let headerClasses = "flex items-start space-x-3";
    let inputClasses = "task-title-input w-full rounded-md focus:ring-blue-500 focus:border-blue-500 font-medium";
    
    // Default to current time if no dates provided (new task)
    const createdAt = task.createdAt || new Date().toISOString();
    const modifiedAt = task.modifiedAt || new Date().toISOString();

    // Calculate display strings
    const createdDateStr = formatDate(createdAt);
    const daysSinceCreated = calculateDaysPassed(createdAt);
    const modifiedDateStr = formatDate(modifiedAt);
    const daysSinceModified = calculateDaysPassed(modifiedAt);

    // Store raw timestamps in data attributes for easy retrieval
    container.dataset.createdAt = createdAt;
    container.dataset.modifiedAt = modifiedAt;

    if (task.isCompleted) {
        // Concise View for Completed Items
        containerClasses += " completed py-2 px-3 bg-gray-50 border-b border-gray-100";
        headerClasses += " mb-0"; // No margin bottom
        inputClasses += " bg-transparent border-none p-0 text-sm text-gray-500 line-through focus:ring-0";
    } else {
        // Standard View for Active Items
        containerClasses += " bg-white border border-gray-200 p-3 shadow-sm";
        headerClasses += " mb-2";
        inputClasses += " p-2 border border-gray-300 text-base";
    }
    
    container.className = containerClasses;
    container.ondblclick = () => toggleTaskDetail(container);

    // --- Swipe Gesture Logic ---
    let touchStartX = 0;
    let touchEndX = 0;
    let touchStartY = 0;
    let touchEndY = 0;

    container.addEventListener('touchstart', (event) => {
        touchStartX = event.changedTouches[0].screenX;
        touchStartY = event.changedTouches[0].screenY;
        console.log('touchstart triggered:', { touchStartX, touchStartY });
    }, { passive: true });

    container.addEventListener('touchend', (event) => {
        touchEndX = event.changedTouches[0].screenX;
        touchEndY = event.changedTouches[0].screenY;
        console.log('touchend triggered:', { touchEndX, touchEndY });
        handleSwipeGesture();
    }, { passive: true });

    function handleSwipeGesture() {
        const deltaX = touchEndX - touchStartX;
        const deltaY = touchEndY - touchStartY;
        console.log('handleSwipeGesture triggered:', { deltaX, deltaY });

        // Trigger swipe if horizontal movement is significant and vertical movement is minimal
        if (Math.abs(deltaX) > 50 && Math.abs(deltaY) < 50) {
            console.log('Swipe detected! Toggling task detail.');
            toggleTaskDetail(container);
        }
    }
    // --- End Swipe Gesture Logic ---

    // Use innerHTML for complex structure, ensuring proper quoting for attributes
    // Note: Detail textarea is hidden by default if completed or initialized as such
    container.innerHTML = `
        <input type="hidden" class="task-created-at" value="${createdAt}">
        <input type="hidden" class="task-modified-at" value="${modifiedAt}">
        <div class="${headerClasses}">
            <input type="text" value="${task.title.replace(/"/g, '&quot;')}" placeholder="Task Title"
                   class="${inputClasses}" ${task.isCompleted ? 'readonly' : ''} oninput="updateModifiedDate(this)">
            <button onclick="toggleCompleted(this); event.stopPropagation();" class="text-green-500 hover:text-green-700 transition duration-150 text-xl font-bold p-1 leading-none" title="${task.isCompleted ? 'Restore Task' : 'Complete Task'}">${task.isCompleted ? '↺' : '✓'}</button>
            <button onclick="removeWorkItem(this); event.stopPropagation();" class="text-red-500 hover:text-red-700 transition duration-150 text-xl font-bold p-1 leading-none" title="Remove Task">&times;</button>
        </div>
        <div class="flex items-center justify-end space-x-2 mb-2 task-controls-container hidden">
            <div class="flex items-center justify-between text-xs text-gray-500 mr-auto ml-1 font-mono w-full sm:w-auto">
                <div class="flex items-center space-x-4">
                    <span class="text-blue-600 metadata-created" title="Created: ${formatDateTime(createdAt)}" data-created-at="${createdAt}">C: ${createdDateStr} (PC: ${daysSinceCreated}D)</span>
                    <span class="text-gray-400">•</span>
                    <span class="text-green-600 metadata-modified" title="Modified: ${formatDateTime(modifiedAt)}" data-modified-at="${modifiedAt}">M: ${modifiedDateStr} (MC: ${daysSinceModified}D)</span>
                </div>
                <button onclick="openDateModal(this); event.stopPropagation();" class="text-gray-400 hover:text-blue-600 transition text-lg ml-4" title="Adjust Timestamps">⚙️</button>
            </div>
            <button onclick="moveWorkItemToTop(this); event.stopPropagation();" class="text-gray-500 hover:text-gray-700 transition duration-150 text-xl font-bold p-1 leading-none" title="Move to Top">⏫</button>
            <button onclick="moveWorkItemUp(this); event.stopPropagation();" class="text-gray-500 hover:text-gray-700 transition duration-150 text-xl font-bold p-1 leading-none" title="Move Up">▲</button>
            <button onclick="moveWorkItemDown(this); event.stopPropagation();" class="text-gray-500 hover:text-gray-700 transition duration-150 text-xl font-bold p-1 leading-none" title="Move Down">▼</button>
            <button onclick="moveWorkItemToBottom(this); event.stopPropagation();" class="text-gray-500 hover:text-gray-700 transition duration-150 text-xl font-bold p-1 leading-none" title="Move to Bottom">⏬</button>
        </div>
        <textarea rows="3" placeholder="Details (steps, progress, next actions...)"
                  class="task-detail-input w-full p-2 border border-gray-300 rounded-md text-sm resize-y focus:ring-blue-500 focus:border-blue-500 hidden" oninput="updateModifiedDate(this)">${task.detail.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
    `;
    return container;
}

/**
 * Moves a work item to the top of the list.
 * @param {HTMLElement} buttonEl - The button element that was clicked.
 */
window.moveWorkItemToTop = function(buttonEl) {
    const container = buttonEl.closest('.work-item-container');
    container.parentNode.prepend(container);
}

/**
 * Moves a work item to the bottom of the list.
 * @param {HTMLElement} buttonEl - The button element that was clicked.
 */
window.moveWorkItemToBottom = function(buttonEl) {
    const container = buttonEl.closest('.work-item-container');
    container.parentNode.appendChild(container);
}

/**
 * Moves a work item up in the list.
 * @param {HTMLElement} buttonEl - The button element that was clicked.
 */
window.moveWorkItemUp = function(buttonEl) {
    const container = buttonEl.closest('.work-item-container');
    if (container.previousElementSibling) {
        container.parentNode.insertBefore(container, container.previousElementSibling);
    }
}

/**
 * Moves a work item down in the list.
 * @param {HTMLElement} buttonEl - The button element that was clicked.
 */
window.moveWorkItemDown = function(buttonEl) {
    const container = buttonEl.closest('.work-item-container');
    if (container.nextElementSibling) {
        container.parentNode.insertBefore(container.nextElementSibling, container);
    }
}

/**
 * Updates the word count display for the reflection entry.
 */
function updateReflectionWordCount() {
    const textarea = document.getElementById('reflection-entry');
    const display = document.getElementById('reflection-word-count');
    if (textarea && display) {
        const text = textarea.value.trim();
        const count = text ? text.split(/\s+/).length : 0;
        display.textContent = `Words: ${count}`;
    }
}

/**
 * Clears and populates the form with data from a loaded entry.
 */
function loadEntryIntoForm(data) {
    // Update Date and Counts
    document.getElementById('date-input').value = data.date;
    document.getElementById('consecutive-day-input').value = data.consecutiveDay;
    document.getElementById('accumulated-count-input').value = data.accumulatedCount;
    window.updateWeekday(); // Ensure the weekday display is updated

    // Update Text Areas
    document.getElementById('reflection-entry').value = data.reflection || '';
    updateReflectionWordCount(); // Update word count
    document.getElementById('life-map-log').value = data.lifeMap || '';
    document.getElementById('week-goals-entry').value = data.weekGoals || '';
    document.getElementById('gamification-notes-entry').value = data.gamificationNotes || '';
    document.getElementById('long-term-plan-entry').value = data.longTermPlan || '';
    document.getElementById('short-term-plan-entry').value = data.shortTermPlan || '';
    document.getElementById('english-practice-entry').value = data.englishPractice || '';
    document.getElementById('japanese-practice-entry').value = data.japanesePractice || '';
    document.getElementById('custom-notes-title').value = data.customNotesTitle || '';
    document.getElementById('custom-notes-entry').value = data.customNotes || '';
    
    // --- Load Dynamic Work Log ---
    workItemsContainer.innerHTML = '';
    completedWorkItemsContainer.innerHTML = ''; // Clear completed container as well

    if (Array.isArray(data.work) && data.work.length > 0) {
        data.work.forEach(task => {
            const taskData = {
                title: task.title || '',
                detail: task.detail || '',
                isCompleted: task.isCompleted || false,
                createdAt: task.createdAt || null,
                modifiedAt: task.modifiedAt || null
            };
            const taskElement = createWorkItemElement(taskData);
            if (taskData.isCompleted) {
                completedWorkItemsContainer.appendChild(taskElement);
            } else {
                workItemsContainer.appendChild(taskElement);
            }
        });
    } else if (data.work && typeof data.work === 'string' && data.work.length > 0) {
        // Backward compatibility for old single-string work log
        const defaultTask = createWorkItemElement({ isCompleted: false, title: 'Previous Work Log (converted)', detail: data.work, createdAt: new Date().toISOString(), modifiedAt: new Date().toISOString() });
        workItemsContainer.appendChild(defaultTask);
    }

    // If after loading, the active container is empty, add one blank item
    if (workItemsContainer.children.length === 0) {
                    workItemsContainer.appendChild(createWorkItemElement());
                }
        
            // After populating, resize all textareas to fit their new content and update the completed task count
            document.querySelectorAll('textarea').forEach(autoResizeTextarea);
            updateCompletedTaskCountDisplay();}

// --- Explicitly attach window functions ---

window.signInWithGoogle = async function() {
    if (!auth) { setStatus("Error: Authentication not initialized.", 'error'); return; }
    try {
        setStatus("Opening Google sign-in window...", 'info');
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
    } catch (error) {
        if (error.code !== 'auth/popup-closed-by-user') {
            setStatus(`Sign-in Failed: ${error.message}`, 'error');
            console.error("Google Sign-in Error:", error);
        } else { setStatus("Sign-in cancelled.", 'info'); }
    }
}

window.signOutUser = async function() {
    if (!auth) return;
    try {
        await signOut(auth);
        setStatus("Successfully signed out.", 'success');
    } catch (error) {
        setStatus(`Sign-out Failed: ${error.message}`, 'error');
        console.error("Sign-out Error:", error);
    }
}

window.changeCount = function(inputId, delta) {
    const input = document.getElementById(inputId);
    let currentValue = parseInt(input.value) || 0;
    let newValue = currentValue + delta;
    
    if (newValue < 1) {
        newValue = 1;
    }
    
    input.value = newValue;
}

window.goToToday = function() {
    const dateInput = document.getElementById('date-input');
    const today = new Date();
    // Format YYYY-MM-DD using local time (or specific timezone if desired, sticking to simple local here)
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    dateInput.value = `${y}-${m}-${d}`;
    window.updateWeekday();
}

window.goToNextDay = async function() {
    const dateInput = document.getElementById('date-input');
    if (!dateInput.value) {
        window.goToToday(); // Fallback if empty
        return;
    }

    // Auto-save current entry before moving
    await window.saveDiaryEntry();
    
    const date = new Date(dateInput.value);
    // Add 1 day
    date.setDate(date.getDate() + 1);
    
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const newDateStr = `${y}-${m}-${d}`;
    dateInput.value = newDateStr;
    
    window.updateWeekday();
    
    // Automatically increment counts
    window.changeCount('consecutive-day-input', 1);
    window.changeCount('accumulated-count-input', 1);

    // Update Dropdown to reflect the new date (current slot)
    const dropdown = document.getElementById('history-dropdown');
    
    // If the new date exists in our loaded history, select it and load the data
    if (loadedEntries[newDateStr]) {
        loadEntryIntoForm(loadedEntries[newDateStr]);
        dropdown.value = newDateStr;
        setStatus(`Moved to next day: ${newDateStr}. Loaded existing entry.`, 'info');
    } else {
        // If it doesn't exist, we just reset the dropdown selection to blank (new entry)
        dropdown.value = "";
        setStatus(`Moved to next day: ${newDateStr}. Ready to log.`, 'info');
    }
}

window.updateWeekday = function() {
    const dateInput = document.getElementById('date-input');
    const weekdayDisplay = document.getElementById('weekday-display');
    const dateValue = dateInput.value; // Format: YYYY-MM-DD

    if (dateValue) {
        const date = new Date(dateValue.replace(/-/g, '/'));
        
        // Format YYYY/MM/DD
        const [year, month, day] = dateValue.split('-');
        const formattedDate = `${year}/${month}/${day}`;
        
        // Get the weekday
        const weekday = date.toLocaleDateString('en-US', { weekday: 'long' });
        
        // Store the full formatted date string for easy retrieval
        const fullDateString = `${formattedDate}, ${weekday}`;
        dateInput.dataset.fullDate = fullDateString;

        weekdayDisplay.textContent = weekday;

        // Update week number
        const weekNumber = getWeekNumber(date);
        document.getElementById('week-goals-header').textContent = `🎯 Week Goals (W${weekNumber})`;
    } else {
        weekdayDisplay.textContent = "";
        dateInput.dataset.fullDate = "";
        document.getElementById('week-goals-header').textContent = `🎯 Week Goals`;
    }
}

/**
 * Calculates the ISO week number for a given date.
 * Source: https://stackoverflow.com/questions/6117814/get-week-of-year-in-javascript-like-in-iso-8601-date-format
 * @param {Date} date - The date to calculate the week number for.
 * @returns {number} The ISO week number.
 */
function getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// --- DYNAMIC WORK LOG FUNCTIONS (Explicitly attached to window) ---
// FIX for ReferenceError on GitHub Pages!
window.addWorkItem = function() {
    workItemsContainer.appendChild(createWorkItemElement());
}

window.updateModifiedDate = function(inputEl) {
    const container = inputEl.closest('.work-item-container');
    if (!container) return;

    const now = new Date().toISOString();
    
    // Update the data attribute
    container.dataset.modifiedAt = now;
    
    // Update the hidden input
    const modifiedInput = container.querySelector('.task-modified-at');
    if (modifiedInput) {
        modifiedInput.value = now;
    }

    // We also need to update the visible metadata text if it's currently showing
    const metadataSpan = container.querySelector('.metadata-modified');
    if (metadataSpan) {
        const modifiedDateStr = formatDate(now);
        const daysSinceModified = calculateDaysPassed(now);
        metadataSpan.textContent = `M: ${modifiedDateStr} (MC: ${daysSinceModified}D)`;
        metadataSpan.title = `Modified: ${formatDateTime(now)}`;
        metadataSpan.dataset.modifiedAt = now; // Keep data attribute in sync
    }
}

/**
 * Updates both Created and Modified dates to the current time.
 * To be used when a task is essentially "reset" or "reassigned" to today.
 */
window.resetTaskDates = function(buttonEl) {
    // We can add a button for this later if requested, or trigger it via specific actions.
    // For now, based on the request "If the task time has a change like task reassign, or reschedule. I need to change the create time and modify time.",
    // The Modal Dialog (Solution 3) already allows manual editing of BOTH dates to achieve this.
    // The user can manually set Created Date to today in the modal.
}

// --- Date Modal Logic ---
let currentEditingContainer = null;

window.openDateModal = function(buttonEl) {
    const container = buttonEl.closest('.work-item-container');
    if (!container) return;
    currentEditingContainer = container;

    // Read from hidden input first, then dataset
    const createdInputEl = container.querySelector('.task-created-at');
    const modifiedInputEl = container.querySelector('.task-modified-at');

    const createdAt = (createdInputEl ? createdInputEl.value : null) || container.dataset.createdAt || new Date().toISOString();
    const modifiedAt = (modifiedInputEl ? modifiedInputEl.value : null) || container.dataset.modifiedAt || new Date().toISOString();

    // Convert ISO string to format required by datetime-local input (YYYY-MM-DDTHH:mm)
    // Note: This input expects local time format. We want to display Taipei Time (UTC+8).
    
    // Helper to format Date for input (Explicitly shift to UTC+8)
    const toTaipeiLocalISO = (isoStr) => {
        const d = new Date(isoStr);
        // UTC time in ms
        const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
        // Taipei is UTC + 8 hours
        const taipeiOffset = 8 * 60 * 60 * 1000;
        const taipeiDate = new Date(utc + taipeiOffset);
        return taipeiDate.toISOString().slice(0, 16); 
    };

    document.getElementById('modal-created-at').value = toTaipeiLocalISO(createdAt);
    document.getElementById('modal-modified-at').value = toTaipeiLocalISO(modifiedAt);

    document.getElementById('date-modal').showModal();
}

window.closeDateModal = function() {
    document.getElementById('date-modal').close();
    currentEditingContainer = null;
}

window.saveDateModal = function() {
    if (!currentEditingContainer) return;

    const createdInput = document.getElementById('modal-created-at').value;
    const modifiedInput = document.getElementById('modal-modified-at').value;

    if (createdInput && modifiedInput) {
        // Convert input (Taipei Time) back to UTC ISO string
        // We append the timezone offset (+08:00) so Date.parse treats it correctly
        const newCreatedAt = new Date(createdInput + ":00+08:00").toISOString();
        const newModifiedAt = new Date(modifiedInput + ":00+08:00").toISOString();

        // Update data attributes
        currentEditingContainer.dataset.createdAt = newCreatedAt;
        currentEditingContainer.dataset.modifiedAt = newModifiedAt;
        
        // Update hidden inputs
        const createdHidden = currentEditingContainer.querySelector('.task-created-at');
        const modifiedHidden = currentEditingContainer.querySelector('.task-modified-at');
        if (createdHidden) createdHidden.value = newCreatedAt;
        if (modifiedHidden) modifiedHidden.value = newModifiedAt;

        // Refresh the displayed metadata
        // We can reuse the logic from toggleTaskDetail or just manually update here
        const createdSpan = currentEditingContainer.querySelector('.metadata-created');
        const modifiedSpan = currentEditingContainer.querySelector('.metadata-modified');

        if (createdSpan) {
            const createdDateStr = formatDate(newCreatedAt);
            const daysSinceCreated = calculateDaysPassed(newCreatedAt);
            createdSpan.textContent = `C: ${createdDateStr} (PC: ${daysSinceCreated}D)`;
            createdSpan.title = `Created: ${formatDateTime(newCreatedAt)}`;
            createdSpan.dataset.createdAt = newCreatedAt;
        }

        if (modifiedSpan) {
            const modifiedDateStr = formatDate(newModifiedAt);
            const daysSinceModified = calculateDaysPassed(newModifiedAt);
            modifiedSpan.textContent = `M: ${modifiedDateStr} (MC: ${daysSinceModified}D)`;
            modifiedSpan.title = `Modified: ${formatDateTime(newModifiedAt)}`;
            modifiedSpan.dataset.modifiedAt = newModifiedAt;
        }
    }

    closeDateModal();
}
// ------------------------

window.toggleTaskDetail = function(container) {
    const detailInput = container.querySelector('.task-detail-input');
    const controlsContainer = container.querySelector('.task-controls-container');
    // Only toggle controls if the item is NOT completed
    const isCompleted = container.classList.contains('completed');

    if (detailInput) {
        detailInput.classList.toggle('hidden');
        if (!detailInput.classList.contains('hidden')) {
            autoResizeTextarea(detailInput);
            
            // --- Refresh Metadata Display on Expand ---
            const createdSpan = container.querySelector('.metadata-created');
            const modifiedSpan = container.querySelector('.metadata-modified');
            const createdHidden = container.querySelector('.task-created-at');
            const modifiedHidden = container.querySelector('.task-modified-at');
            
            if (createdSpan) {
                const createdAt = (createdHidden ? createdHidden.value : null) || createdSpan.dataset.createdAt || container.dataset.createdAt;
                if (createdAt) {
                    const createdDateStr = formatDate(createdAt);
                    const daysSinceCreated = calculateDaysPassed(createdAt);
                    createdSpan.textContent = `C: ${createdDateStr} (PC: ${daysSinceCreated}D)`;
                    createdSpan.title = `Created: ${formatDateTime(createdAt)}`;
                }
            }
            
            if (modifiedSpan) {
                const modifiedAt = (modifiedHidden ? modifiedHidden.value : null) || modifiedSpan.dataset.modifiedAt || container.dataset.modifiedAt;
                if (modifiedAt) {
                    const modifiedDateStr = formatDate(modifiedAt);
                    const daysSinceModified = calculateDaysPassed(modifiedAt);
                    modifiedSpan.textContent = `M: ${modifiedDateStr} (MC: ${daysSinceModified}D)`;
                    modifiedSpan.title = `Modified: ${formatDateTime(modifiedAt)}`;
                }
            }
            // ------------------------------------------
        }
    }
    
    if (controlsContainer && !isCompleted) {
         controlsContainer.classList.toggle('hidden');
    }
}

window.toggleCompleted = function(buttonEl) {
    const container = buttonEl.closest('.work-item-container');
    
    // 1. Extract current data
    const titleInput = container.querySelector('.task-title-input');
    const detailInput = container.querySelector('.task-detail-input');
    const createdHidden = container.querySelector('.task-created-at');
    const modifiedHidden = container.querySelector('.task-modified-at');

    const currentTitle = titleInput ? titleInput.value : '';
    const currentDetail = detailInput ? detailInput.value : '';
    
    // Prefer hidden input, fallback to dataset
    const currentCreatedAt = (createdHidden ? createdHidden.value : null) || container.dataset.createdAt;
    const currentModifiedAt = (modifiedHidden ? modifiedHidden.value : null) || container.dataset.modifiedAt;
    
    // 2. Determine new state
    const isCurrentlyCompleted = container.classList.contains('completed');
    const newState = !isCurrentlyCompleted;

    // 3. Create NEW element with toggled state
    const newTaskElement = createWorkItemElement({
        title: currentTitle,
        detail: currentDetail,
        isCompleted: newState,
        createdAt: currentCreatedAt,
        modifiedAt: currentModifiedAt
    });

    // 4. Place in appropriate container
    if (newState) {
        completedWorkItemsContainer.appendChild(newTaskElement);
    } else {
        workItemsContainer.appendChild(newTaskElement);
    }

    // 5. Remove old element
    container.remove();

    // 6. Update the completed task count display
    updateCompletedTaskCountDisplay();
}

window.removeWorkItem = function(buttonEl) {
    const container = buttonEl.closest('.work-item-container');
    container.remove();
}

function collectWorkItems() {
    const items = [];
    
    // Collect active items
    workItemsContainer.querySelectorAll('.work-item-container').forEach(container => {
        const titleInput = container.querySelector('.task-title-input');
        const detailInput = container.querySelector('.task-detail-input');
        const createdHidden = container.querySelector('.task-created-at');
        const modifiedHidden = container.querySelector('.task-modified-at');

        const title = titleInput ? titleInput.value.trim() : '';
        const detail = detailInput ? detailInput.value.trim() : '';
        
        // Prioritize hidden input, then dataset, then default to new date
        const createdAt = (createdHidden ? createdHidden.value : null) || container.dataset.createdAt || new Date().toISOString();
        const modifiedAt = (modifiedHidden ? modifiedHidden.value : null) || container.dataset.modifiedAt || new Date().toISOString();

        if (title || detail) {
            items.push({ title, detail, isCompleted: false, createdAt, modifiedAt });
        }
    });

    // Collect completed items
    completedWorkItemsContainer.querySelectorAll('.work-item-container').forEach(container => {
        const titleInput = container.querySelector('.task-title-input');
        const detailInput = container.querySelector('.task-detail-input');
        const createdHidden = container.querySelector('.task-created-at');
        const modifiedHidden = container.querySelector('.task-modified-at');

        const title = titleInput ? titleInput.value.trim() : '';
        const detail = detailInput ? detailInput.value.trim() : '';
        
        // Prioritize hidden input, then dataset, then default to new date
        const createdAt = (createdHidden ? createdHidden.value : null) || container.dataset.createdAt || new Date().toISOString();
        const modifiedAt = (modifiedHidden ? modifiedHidden.value : null) || container.dataset.modifiedAt || new Date().toISOString();

        if (title || detail) {
            items.push({ title, detail, isCompleted: true, createdAt, modifiedAt });
        }
    });

    return items;
}
// --- END DYNAMIC WORK LOG FUNCTIONS ---

window.saveDiaryEntry = async function() {
    if (!db || !userId) {
        setStatus("Error: Cannot save. Please ensure you are signed in.", 'error'); 
        return;
    }

    const dateInput = document.getElementById('date-input');
    const workItems = collectWorkItems(); // Collect the dynamic work items

    const data = {
        timestamp: new Date().toISOString(), 
        date: dateInput.value, // YYYY-MM-DD (Used as Document ID for uniqueness)
        fullDateString: dateInput.dataset.fullDate, 
        consecutiveDay: document.getElementById('consecutive-day-input').value.trim(),
        accumulatedCount: document.getElementById('accumulated-count-input').value.trim(),
        reflection: document.getElementById('reflection-entry').value.trim(),
        lifeMap: document.getElementById('life-map-log').value.trim(),
        work: workItems, // Store the array of objects
        weekGoals: document.getElementById('week-goals-entry').value.trim(),
        gamificationNotes: document.getElementById('gamification-notes-entry').value.trim(), 
        longTermPlan: document.getElementById('long-term-plan-entry').value.trim(),
        shortTermPlan: document.getElementById('short-term-plan-entry').value.trim(),
        englishPractice: document.getElementById('english-practice-entry').value.trim(),
        japanesePractice: document.getElementById('japanese-practice-entry').value.trim(),
        customNotesTitle: document.getElementById('custom-notes-title').value.trim(),
        customNotes: document.getElementById('custom-notes-entry').value.trim(),
    };

    generateDiaryOutput(data);
    
    try {
        setStatus("Saving entry to cloud storage...", 'info');
        
        // Firestore path: /artifacts/{finalAppId}/users/{userId}/diary_entries/{date}
        const entriesRef = collection(db, `artifacts/${finalAppId}/users/${userId}/diary_entries`);
        
        // STEP 1: Use the date (YYYY-MM-DD) as the document ID
        const docId = data.date;
        const entryDocRef = doc(entriesRef, docId);
        
        // STEP 2: Use setDoc to overwrite if it exists (ensures one-per-day)
        await setDoc(entryDocRef, data);

        const now = new Date();
        const timestampString = now.toLocaleString();
        setStatus(`Entry successfully saved! Date: ${data.fullDateString} at ${timestampString}`, 'success');
    } catch (error) {
        setStatus(`Save Failed! Error: ${error.message}`, 'error');
        console.error("Firestore Save Error:", error);
    }
}

/**
 * Generates the formatted text output.
 */
function generateDiaryOutput(data) {
    let output = '';

    // Date/Count Block (Always included)
    const dateLine = `Date: ${data.fullDateString}, Consecutive Day: ${data.consecutiveDay}, Accumulated Count: ${data.accumulatedCount}`;
    output += dateLine + '\n\n';
    
    // --- CONDITIONAL SECTIONS START HERE ---
    
    if (data.reflection.length > 0) {
        output += '# Story, Emotion, Gratitude, Reflection\n';
        output += data.reflection + '\n\n';
    }

    if (data.lifeMap.length > 0) {
        output += '# Life Map (Daily Architecture)\n';
        output += '## In this section, I want to write down the daily routine active. Those actives would be a habit.\n';
        output += '## These routine active should have a timer to follow. That\'s the concept of regular and discipline.\n';
        output += data.lifeMap + '\n\n';
    }

    // Work Log output logic changed to handle the array of tasks
    if (Array.isArray(data.work) && data.work.length > 0) {
        output += '# work\n';
        data.work.forEach(task => {
            output += task.title + '\n';
            if (task.detail && task.detail.length > 0) {
                // Use a custom tab indent for details to match your original format
                output += '  -> ' + task.detail.replace(/\n/g, '\n  -> ') + '\n\n';
            } else {
                 output += '\n';
            }
        });
        output += '\n';
    }
    
    if (data.weekGoals.length > 0) {
        const weekGoalsHeader = document.getElementById('week-goals-header').textContent;
        output += `# ${weekGoalsHeader.replace('🎯 ', '')} & important plan\n`; 
        output += data.weekGoals + '\n\n';
    }

    if (data.gamificationNotes.length > 0) {
        output += '# Gamification Note\n'; 
        output += data.gamificationNotes + '\n\n';
    }

    if (data.longTermPlan.length > 0) {
        output += '# personal long term plan\n';
        output += data.longTermPlan + '\n\n';
    }

    if (data.shortTermPlan.length > 0) {
        output += '# personal short term plan\n';
        output += data.shortTermPlan + '\n\n';
    }

    if (data.englishPractice.length > 0) {
        output += '# English practice\n';
        output += data.englishPractice + '\n\n';
    }

    if (data.japanesePractice.length > 0) {
        output += '# Japanese practice\n';
        output += data.japanesePractice + '\n\n'; 
    }

    if (data.customNotes.length > 0) {
        output += `# ${data.customNotesTitle}\n`; 
        output += data.customNotes; 
    }
    
    output = output.trim();

    // 4. Output to the read-only text area
    const outputArea = document.getElementById('diary-output');
    outputArea.value = output;
    
    // 5. Attempt to automatically copy the text to the clipboard
    outputArea.select();
    outputArea.setSelectionRange(0, 99999);
    try {
        document.execCommand('copy');
    } catch (err) {
        console.warn('Automatic copy failed.');
    }
}

        /**
         * Dynamically adjusts the height of a textarea to fit its content.
         * @param {HTMLTextAreaElement} textarea - The textarea element to resize.
         */
        function autoResizeTextarea(textarea) {
            // Temporarily reset height to calculate the new scrollHeight
            textarea.style.height = 'auto';
            // Set the height to the scrollHeight to fit the content, adding a little buffer
            textarea.style.height = (textarea.scrollHeight) + 'px';
        }

/**
 * Updates the display for the number of completed tasks in the summary.
 */
function updateCompletedTaskCountDisplay() {
    if (completedTasksSummaryCount && completedWorkItemsContainer) {
        const count = completedWorkItemsContainer.children.length;
        completedTasksSummaryCount.textContent = `${count} items`;

        // Optionally, open the details if there are items, or leave it closed.
        // For now, we will leave it closed by default as per 'collapsible' request.
    }
}

/**
 * Returns the current time as a Date object adjusted to Taipei Standard Time (UTC+8).
 * Note: This returns a Date object where the "local" time getters correspond to Taipei time.
 */
function getCurrentTaipeiTime() {
    const now = new Date();
    // UTC time in ms
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    // Taipei is UTC + 8 hours
    const taipeiOffset = 8 * 60 * 60 * 1000;
    return new Date(utc + taipeiOffset);
}

/**
 * Calculates the number of days passed between a given date and today (Taipei Time).
 * @param {string} dateString - The date string (ISO format).
 * @returns {number} The number of days passed.
 */
function calculateDaysPassed(dateString) {
    if (!dateString) return 0;
    
    // Parse the stored date (which is ISO UTC)
    const storedDate = new Date(dateString);
    // Convert stored date to Taipei time for "calendar day" comparison
    const utcStored = storedDate.getTime() + (storedDate.getTimezoneOffset() * 60000);
    const taipeiStored = new Date(utcStored + (8 * 60 * 60 * 1000));

    // Get current Taipei time
    const taipeiToday = getCurrentTaipeiTime();

    // Reset time components to ensure purely date-based calculation
    taipeiStored.setHours(0, 0, 0, 0);
    taipeiToday.setHours(0, 0, 0, 0);
    
    const diffTime = Math.abs(taipeiToday - taipeiStored);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
    return diffDays;
}

/**
 * Formats a date string to YYYY/MM/DD in Taipei Time.
 * @param {string} dateString - The date string to format.
 * @returns {string} The formatted date string.
 */
function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    
    // Convert to Taipei Time for display
    const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
    const taipeiDate = new Date(utc + (8 * 60 * 60 * 1000));

    const year = taipeiDate.getFullYear();
    const month = String(taipeiDate.getMonth() + 1).padStart(2, '0');
    const day = String(taipeiDate.getDate()).padStart(2, '0');
    return `${year}/${month}/${day}`;
}

/**
 * Formats a date string to a full locale string in Taipei Time.
 * @param {string} dateString - The date string to format.
 * @returns {string} The formatted date string.
 */
function formatDateTime(dateString) {
    if (!dateString) return '';
    // Simply force the timezone to Taipei
    return new Date(dateString).toLocaleString('en-US', { timeZone: 'Asia/Taipei' });
}
        
        // Initialize on load is now correctly placed inside the module
        window.addEventListener('load', () => {
            // Function to format the current date info and set input defaults (moved here)
            function updateDateInfo() {
                const today = new Date();
                const isoDate = today.toISOString().substring(0, 10);
                
                // Set initial values for the inputs (pre-populating with suggested next counts)
                document.getElementById('date-input').value = isoDate;
                document.getElementById('consecutive-day-input').value = 32; 
                document.getElementById('accumulated-count-input').value = 55; 
                
                window.updateWeekday(); // Call the globally attached function
            }
            
            // Attach the date change listener programmatically
            document.getElementById('date-input').addEventListener('change', window.updateWeekday);

            // Attach the "Collapse/Expand All" button listener
            document.getElementById('toggle-all-details-button').addEventListener('click', () => {
                const detailTextareas = document.querySelectorAll('.task-detail-input');
                const controlsContainers = document.querySelectorAll('.task-controls-container');
                // Determine if we should be collapsing or expanding by checking the first one
                const shouldCollapse = !detailTextareas[0].classList.contains('hidden');
                detailTextareas.forEach(textarea => {
                    if (shouldCollapse) {
                        textarea.classList.add('hidden');
                    } else {
                        textarea.classList.remove('hidden');
                        autoResizeTextarea(textarea);
                    }
                });
                controlsContainers.forEach(container => {
                    if (shouldCollapse) {
                        container.classList.add('hidden');
                    } else {
                        container.classList.remove('hidden');
                    }
                });
            });

            // Load one empty item to start the work log, if the container is empty
            if (workItemsContainer.children.length === 0) {
                workItemsContainer.appendChild(createWorkItemElement());
            }

            // Set up event delegation for auto-resizing textareas
            document.body.addEventListener('input', (event) => {
                if (event.target.tagName.toLowerCase() === 'textarea') {
                    autoResizeTextarea(event.target);
                }
            });

            // Initial resize for all textareas on page load
            document.querySelectorAll('textarea').forEach(autoResizeTextarea);

            // Add keyboard shortcut for saving (Ctrl+S or Cmd+S)
            document.addEventListener('keydown', (event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 's') {
                    event.preventDefault(); // Prevent the browser's default save action
                    window.saveDiaryEntry();
                }
                // Alt + Right Arrow OR Alt + n: Next Day
                if (event.altKey && (event.key === 'ArrowRight' || event.key === 'n')) {
                    event.preventDefault();
                    window.goToNextDay();
                }
                // Alt + T: Today
                if (event.altKey && event.key === 't') {
                    event.preventDefault();
                    window.goToToday();
                }
            });

            // Floating Action Button (FAB) Logic
            const fabMainButton = document.getElementById('fab-main-button');
            const fabContainer = document.querySelector('.fab-container');
            const fabSaveButton = document.getElementById('fab-save-button');
            const fabCopyButton = document.getElementById('fab-copy-button');
            const fabTodayButton = document.getElementById('fab-today-button');
            const fabNextDayButton = document.getElementById('fab-next-day-button');

            fabMainButton.addEventListener('click', () => {
                fabContainer.classList.toggle('open');
            });

            fabSaveButton.addEventListener('click', () => {
                window.saveDiaryEntry();
                fabContainer.classList.remove('open'); // Close menu after action
            });

            fabCopyButton.addEventListener('click', () => {
                const outputArea = document.getElementById('diary-output');
                outputArea.select();
                outputArea.setSelectionRange(0, 99999);
                try {
                    document.execCommand('copy');
                    setStatus('Output copied to clipboard!', 'success');
                } catch (err) {
                    setStatus('Failed to copy output.', 'error');
                }
                fabContainer.classList.remove('open'); // Close menu after action
            });


            if (fabNextDayButton) {
                fabNextDayButton.addEventListener('click', () => {
                    window.goToNextDay();
                    fabContainer.classList.remove('open');
                });
            }

            // Floating Navigation Menu Logic
            const nav = document.getElementById('floating-nav');
            const navLinks = nav.querySelectorAll('.nav-link');
            const bottomNav = document.getElementById('bottom-nav');
            const bottomNavLinks = bottomNav.querySelectorAll('.nav-link-bottom');
            const sections = document.querySelectorAll('section[id]');

            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const id = entry.target.id;
                        navLinks.forEach(link => {
                            link.classList.toggle('active', link.getAttribute('href').substring(1) === id);
                        });
                        bottomNavLinks.forEach(link => {
                            link.classList.toggle('active', link.getAttribute('href').substring(1) === id);
                        });
                    }
                });
            }, { rootMargin: '-50% 0px -50% 0px' });

            sections.forEach(section => {
                observer.observe(section);
            });

            // --- New logic for dynamically showing/hiding the floating nav ---
            const mainContentWrapper = document.querySelector('.w-full.max-w-3xl.md\\:max-w-6xl.mx-auto');
            const floatingNav = document.getElementById('floating-nav');
            const bottomNavBar = document.getElementById('bottom-nav');

            function toggleFloatingNav() {
                if (!mainContentWrapper || !floatingNav) return;

                // The space on the left is the element's offset from the left edge of the viewport
                const leftSpace = mainContentWrapper.offsetLeft;
                const navWidth = floatingNav.offsetWidth || 200; // Use a heuristic if hidden

                if (leftSpace > navWidth + 20) {
                    floatingNav.style.display = 'block';
                    if (bottomNavBar) bottomNavBar.style.display = 'none';
                } else {
                    floatingNav.style.display = 'none';
                    if (bottomNavBar) bottomNavBar.style.display = 'block';
                }
            }

            // Check on window resize
            window.addEventListener('resize', toggleFloatingNav);
            // Initial check on load
            toggleFloatingNav();
            // --- End of new logic ---


            // Reflection Word Count Listener
            const reflectionEntry = document.getElementById('reflection-entry');
            if (reflectionEntry) {
                reflectionEntry.addEventListener('input', updateReflectionWordCount);
                // Initialize count on load
                updateReflectionWordCount();
            }

            updateDateInfo(); // Call the local setup function
            initializeFirebase();
        });

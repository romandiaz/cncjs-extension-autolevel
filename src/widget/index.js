(function () {
    // --- CONTROLLER LOGIC ---
    let socket = null;
    let controllerPort = '';
    let token = '';

    // DOM Elements
    // DOM Elements
    // const elPortSelector = document.getElementById('port-selector'); // Removed
    // const elPortSelector = document.getElementById('port-selector'); // Removed
    // const elFeedrate = document.getElementById('feedrate'); // Removed, using feedSlow
    const elHeight = document.getElementById('height');
    const elMargin = document.getElementById('margin');
    const elGrid = document.getElementById('grid');
    const btnAutolevel = document.getElementById('btn-autolevel');
    const btnApplyMesh = document.getElementById('btn-apply-mesh');
    const btnApplySkew = document.getElementById('btn-apply-skew');
    const btnClearMesh = document.getElementById('btn-clear-mesh');
    const btnClearSkew = document.getElementById('btn-clear-skew');
    const canvas = document.getElementById('mesh-canvas');
    const ctx = canvas ? canvas.getContext('2d') : null;
    const statusText = document.getElementById('status-text');
    const inputs = [elHeight, elMargin, elGrid];

    // Widget State
    const defaultSettings = {
        // Autolevel
        height: 2,
        margin: 10,
        grid: 3,
        // Probing
        probeDia: 1.92,
        sizeX: 50,
        sizeY: 50,
        probeDeflection: 0.29,
        retract: 3,
        maxTravel: 25,
        safeZ: 20,
        feedSlow: 50,
        feedFast: 200,
        plateThickness: 0.5,
        probeSpacing: 50,
        probeDepth: 3,
        // Tool Change
        toolProbeX: 618.5,
        toolProbeY: 25,
        toolProbeZ: 0,
        safeZMachine: 0, // Default to slightly below limit? Or 0? G53 Z0 is usually safe height.
        travelSpeed: 500,
        showToolChange: false,
        // UI State
        activeTab: 'autolevel'
    };

    let settings = { ...defaultSettings };

    // Helper for on-screen logging
    function logDebug(msg) {
        const debugConsole = document.getElementById('debug-console');
        if (debugConsole) {
            const div = document.createElement('div');
            div.textContent = msg;
            debugConsole.appendChild(div);
            debugConsole.scrollTop = debugConsole.scrollHeight;
        }
        console.log(msg);
    }

    function loadSettings() {
        console.log("loadSettings() called - Requesting from server...");
        // Request settings from server
        // Wait for connection? 
        // If we call this on load, socket might not be ready. 
        // We really should call this in the socket 'connect' or 'serialport:open' event.
        // For now, let's just emit if we can, or rely on the connection flow to trigger it.
        // See 'connectSocket' -> 'serialport:list' -> 'serialport:open'.
        // We will trigger the fetch in 'serialport:open'

        // Also load local UI state that we don't want to persist globally if desired?
        // For now, per user request, ALL settings including UI state (active tab) are going to the file.
    }

    function applySettings(newSettings) {
        console.log("Applying Settings:", newSettings);
        settings = { ...defaultSettings, ...newSettings };

        // Restore Input Values
        const mapping = {
            'height': settings.height,
            'margin': settings.margin,
            'grid': settings.grid,
            'probeDia': settings.probeDia,
            'sizeX': settings.sizeX,
            'sizeY': settings.sizeY,
            'probeDeflection': settings.probeDeflection,
            'retract': settings.retract,
            'maxTravel': settings.maxTravel,
            'safeZ': settings.safeZ,
            'feedSlow': settings.feedSlow,
            'feedFast': settings.feedFast,
            'plateThickness': settings.plateThickness,
            'feedFast': settings.feedFast,
            'plateThickness': settings.plateThickness,
            'probeSpacing': settings.probeSpacing,
            'probeDepth': settings.probeDepth,
            'toolProbeX': settings.toolProbeX,
            'toolProbeY': settings.toolProbeY,
            'toolProbeZ': settings.toolProbeZ,
            'safeZMachine': settings.safeZMachine,
            'travelSpeed': settings.travelSpeed
        };

        for (const [id, val] of Object.entries(mapping)) {
            const el = document.getElementById(id);
            if (el) el.value = val;
        }

        // Restore Checkbox
        const elShowTool = document.getElementById('showToolChange');
        if (elShowTool) {
            elShowTool.checked = settings.showToolChange;
            toggleToolChangeBtn(settings.showToolChange);
        }

        // Restore Active Tab
        if (settings.activeTab) {
            window.switchMainTab(settings.activeTab);
        }

        // Restore Global Settings Panel State
        // This relies on localStorage still as it's purely local UI preference?
        // Or should this be in the file too? 
        // User asked for "settings" to be persistent. Panel state is arguably "preference".
        // Let's keep panel state local for now as it's not critical.
        const globalSettingsOpen = localStorage.getItem('global_widget_settings_open') === 'true';
        if (globalSettingsOpen) {
            const panel = document.getElementById('globalSettings');
            const btn = document.getElementById('btnGlobalSettings');
            if (panel) panel.style.display = 'block';
            if (btn) btn.classList.add('active');
        }

        // Hide loading overlay
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) {
            loadingOverlay.style.display = 'none';
        }

        validateInputs();
        updateButtonState(socket && controllerPort);
    }

    function toggleToolChangeBtn(show) {
        // Find the button with onclick="run('tool_change')"
        // It resides in .probe-grid
        // We can find it by attribute or class if we add one.
        // It has style="grid-column: span 4;" in HTML, let's use a selector
        const btn = document.querySelector('.probe-grid button[onclick*="tool_change"]');
        if (btn) {
            btn.style.display = show ? 'flex' : 'none'; // Flex because these buttons are flex in CSS
        }
    }

    function saveSettings() {
        // Capture Input Values
        const ids = [
            'height', 'margin', 'grid',
            'probeDia', 'sizeX', 'sizeY', 'probeDeflection',
            'retract', 'maxTravel', 'safeZ',
            'feedSlow', 'feedFast', 'plateThickness', 'probeSpacing', 'probeDepth',
            'toolProbeX', 'toolProbeY', 'toolProbeZ', 'safeZMachine', 'travelSpeed'
        ];

        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) settings[id] = parseFloat(el.value);
        });

        // Capture Checkbox
        const elShowTool = document.getElementById('showToolChange');
        if (elShowTool) {
            settings.showToolChange = elShowTool.checked;
            toggleToolChangeBtn(settings.showToolChange); // Update immediately
        }

        console.log("Saving settings to server:", settings);
        // Send to server
        sendGcode(`(autolevel_save_settings ${JSON.stringify(settings)})`);
        showSavedFeedback();
    }

    function validateInputs() {
        let isValid = true;
        const setError = (id, valid) => {
            const el = document.getElementById(id);
            if (!el) return;
            if (!valid) {
                el.classList.add('is-invalid');
                isValid = false;
            } else {
                el.classList.remove('is-invalid');
            }
        };

        // Autolevel Settings
        const grid = parseInt(document.getElementById('grid').value, 10);
        setError('grid', !isNaN(grid) && grid >= 2);

        const h = parseFloat(document.getElementById('height').value);
        setError('height', !isNaN(h)); // Height can be negative (Z-down) or positive depending on setup, but likely just a travel height so usually > 0. Let's assume number is enough. Actually, travel height is usually positive absolute.
        // Let's enforce basics:
        // Height: usually positive safe height? Or relative? 
        // Existing default is 2. Let's just check !isNaN.

        setError('margin', !isNaN(parseFloat(document.getElementById('margin').value)));

        // Probing Settings
        const positiveFields = ['probeDia', 'sizeX', 'sizeY', 'retract', 'maxTravel', 'safeZ', 'feedSlow', 'feedFast', 'plateThickness', 'probeSpacing', 'probeDepth'];
        positiveFields.forEach(id => {
            const val = parseFloat(document.getElementById(id).value);
            // Some can be 0? Deflection maybe.
            // Feed must be > 0.
            if (id.includes('feed')) {
                setError(id, !isNaN(val) && val > 0);
            } else {
                setError(id, !isNaN(val) && val >= 0);
            }
        });

        // Deflection can be negative
        setError('probeDeflection', !isNaN(parseFloat(document.getElementById('probeDeflection').value)));

        return isValid;
    }

    function updateButtonState(connected) {
        // First check internal validation
        const inputsValid = validateInputs();
        const disabled = !connected || !inputsValid;

        if (autolevelState.active) {
            if (btnAutolevel) {
                btnAutolevel.disabled = false;
                btnAutolevel.title = "Stop Autolevel";
            }
            return;
        }

        if (btnAutolevel) {
            const hasMesh = probePoints.length >= 3;
            // Hide Autolevel (Probe) button if mesh exists. User must Clear Mesh first.
            if (hasMesh) {
                btnAutolevel.style.display = 'none';
            } else {
                btnAutolevel.style.display = '';
                btnAutolevel.title = !connected ? "Connect to controller first" : (!inputsValid ? "Check invalid settings" : "");
            }
        }

        if (btnApplyMesh) {
            const hasMesh = probePoints.length >= 3;
            const applied = currentGcodeFile && currentGcodeFile.includes('#AL:');

            if (hasMesh && !applied) {
                btnApplyMesh.style.display = '';
                btnApplyMesh.disabled = disabled;
            } else {
                btnApplyMesh.style.display = 'none';
            }
        }

        if (btnClearMesh) {
            const hasMesh = probePoints.length >= 3;
            if (hasMesh) {
                btnClearMesh.style.display = '';
                btnClearMesh.disabled = disabled;
            } else {
                btnClearMesh.style.display = 'none';
            }
        }

        if (btnApplySkew) btnApplySkew.disabled = disabled;
        if (btnClearSkew) btnClearSkew.disabled = disabled;

        const btnMeasureSkew = document.getElementById('btn-measure-skew');
        if (btnMeasureSkew) btnMeasureSkew.disabled = disabled;

        // Probing buttons
        const probeButtons = document.querySelectorAll('.probe-grid button');
        probeButtons.forEach(btn => {
            btn.disabled = disabled;
        });
    }


    let probePoints = [];
    let minZ = Infinity;
    let maxZ = -Infinity;
    let drawTimeout = null;

    // Skew State
    let skewState = {
        active: false,
        step: 0,
        probeCount: 0,
        p1: null,
        p2: null,
        spacing: 50 // Default spacing
    };

    // Autolevel State
    let autolevelState = {
        active: false,
        totalPoints: 0,
        currentPoint: 0,
        startTime: 0
    };

    let currentGcodeFile = ""; // Track loaded filename

    // Connect to CNCjs via Socket.IO
    function connectSocket() {
        console.log('Attempting to connect...');

        token = localStorage.getItem('cncjs.accessToken');
        if (!token) {
            const urlParams = new URLSearchParams(window.location.search);
            token = urlParams.get('token');
        }

        if (!token) {
            console.error('ERROR: Access Token not found!');
            return;
        }

        console.log('Token found. connecting to socket...');

        if (typeof window.io === 'undefined') {
            console.error('ERROR: window.io is undefined');
            return;
        }

        socket = window.io.connect('', {
            query: 'token=' + token
        });

        socket.on('connect', () => {
            console.log('SOCKET: Connected!');
            socket.emit('serialport:list');
            socket.emit('list');
        });

        socket.on('error', (err) => {
            console.error('SOCKET ERROR: ' + err);
        });

        socket.on('connect_error', (err) => {
            console.error('SOCKET CONNECT_ERROR: ' + err);
        });

        socket.on('close', () => {
            console.log('SOCKET: Closed');
        });

        socket.on('gcode:load', function (name, gcode) {
            console.log('GCODE LOADED:', name);
            currentGcodeFile = name || "";
            // We need to re-evaluate button states because the file might have changed status
            // Since updateSkewDisplay requires knowledge of the angle, we might need to re-fetch settings or store the last angle.
            // Ideally the extension sends "Skew Applied" status? 
            // For now, let's just trigger a settings fetch which will refresh the angle display too.
            sendGcode('(autolevel_fetch_settings)');
        });

        socket.on('serialport:list', function (ports) {
            console.log('PORTS: Received list (' + ports.length + ')');
            const connectedPort = ports.find(p => p.inuse || p.isOpen);
            if (connectedPort) {
                controllerPort = connectedPort.comName || connectedPort.port;
                console.log('SELECTED PORT: ' + controllerPort);

                // Explicitly open/subscribe to the port to receive events
                console.log('Subscribing to port...');
                socket.emit('open', controllerPort);

                updateButtonState(true);
                // setTimeout(() => sendGcode('(autolevel_get_mesh)'), 500); // Removed to prevent duplicate call (handled in serialport:open)
            } else {
                console.log('NO ACTIVE PORT FOUND.');
            }
        });

        socket.on('serialport:open', function (options) {
            console.log('PORT OPEN: ' + options.port);
            controllerPort = options.port;
            updateButtonState(true);
            setTimeout(() => {
                sendGcode('(autolevel_get_mesh)');
                // Fetch settings when port opens to sync skew/file state
                sendGcode('(autolevel_fetch_settings)');
                sendGcode('(autolevel_fetch_settings)');
                // Fetch current skew
                sendGcode('(autolevel_skew)');
            }, 500);
        });

        socket.on('serialport:close', function (options) {
            console.log('PORT CLOSED');
            controllerPort = '';
            updateButtonState(false);
        });

        socket.on('serialport:write', (data) => {
            // console.log('WRITE: ' + JSON.stringify(data));
            onSerialData(data);
        });

        socket.on('serialport:read', (data) => {
            // console.log('READ: ' + JSON.stringify(data));
            onSerialData(data);
        });
    }

    function sendGcode(cmd) {
        // Intercept autolevel start to clear mesh
        if (cmd.startsWith('(autolevel ')) {
            resetVisualizer();
        }

        if (socket && controllerPort) {
            // Check if this is a "Control" command that should bypass the G-code buffer (e.g. while in Alarm/Hold)
            if (cmd.startsWith('(autolevel')) {
                // Send all autolevel commands via serial write to ensure they are intercepted immediately
                // regardless of G-code queue state or controller parsing.
                // However, fetching settings, skew, dumping mesh, clearing mesh are safe to run anytime.
                // Let's whitelist the ones we KNOW cause hanging issues on startup:
                // fetch_settings, skew, get_mesh

                // Let's just use 'write' for ALL (autolevel_*) commands except maybe things that move?
                // None of the autolevel_ commands cause motion directly via the controller (they trigger internal extension logic).
                // So safe to send all via write.
                socket.emit('write', controllerPort, cmd + '\n');
                console.log("Sent Control Cmd via Serial Write:", cmd);
            } else {
                // CNCjs 1.9.x API: socket.emit('command', port, type, data)
                socket.emit('command', controllerPort, 'gcode', cmd);
                console.log("Sent GCode via Socket.IO:", cmd);
            }
        } else {
            console.warn("Cannot send GCode: Socket or Port not ready.", { socket: !!socket, port: controllerPort });

            // Fallback: Try postMessage for older CNCjs versions or specialized setups
            if (token) {
                window.parent.postMessage({
                    token: token,
                    action: {
                        type: 'command',
                        payload: {
                            command: 'gcode',
                            args: cmd
                        }
                    }
                }, '*');
            }
        }
    }


    // Event Listeners
    // Event Listeners
    btnAutolevel.addEventListener('click', () => {
        const f = document.getElementById('feedSlow') ? document.getElementById('feedSlow').value : 50;
        const h = elHeight.value || settings.height;
        const m = elMargin.value || settings.margin;
        const grid = elGrid.value;

        // P1 = Probe Only (Do not apply automatically)
        let cmd = `(autolevel F${f} H${h} M${m} P1`;
        if (grid) {
            cmd += ` GRID${grid}`;
        }
        cmd += ')';

        // NOTE: autolevelState.active will be set to true when "auto-leveling started" is received
        modalManager.confirmProbe(cmd, 'autolevel-confirm', 'Initiate Surface Map', 'Initiate');
    });

    // btnReapply listener replaced:
    if (btnApplyMesh) {
        btnApplyMesh.addEventListener('click', () => {
            modalManager.confirmProbe('(autolevel_apply_mesh)', 'apply-mesh-manual', 'Apply Surface Map?', 'Apply Mesh');
        });
    }


    if (btnApplySkew) {
        btnApplySkew.addEventListener('click', () => {
            modalManager.confirmProbe('(autolevel_apply_skew)', 'apply-skew-manual', 'Apply Skew?', 'Apply Skew');
        });
    }


    if (btnClearSkew) {
        btnClearSkew.addEventListener('click', () => {
            modalManager.confirmProbe('(autolevel_skew A0)', 'clear-skew-confirm', 'Clear Skew Compensation', 'Clear Skew');
        });
    }

    if (btnClearMesh) {
        btnClearMesh.addEventListener('click', () => {
            modalManager.confirmProbe('(autolevel_clear_mesh)', 'clear-mesh-confirm', 'Clear Mesh Data?', 'Clear Mesh');
        });
    }


    // Data Handling
    function onSerialData(data) {
        // Handle incoming string or object
        let str = data;
        if (typeof data === 'object' && data !== null && data.data) {
            str = data.data;
        }

        if (typeof str === 'string') {
            const lines = str.split('\n');
            lines.forEach(line => {
                const cleanLine = line.trim();
                // Check if it looks like an AL command
                if (cleanLine.includes('(AL:')) {
                    // console.log('AL CMD Found: ' + cleanLine);
                }

                // Check for settings response
                if (cleanLine.startsWith('(AL: SETTINGS')) {
                    const jsonStr = cleanLine.substring(13, cleanLine.length - 1).trim();
                    try {
                        const newSettings = JSON.parse(jsonStr);
                        applySettings(newSettings);
                    } catch (e) {
                        console.error("Failed to parse settings from server:", e);
                    }
                    return; // Done with this line
                }

                // Check for single probe points (legacy or live probing)
                const match = /\(AL: PROBED ([\.\+\-\d]+) ([\.\+\-\d]+) ([\.\+\-\d]+)\)/.exec(cleanLine);
                if (match) {
                    const x = parseFloat(match[1]);
                    const y = parseFloat(match[2]);
                    const z = parseFloat(match[3]);
                    addProbePoint(x, y, z);
                }

                // Check for packed probe points (AL: D x,y,z x,y,z ...)
                if (cleanLine.startsWith('(AL: D')) {
                    const content = cleanLine.substring(6, cleanLine.length - 1).trim(); // Remove "(AL: D" and ")"
                    if (content) {
                        const points = content.split(' ');
                        points.forEach(ptStr => {
                            const parts = ptStr.split(',');
                            if (parts.length === 3) {
                                const x = parseFloat(parts[0]);
                                const y = parseFloat(parts[1]);
                                const z = parseFloat(parts[2]);
                                if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
                                    addProbePoint(x, y, z);
                                }
                            }
                        });
                    }
                }

                // Check for status updates
                if (cleanLine.includes('(AL: dumping mesh start)')) {
                    resetVisualizer();
                    statusText.innerText = "Receiving mesh data...";
                } else if (cleanLine.includes('(AL: auto-leveling started)')) {
                    autolevelState.active = true;
                    autolevelState.currentPoint = 0;
                    autolevelState.totalPoints = 0;
                    autolevelState.startTime = Date.now();
                    statusText.innerText = "Starting autolevel...";
                    updateButtonState(true); // Ensure buttons update
                    modalManager.updateProgress(0, 0); // Reset modal progress
                } else if (cleanLine.includes('(AL: total_points')) {
                    const m = /total_points\s+(\d+)/.exec(cleanLine);
                    if (m) {
                        autolevelState.totalPoints = parseInt(m[1]);
                        modalManager.updateProgress(autolevelState.currentPoint, autolevelState.totalPoints);
                    }

                } else if (cleanLine.includes('(AL: finished)') || cleanLine.includes('(AL: dz_avg=')) {
                    statusText.innerText = "Autolevel complete.";
                    drawMesh();

                    if (autolevelState.active) {
                        autolevelState.active = false;
                        updateButtonState(true);
                        // Trigger confirmation to apply
                        modalManager.close(); // Close running modal
                        modalManager.confirmProbe('(autolevel_apply_mesh)', 'apply-mesh-confirm', 'Probe Complete', 'Apply Mesh');

                    }

                } else if (cleanLine.includes('(AL: applying')) {
                    statusText.innerText = "Applying mesh compensation...";
                } else if (cleanLine.includes('(AL: progress')) {
                    // Format: (AL: progress current total)
                    const m = /progress\s+(\d+)\s+(\d+)/.exec(cleanLine);
                    if (m) {
                        autolevelState.currentPoint = parseInt(m[1]);
                        autolevelState.totalPoints = parseInt(m[2]);

                        let msg = `Probing point ${autolevelState.currentPoint} / ${autolevelState.totalPoints}`;
                        let timeStr = "";

                        if (autolevelState.startTime && autolevelState.currentPoint > 1) {
                            const elapsed = Date.now() - autolevelState.startTime;
                            const avgPerPoint = elapsed / autolevelState.currentPoint;
                            const remaining = autolevelState.totalPoints - autolevelState.currentPoint;
                            const estRemaining = avgPerPoint * remaining;

                            const estSec = Math.ceil(estRemaining / 1000);
                            const finalTime = estSec > 60
                                ? `${Math.floor(estSec / 60)}m ${estSec % 60}s`
                                : `${estSec}s`;
                            timeStr = `🕒 Time Left: ${finalTime}`;
                        }

                        // Update modal with time string
                        modalManager.updateProgress(autolevelState.currentPoint, autolevelState.totalPoints, timeStr);

                        // Keep main status text clean
                        statusText.innerText = msg;
                    }
                } else if (cleanLine.includes('(AL: no mesh data')) {
                    statusText.innerText = "No mesh data found on server.";
                } else if (cleanLine.includes('PRB:')) {
                    // Check if we are in Skew mode
                    if (skewState.active) {
                        processSkewProbe(cleanLine);
                    }
                } else if (cleanLine.includes('AL: Skew angle set to') || cleanLine.includes('AL: Current Skew:')) {
                    // Parse: (AL: Skew angle set to 1.234 deg) or (AL: Current Skew: 1.234 deg)
                    const m = /([\.\+\-\d]+)\s*deg/.exec(cleanLine);
                    if (m) {
                        const val = parseFloat(m[1]);
                        updateSkewDisplay(val);
                    }
                } else if (cleanLine.includes('(AL: mesh cleared)')) {
                    statusText.innerText = "Mesh data cleared.";
                    resetVisualizer();
                } else if (cleanLine.includes('AL: Loaded File:')) {
                    // Parse: (AL: Loaded File: #SK:file.nc)
                    const m = /Loaded File:\s*(.*)\)/.exec(cleanLine);
                    if (m) {
                        currentGcodeFile = m[1].trim();
                        console.log("Synced current G-code file from extension:", currentGcodeFile);
                        // Trigger display update using current angle (we might not have it yet if this comes before Skew report)
                        // But usually Skew report comes right before this.
                        // Let's rely on the Skew report triggering the update, OR trigger it here if angle is known.
                        // Angle is in the text element.
                        const valEl = document.getElementById('skew-val');
                        if (valEl) {
                            const angle = parseFloat(valEl.innerText) || 0;
                            updateSkewDisplay(angle);
                        }
                        updateButtonState(socket && controllerPort);
                    }
                }
            });
        }
    }

    function updateSkewDisplay(angle) {
        const el = document.getElementById('skew-status');
        const valEl = document.getElementById('skew-val');
        if (el && valEl) {
            valEl.innerText = angle.toFixed(3);
            const btnClear = document.getElementById('btn-clear-skew');
            const btnApply = document.getElementById('btn-apply-skew');
            const btnMeasure = document.getElementById('btn-measure-skew'); // New requirement

            const hasSkew = Math.abs(angle) > 0.0001;
            const isApplied = currentGcodeFile && currentGcodeFile.includes('#SK:');
            const msgEl = document.getElementById('skew-locked-msg');

            if (hasSkew) {
                if (msgEl) msgEl.style.display = 'none';
                el.style.display = 'block';

                // Hide Measure if skew exists OR if applied (User request)
                if (btnMeasure) {
                    if (isApplied) {
                        btnMeasure.disabled = true;
                        btnMeasure.style.display = 'none';
                    } else {
                        // Skew exists (angle > 0), so we hide Measure anyway to force Reset first?
                        // Yes, if hasSkew, original logic was to hide Measure.
                        // So regardless of isApplied, if hasSkew, we hide Measure.
                        btnMeasure.disabled = true;
                        btnMeasure.style.display = 'none';
                    }
                }

                if (btnClear) {
                    btnClear.disabled = false;
                    btnClear.style.display = '';
                    btnClear.title = "Clear Skew Compensation";
                }

                // Hide Apply if already applied
                if (btnApply) {
                    if (isApplied) {
                        btnApply.disabled = true;
                        btnApply.style.display = 'none';
                        btnApply.title = "Skew already applied to file";
                    } else {
                        btnApply.disabled = false;
                        btnApply.style.display = '';
                        btnApply.title = "Apply Skew to G-code";
                    }
                }
            } else {
                // el.style.display = 'none'; // Keep status visible to show it is zero?
                el.style.display = 'block';

                // Show "Skew Locked" message if applied but no current skew (meaning buttons are hidden)
                // Actually, if isApplied, Measure adds are hidden. Apply is hidden. Reset is hidden.
                // So if isApplied && !hasSkew, user sees NO buttons. This is where we want the message.
                if (isApplied) {
                    if (msgEl) msgEl.style.display = 'block';
                } else {
                    if (msgEl) msgEl.style.display = 'none';
                }

                // Show Measure if no skew AND not applied
                if (btnMeasure) {
                    if (isApplied) {
                        btnMeasure.disabled = true;
                        btnMeasure.style.display = 'none';
                    } else {
                        btnMeasure.disabled = false;
                        btnMeasure.style.display = '';
                    }
                }

                if (btnClear) {
                    btnClear.disabled = true;
                    btnClear.style.display = 'none'; // Hide
                    btnClear.title = "No Skew Applied";
                }
                if (btnApply) {
                    btnApply.disabled = true;
                    btnApply.style.display = 'none'; // Hide
                    btnApply.title = "No Skew to Apply";
                }
            }
        }
    }

    function startSkewProbe(spacing) {
        skewState.active = true;
        skewState.step = 1;
        skewState.probeCount = 0;
        skewState.spacing = spacing;
        skewState.p1 = null;
        skewState.p2 = null;

        console.log("Starting Skew Probe. Spacing:", spacing);
        const params = getProbeParams();

        // Step 1: Probe Y Front
        // Move to start? Assumed current pos is start.
        // Just probe Y.

        // P1 Probe G-Code
        let g = "G91\n";
        g += `G38.2 Y${params.maxTravel} F${params.fast}\n`;
        g += `G0 Y-${params.ret}\n`;
        g += `G38.2 Y${params.ret + 1} F${params.slow}\n`;
        g += `G0 Y-${params.ret}\n`;
        g += "G90";

        sendGcode(g);
        statusText.innerText = "Skew: Probing Point 1...";
        modalManager.updateSkewStatus("Probing Point 1...");
    }

    function processSkewProbe(line) {
        // Parse PRB: x,y,z:val,val,val
        // Example: [PRB:0.000,0.000,0.000:1]
        const match = /\[PRB:([\.\+\-\d]+),([\.\+\-\d]+),([\.\+\-\d]+)/.exec(line);
        if (!match) return;

        const x = parseFloat(match[1]);
        const y = parseFloat(match[2]);
        const z = parseFloat(match[3]);

        // Increment probe count for current step
        skewState.probeCount = (skewState.probeCount || 0) + 1;
        console.log(`Skew Probe Step ${skewState.step}, Count ${skewState.probeCount}:`, { x, y, z });

        if (skewState.step === 1) {
            // Wait for 2nd probe (Slow probe)
            if (skewState.probeCount < 2) {
                return;
            }

            skewState.p1 = { x, y, z };
            console.log("Skew P1 Recorded:", skewState.p1);

            // Move to P2
            skewState.step = 2;
            skewState.probeCount = 0; // Reset for next point

            const spacing = skewState.spacing;
            const params = getProbeParams();

            let g = "G91\n";
            g += `G0 X${spacing}\n`; // Move X
            g += "G90\n";

            // Probe Y again
            g += "G91\n";
            g += `G38.2 Y${params.maxTravel} F${params.fast}\n`;
            g += `G0 Y-${params.ret}\n`;
            g += `G38.2 Y${params.ret + 1} F${params.slow}\n`;
            g += `G0 Y-${params.ret}\n`;
            g += "G90";

            sendGcode(g);
            statusText.innerText = "Skew: Moving to Point 2...";
            modalManager.updateSkewStatus("Moving to Point 2...");
        }
        else if (skewState.step === 2) {
            // Wait for 2nd probe (Slow probe)
            if (skewState.probeCount < 2) {
                return;
            }

            skewState.p2 = { x, y, z };
            console.log("Skew P2 Recorded:", skewState.p2);
            skewState.active = false; // Done

            calculateAndApplySkew();
        }
    }

    function calculateAndApplySkew() {
        const p1 = skewState.p1;
        const p2 = skewState.p2;
        const dx = p2.x - p1.x; // Should be roughly spacing
        const dy = p2.y - p1.y;

        // Angle = atan(dy/dx)
        const angleRad = Math.atan2(dy, dx);
        const angleDeg = angleRad * 180 / Math.PI;

        console.log(`Skew Result: dy=${dy}, dx=${dx}, angle=${angleDeg.toFixed(4)}`);

        console.log(`Skew Result: dy=${dy}, dx=${dx}, angle=${angleDeg.toFixed(4)}`);

        // Prepare data for modal
        modalManager.setSkewResultData({
            p1: p1,
            p2: p2,
            angle: angleDeg
        });

        // 1. Send the SET command immediately to save state in extension
        const setCmd = `(autolevel_skew A${angleDeg.toFixed(5)})`;
        sendGcode(setCmd);

        // 2. Modal confirm action is now explicitly APPLY
        const applyCmd = `(autolevel_apply_skew)`;
        modalManager.confirmProbe(applyCmd, 'skew-result', 'Skew Measurement Result', 'Apply Skew');
    }
    let graph3d = null;

    function resetVisualizer() {
        console.log('Resetting visualizer');
        probePoints = [];
        minZ = Infinity;
        maxZ = -Infinity;
        if (drawTimeout) {
            clearTimeout(drawTimeout);
            drawTimeout = null;
        }
        updateButtonState(socket && controllerPort);

        const container = document.getElementById('visualizer-container');
        if (container) {
            container.innerHTML = '';
        }
        graph3d = null;
    }

    function addProbePoint(x, y, z) {
        // Fix rounding errors: Snap tiny values to 0
        if (Math.abs(z) < 0.0001) z = 0;

        // console.log(`Adding probe point: ${x}, ${y}, ${z}`);
        probePoints.push({ x, y, z });

        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;

        if (!drawTimeout) {
            drawTimeout = setTimeout(() => {
                drawMesh();
                drawTimeout = null;
            }, 200);
        }
    }

    function drawMesh() {
        const container = document.getElementById('visualizer-container');
        if (!container) return;

        if (typeof vis === 'undefined') {
            statusText.innerText = "Error: Visualizer library (vis.js) not loaded. Check internet connection.";
            return;
        }

        try {
            // Prepare data for vis.js
            const data = new vis.DataSet();
            probePoints.forEach(p => {
                data.add({ x: p.x, y: p.y, z: p.z });
            });

            const options = {
                width: '100%',
                height: '100%',
                style: 'surface',
                showPerspective: true,
                showGrid: true,
                showShadow: false,
                keepAspectRatio: false,
                verticalRatio: 0.2,
                xLabel: 'X',
                yLabel: 'Y',
                zLabel: 'Z',
                cameraPosition: {
                    horizontal: 1.0,
                    vertical: 0.5,
                    distance: 1.5
                },
                tooltip: function (point) {
                    return 'X: ' + point.x + '<br>Y: ' + point.y + '<br>Z: ' + point.z.toFixed(3);
                },
                // Heatmap Settings
                showLegend: true,
                legendLabel: 'Z-Height',
                valueMin: minZ,
                valueMax: maxZ,
                // Format axis and legend values
                zValueLabel: function (z) {
                    return z.toFixed(3);
                },
                // Optional: Customize colors if needed, default is usually a heat gradient
            };

            if (!graph3d) {
                graph3d = new vis.Graph3d(container, data, options);
                // Monkey-patch the canvas context to force formatting of scientific notation
                interceptCanvasLabels(container);
            } else {
                graph3d.setOptions(options); // Update options for verticalRatio
                graph3d.setData(data); // Efficiently update data
                graph3d.redraw(); // Explicitly redraw
            }

            // Calculate metrics
            const delta = maxZ - minZ;
            const mean = probePoints.reduce((acc, p) => acc + p.z, 0) / probePoints.length;
            const variance = probePoints.reduce((acc, p) => acc + Math.pow(p.z - mean, 2), 0) / probePoints.length;
            const stdDev = Math.sqrt(variance);

            statusText.innerText = `Points: ${probePoints.length} | Range: ${minZ.toFixed(3)} to ${maxZ.toFixed(3)} | Deviation: ${delta.toFixed(3)} | StdDev: ${stdDev.toFixed(3)}`;
        } catch (err) {
            console.error("Visualizer error:", err);
            statusText.innerText = "Error initializing visualizer: " + err.message;
        }
    }

    // Canvas Monkey-Patch to fix Vis.js scientific notation in legend
    function interceptCanvasLabels(container) {
        try {
            const canvas = container.querySelector('canvas');
            if (!canvas) return;

            const ctx = canvas.getContext('2d');
            if (ctx._patched) return;

            const originalFillText = ctx.fillText;
            ctx.fillText = function (text, x, y, maxWidth) {
                let display = text;
                // Check for scientific notation or floats
                if (typeof text === 'string' || typeof text === 'number') {
                    const str = String(text);
                    // Filter for numbers that appear to be coordinates (skip purely integer labels if preferred, but consistency is good)
                    if (!isNaN(parseFloat(str)) && isFinite(str)) {
                        // Apply fixed formatting
                        display = parseFloat(str).toFixed(3);
                    }
                }
                originalFillText.call(this, display, x, y, maxWidth);
            };
            ctx._patched = true;
            console.log("Canvas context patched for label formatting.");
        } catch (e) {
            console.warn("Failed to patch canvas context:", e);
        }
    }

    // --- RESIZE OBSERVER ---
    // Automatically redraw graph when container size changes
    const resizeObserver = new ResizeObserver(entries => {
        for (let entry of entries) {
            if (graph3d && probePoints.length > 0) {
                // Debounce slightly if needed, but vis.js handles redraws well.
                // We specifically need redraw() to recalculate dimensions.
                graph3d.redraw();
            }
        }
    });

    // Start observing the container once the DOM is ready
    const visContainer = document.getElementById('visualizer-container');
    if (visContainer) {
        resizeObserver.observe(visContainer);
    }

    // Initialize
    window.addEventListener('load', () => {
        loadSettings();
        updateButtonState(false); // Start disabled until connected

        // Attach listeners to all settings inputs
        const settingsInputs = document.querySelectorAll('.settings-grid input');
        settingsInputs.forEach(el => {
            el.addEventListener('change', () => {
                validateInputs(); // Validate immediately on change
                saveSettings();
                // We need to re-check connectivity state to know if we should enable
                // But updateButtonState requires 'connected' arg.
                // We can cache connection state or check socket.
                const connected = (socket && controllerPort);
                updateButtonState(connected);
            });
            // Also validate on input for immediate feedback
            el.addEventListener('input', () => {
                validateInputs();
                const connected = (socket && controllerPort);
                updateButtonState(connected);
            });
        });

        // Give CNCJS a moment to initialize
        // We can look for the token immediately or wait a tick
        setTimeout(() => {
            connectSocket();

            // Optional: Request initial mesh if available
            // sendGcode('#autolevel_get_mesh'); // Wait for port open
        }, 500);
    });

    // --- PROBING WIDGET LOGIC ---

    // Expose global functions for HTML onclick handlers
    window.switchMainTab = function (tabName) {
        console.log("switchMainTab called with:", tabName);
        // Tabs
        document.querySelectorAll('.main-tab').forEach(el => el.classList.remove('active'));

        const btnId = 'tab-btn-' + tabName;
        const activeTab = document.getElementById(btnId);
        if (activeTab) {
            activeTab.classList.add('active');
        } else {
            console.warn("switchMainTab: Button not found for ID:", btnId);
        }

        // Content
        document.querySelectorAll('.main-tab-content').forEach(el => el.classList.remove('active'));
        const content = document.getElementById('main-tab-' + tabName);
        if (content) {
            content.classList.add('active');
            if (tabName === 'probing') {
                content.style.display = 'block';
                const alTab = document.getElementById('main-tab-autolevel');
                if (alTab) alTab.style.display = 'none';
            } else {
                content.style.display = 'block';
                const pbTab = document.getElementById('main-tab-probing');
                if (pbTab) pbTab.style.display = 'none';
            }
        } else {
            console.warn("switchMainTab: Content not found for ID:", 'main-tab-' + tabName);
        }

        // Save State
        if (settings.activeTab !== tabName) {
            console.log("Saving new active tab:", tabName);
            settings.activeTab = tabName;
            saveSettings();
        }

        // Force redraw if switching to autolevel to ensure visualizer is consistent
        if (tabName === 'autolevel') {
            // Small timeout to allow display:block to render layout
            setTimeout(() => {
                if (probePoints.length > 0) {
                    drawMesh();
                }
            }, 50);
        }

        // Force widget resize update
        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 100);
    };

    window.toggleGlobalSettings = function () {
        const panel = document.getElementById('globalSettings');
        const btn = document.getElementById('btnGlobalSettings');
        // Toggle display
        if (panel.style.display === 'none') {
            panel.style.display = 'block';
            btn.classList.add('active');
            localStorage.setItem('global_widget_settings_open', 'true');
        } else {
            panel.style.display = 'none';
            btn.classList.remove('active');
            localStorage.setItem('global_widget_settings_open', 'false');
        }

        // Force widget resize update
        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 100);
    };



    // Remove toggleHelp and openTab if they were purely for Help UI
    // But openTab might be useful elsewhere? 
    // Wait, openTab was used for the Help Tabs. Since help tabs are gone, we can remove/ignore.
    // However, confirmProbe relies on "tab-corner" etc existing. Which they do in the hidden section.
    // So logic remains valid. HTML changes are key.



    // Probing Variables

    function getProbeVal(id) {
        const el = document.getElementById(id);
        const val = parseFloat(el ? el.value : 0);
        return isNaN(val) ? 0 : val;
    }

    function getProbeParams() {
        const dia = getProbeVal('probeDia');
        const deflect = getProbeVal('probeDeflection');
        const ret = getProbeVal('retract');
        const maxTravel = getProbeVal('maxTravel');
        const safeZ = getProbeVal('safeZ');
        const sizeX = getProbeVal('sizeX');
        const sizeY = getProbeVal('sizeY');
        const spacing = getProbeVal('probeSpacing'); // New Param
        const probeDepth = getProbeVal('probeDepth');
        const fast = getProbeVal('feedFast');
        const slow = getProbeVal('feedSlow');
        const plateThickness = getProbeVal('plateThickness');

        // Tool Change Params
        const toolProbeX = getProbeVal('toolProbeX');
        const toolProbeY = getProbeVal('toolProbeY');
        const toolProbeZ = getProbeVal('toolProbeZ');
        const safeZMachine = getProbeVal('safeZMachine');
        const travelSpeed = getProbeVal('travelSpeed');

        const r = (dia / 2) - deflect;

        return {
            dia, deflect, ret, maxTravel, safeZ, sizeX, sizeY, spacing,
            probeDepth, fast, slow, plateThickness, r,
            toolProbeX, toolProbeY, toolProbeZ, safeZMachine, travelSpeed
        };
    }

    // --- MODAL MANAGER ---
    const modalManager = new window.ModalManager({
        sendGcode: sendGcode,
        startSkewProbe: startSkewProbe,
        getProbeParams: getProbeParams,
        onStop: () => {
            // Stop Autolevel - Drip Feed Method
            // 1. Feed Hold (!) to pause motion immediately
            // 2. Send (autolevel_stop) to clear extension queue
            // 3. Send Resume (~) to allow the single pending move (retract) to finish/abort gracefully?
            // Actually, if we just Hold, we are stuck. If we Resume, it finishes the current tiny probe move.
            // Since queue is cleared, it will stop after that. This prevents Z-drop.
            if (socket && controllerPort) {
                console.log("STOPPING: Sending Feed Hold -> Stop Cmd -> Resume");
                socket.emit('write', controllerPort, '!'); // Feed Hold

                // Give a tiny delay for Hold to take effect? Not strictly needed but safe.
                setTimeout(() => {
                    sendGcode('(autolevel_stop)'); // Tell extension to clear queue

                    setTimeout(() => {
                        socket.emit('write', controllerPort, '~'); // Resume to finish current move
                    }, 200);
                }, 100);
            } else {
                sendGcode('!');
                sendGcode('(autolevel_stop)');
                sendGcode('~');
            }
            statusText.innerText = "Stopping... (Finishing current move)";
            autolevelState.active = false;
            skewState.active = false;
        }
    });

    // Expose close globally for HTML onclick
    window.closeModal = function () {
        modalManager.close();
    };

    window.run = function (type, arg) {
        const params = getProbeParams();
        let g = "";
        let probeTitle = "Confirm Probe";

        if (type === 'surface') {
            probeTitle = "Probe Z Surface (Workpiece)";
            g = window.GCodeGenerator.generateSurfaceProbe(params);
        }
        else if (type === 'edge') {
            let axis = arg.charAt(0);
            let dir = arg.charAt(1);

            let edgeName = "Edge";
            if (axis === 'X' && dir === '+') edgeName = "Right Edge (X+)";
            if (axis === 'X' && dir === '-') edgeName = "Left Edge (X-)";
            if (axis === 'Y' && dir === '+') edgeName = "Back Edge (Y+)";
            if (axis === 'Y' && dir === '-') edgeName = "Front Edge (Y-)";
            probeTitle = `Probe ${edgeName}`;

            g = window.GCodeGenerator.generateEdgeProbe(axis, dir, params);
        }
        else if (type === 'pocket') {
            probeTitle = "Probe Hole Center";
            g = window.GCodeGenerator.generateHoleProbe(params);
        }
        else if (type === 'boss') {
            probeTitle = "Probe Block Center";
            // Default to X
            g = window.GCodeGenerator.generateBlockProbe('x', params);
        }
        else if (type === 'z_touchplate') {
            probeTitle = "Probe Z Touchplate";
            g = window.GCodeGenerator.generateZTouchplateProbe(params);
        }
        else if (type === 'corner') {
            let xDir = 0;
            let yDir = 0;
            if (arg.includes('L')) xDir = -1;
            if (arg.includes('R')) xDir = 1;
            if (arg.includes('B')) yDir = -1;
            if (arg.includes('T')) yDir = 1;

            let cornerName = "";
            if (yDir === 1) cornerName += "Top ";
            if (yDir === -1) cornerName += "Bottom ";
            if (xDir === -1) cornerName += "Left";
            if (xDir === 1) cornerName += "Right";

            probeTitle = `Probe ${cornerName} Corner`;
            g = window.GCodeGenerator.generateCornerProbe(arg, params);
        }
        else if (type === 'skew') {
            probeTitle = "Measure Skew (Y Front)";
            // Initial dummy GCode, will be dynamically generated/managed
            // Initial dummy GCode, will be dynamically generated/managed
            g = "(skew_start)";
        }
        if (type === 'tool_change') {
            probeTitle = "Tool Change & Probe";
            g = window.GCodeGenerator.generateToolChangeProbe(params);
            modalManager.confirmProbe(g, type, probeTitle, "Change Tool");
            return;
        }


        modalManager.confirmProbe(g, type, probeTitle, "Run Probe");
    };

    // Bind Local Confirm Button for Probing
    const btnConfirmRun = document.getElementById('btnConfirmRun');
    if (btnConfirmRun) {
        btnConfirmRun.addEventListener('click', function () {
            modalManager.runLocal();
        });
    }

    // Persistence for Probing
    const PROBE_SETTINGS_KEY = 'probe_widget_settings_v1';
    const PROBE_INPUT_IDS = ['probeDia', 'probeDeflection', 'retract', 'maxTravel', 'safeZ', 'sizeX', 'sizeY', 'feedSlow', 'feedFast', 'plateThickness', 'probeDepth',
        'toolProbeX', 'toolProbeY', 'toolProbeZ', 'safeZMachine', 'travelSpeed'];

    function saveProbeSettings() {
        const settings = {};
        PROBE_INPUT_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (el) settings[id] = el.value;
        });
        localStorage.setItem(PROBE_SETTINGS_KEY, JSON.stringify(settings));
        showSavedFeedback();
    }

    function loadProbeSettings() {
        const stored = localStorage.getItem(PROBE_SETTINGS_KEY);
        if (stored) {
            const settings = JSON.parse(stored);
            PROBE_INPUT_IDS.forEach(id => {
                if (settings[id] !== undefined) {
                    const el = document.getElementById(id);
                    if (el) el.value = settings[id];
                }
            });
        }
        // UI State restored by loadSettings (global)
    }

    // Auto-save on change
    PROBE_INPUT_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', saveProbeSettings);
            el.addEventListener('input', saveProbeSettings);
        }
    });

    // Tool Change Toggle Persistence
    const elShowTool = document.getElementById('showToolChange');
    if (elShowTool) {
        elShowTool.addEventListener('change', saveSettings);
    }

    // Load Probing Settings
    loadProbeSettings();
    // Default Tab
    window.switchMainTab('autolevel');

    // --- AUTO-RESIZE ---
    const updateWidgetHeight = () => {
        const height = document.body.scrollHeight;
        if (token) {
            window.parent.postMessage({
                token: token,
                action: {
                    type: 'resize',
                    payload: { height: height }
                }
            }, '*');
        }
    };

    const bodyObserver = new ResizeObserver(entries => {
        updateWidgetHeight();
    });
    bodyObserver.observe(document.body);
    // Initial call
    setTimeout(updateWidgetHeight, 100);

    function showSavedFeedback() {
        const msg = document.getElementById('saved-msg');
        if (!msg) return;

        // Show
        msg.classList.add('show');

        // Hide after 1s
        if (msg.timeout) clearTimeout(msg.timeout);
        msg.timeout = setTimeout(() => {
            msg.classList.remove('show');
        }, 1000);
    }

})();

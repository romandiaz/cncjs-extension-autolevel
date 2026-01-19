class ModalManager {
    constructor(callbacks) {
        this.sendGcode = callbacks.sendGcode;
        this.startSkewProbe = callbacks.startSkewProbe;
        this.getProbeParams = callbacks.getProbeParams; // Need this for injections
        this.onStop = callbacks.onStop; // Callback for stop button
        this.pendingGcode = '';
        this.skewSpacing = 50; // default
    }

    canAccessParent() {
        try {
            return window.parent && window.parent.document && window.parent.document.body;
        } catch (e) {
            return false;
        }
    }

    ensureParentStyles() {
        if (!this.canAccessParent()) return;
        const parentDoc = window.parent.document;
        const styleId = 'autolevel-widget-styles';
        if (!parentDoc.getElementById(styleId)) {
            const style = parentDoc.createElement('style');
            style.id = styleId;
            style.textContent = `
                .al-modal-overlay {
                    display: flex;
                    position: fixed;
                    top: 0; left: 0; width: 100%; height: 100%;
                    background-color: rgba(0, 0, 0, 0.5);
                    z-index: 10000;
                    justify-content: center;
                    align-items: center;
                    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
                }
                .al-modal-dialog {
                    background-color: #fff;
                    padding: 15px;
                    border-radius: 4px;
                    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
                    width: 400px;
                    max-width: 90%;
                    display: flex;
                    flex-direction: column;
                    gap: 15px;
                    color: #333;
                }
                 .al-modal-header {
                    font-size: 16px;
                    font-weight: bold;
                    border-bottom: 1px solid #eee;
                    padding-bottom: 10px;
                }
                .al-modal-body {
                    font-size: 14px;
                    color: #555;
                    text-align: center;
                }
                .al-modal-body img {
                    max-height: 200px;
                    width: auto;
                    max-width: 100%;
                    margin: 0 auto 10px auto;
                    display: block;
                    border: 1px solid #eee;
                }
                .al-modal-footer {
                    display: flex;
                    justify-content: flex-end;
                    gap: 10px;
                    padding-top: 10px;
                    border-top: 1px solid #eee;
                }
                .al-btn {
                    padding: 8px 16px;
                    border-radius: 3px;
                    cursor: pointer;
                    border: 1px solid #ccc;
                    background-color: #fff;
                    font-size: 14px;
                    color: #333;
                }
                .al-btn-primary {
                    background-color: #337ab7;
                    color: #fff;
                    border-color: #2e6da4;
                }
                .al-btn-primary:hover {
                    background-color: #286090;
                }
                .al-btn-danger {
                    background-color: #d9534f;
                    color: white;
                    border-color: #d43f3a;
                }
                .al-btn-danger:hover {
                    background-color: #c9302c;
                }
             `;

            parentDoc.head.appendChild(style);
        }
    }

    resolveImagePaths(html) {
        const div = document.createElement('div');
        div.innerHTML = html;
        const imgs = div.querySelectorAll('img');
        const baseUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);

        imgs.forEach(img => {
            const src = img.getAttribute('src');
            if (src && !src.startsWith('http') && !src.startsWith('//')) {
                img.src = baseUrl + src;
            }
        });
        return div.innerHTML;
    }

    close() {
        const modal = document.getElementById('confirmModal');
        if (modal) modal.classList.remove('open');

        if (this.canAccessParent()) {
            const parentModal = window.parent.document.getElementById('al-confirm-modal');
            if (parentModal) parentModal.remove();
        }

        this.pendingGcode = '';
    }

    confirmProbe(gcode, type, title, actionText = "Run Probe") {
        this.pendingGcode = gcode;

        // Content source mapping
        let tabId = 'tab-corner';
        if (type === 'boss') tabId = 'tab-block';
        if (type === 'pocket') tabId = 'tab-hole';
        if (type === 'surface') tabId = 'tab-surface';
        if (type === 'z_touchplate') tabId = 'tab-touchplate';
        if (type === 'edge') tabId = 'tab-edge';
        if (type === 'skew') tabId = 'tab-skew';
        if (type === 'skew-result') tabId = 'tab-skew-result';
        if (type === 'autolevel-confirm') tabId = 'tab-autolevel-confirm';
        if (type === 'apply-mesh-confirm') tabId = 'tab-apply-mesh-confirm';
        if (type === 'apply-mesh-confirm') tabId = 'tab-apply-mesh-confirm';
        if (type === 'reapply-confirm') tabId = 'tab-reapply-confirm'; // Deprecated but kept for safety?
        if (type === 'apply-skew-manual') tabId = 'tab-apply-skew-manual';
        if (type === 'apply-mesh-manual') tabId = 'tab-apply-mesh-manual';
        if (type === 'clear-mesh-confirm') tabId = 'tab-clear-mesh-confirm';
        if (type === 'clear-mesh-confirm') tabId = 'tab-clear-mesh-confirm';
        if (type === 'clear-skew-confirm') tabId = 'tab-clear-skew-confirm';
        if (type === 'tool_change') tabId = 'tab-tool-change';

        const sourceEl = document.getElementById(tabId);
        if (!sourceEl) {
            console.error('Modal source content not found:', tabId);
            return;
        }

        const sourceContent = sourceEl.innerHTML;
        const finalContent = this.resolveImagePaths(sourceContent);

        if (this.canAccessParent()) {
            this.ensureParentStyles();
            const parentDoc = window.parent.document;

            const existing = parentDoc.getElementById('al-confirm-modal');
            if (existing) existing.remove();

            const overlay = parentDoc.createElement('div');
            overlay.id = 'al-confirm-modal';
            overlay.className = 'al-modal-overlay';

            overlay.innerHTML = `
                <div class="al-modal-dialog">
                    <div class="al-modal-header">${title}</div>
                    <div class="al-modal-body" id="al-confirm-body">${finalContent}</div>
                    <div class="al-modal-footer">
                        <button class="al-btn" id="al-btn-cancel">Cancel</button>
                        <button class="al-btn ${type.startsWith('clear') ? 'al-btn-danger' : 'al-btn-primary'}" id="al-btn-run">${actionText}</button>
                    </div>
                </div>
            `;

            parentDoc.body.appendChild(overlay);

            if (type === 'boss') {
                const body = overlay.querySelector('#al-confirm-body');
                this.injectAxisSelection(body, (newGcode, newTitle) => {
                    this.pendingGcode = newGcode;
                    overlay.querySelector('.al-modal-header').innerText = newTitle;
                });
            }

            if (type === 'skew-result') {
                const body = overlay.querySelector('#al-confirm-body');
                // Data should be passed in via gcode arg or a separate way?
                // For now, we can attach it to the instance before calling confirmProbe, or pass it as gcode string if it's just meant for display?
                // Actually, the caller 'calculateAndApplySkew' has the data.
                // We'll add a helper `injectSkewResult` that parses the data from `this.startSkewProbe` (abused) or we pass data differently.
                // Let's assume we pass the result data object as 'gcode' argument since we don't need real GCode for this step until CONFIRM.
                // Wait, confirmProbe takes 'gcode'. If we pass the data object there it might break.
                // Let's use a dedicated 'data' arg in confirmProbe? changing signature might be risky if I miss calls.
                // Alternative: The `gcode` arg IS the command to run on confirm (the apply command).
                // The DATA to display needs to be injected.
                // I will add a `setSkewResultData(data)` method to store it temporarily, or pass it as a custom property.
                this.injectSkewData(body);
            }

            if (type === 'skew') {
                const body = overlay.querySelector('#al-confirm-body');
                this.injectSkewSpacing(body, (spacing) => {
                    overlay.dataset.spacing = spacing;
                });
            }

            overlay.querySelector('#al-btn-cancel').onclick = () => {
                overlay.remove();
                this.pendingGcode = '';
            };

            overlay.querySelector('#al-btn-run').onclick = () => {
                if (type === 'skew') {
                    const spacing = parseFloat(overlay.dataset.spacing || "50");
                    if (this.startSkewProbe) this.startSkewProbe(spacing);
                    this.transitionToSkewProbe(overlay);
                } else if (type === 'skew-result') {
                    // Just run the pending GCode (which is the apply text)
                    if (this.sendGcode && this.pendingGcode) this.sendGcode(this.pendingGcode);
                    overlay.remove();
                } else if (this.pendingGcode) {
                    if (this.sendGcode) this.sendGcode(this.pendingGcode);
                    // Do not close immediately if it's autolevel-confirm
                    if (type === 'autolevel-confirm') {
                        this.showRunningState(overlay);
                    } else {
                        overlay.remove();
                    }
                }
            };

            setTimeout(() => {
                const btn = overlay.querySelector('#al-btn-run');
                if (btn) btn.focus();
            }, 50);

        } else {
            // Local fallback
            const target = document.getElementById('confirmBody');
            if (target) {
                target.innerHTML = sourceContent;
                if (type === 'boss') this.injectAxisSelection(target, (newGcode, newTitle) => {
                    this.pendingGcode = newGcode;
                    const header = document.querySelector('#confirmModal .modal-header');
                    if (header) header.innerText = newTitle;
                });

                if (type === 'skew-result') {
                    this.injectSkewData(target);
                }

                if (type === 'skew') {
                    this.injectSkewSpacing(target, (spacing) => {
                        this.skewSpacing = parseFloat(spacing);
                    });
                }

                const header = document.querySelector('#confirmModal .modal-header');
                if (header) header.innerText = title;

                const modal = document.getElementById('confirmModal');
                if (modal) modal.classList.add('open');
                if (btn) {
                    btn.innerText = actionText;
                    // Apply danger class if needed
                    if (type.startsWith('clear')) {
                        btn.classList.add('btn-danger');
                        btn.classList.remove('primary');
                    } else {
                        btn.classList.remove('btn-danger');
                        btn.classList.add('primary');
                    }
                    setTimeout(() => btn.focus(), 50);
                }
            }
        }
    }

    injectAxisSelection(container, onUpdate) {
        const wrapper = document.createElement('div');
        wrapper.style.display = 'flex';
        wrapper.style.flexDirection = 'column';
        wrapper.style.alignItems = 'center';
        wrapper.style.gap = '10px';
        wrapper.style.marginTop = '15px';
        wrapper.style.paddingTop = '10px';
        wrapper.style.borderTop = '1px solid #eee';

        const radioGroup = document.createElement('div');
        radioGroup.style.display = 'flex';
        radioGroup.style.gap = '20px';

        const lblX = document.createElement('label');
        lblX.style.fontWeight = 'bold';
        lblX.style.cursor = 'pointer';
        lblX.innerHTML = '<input type="radio" name="probeAxis" value="x" checked> X Axis';

        const lblY = document.createElement('label');
        lblY.style.fontWeight = 'bold';
        lblY.style.cursor = 'pointer';
        lblY.innerHTML = '<input type="radio" name="probeAxis" value="y"> Y Axis';

        radioGroup.appendChild(lblX);
        radioGroup.appendChild(lblY);
        wrapper.appendChild(radioGroup);

        const inputsGroup = document.createElement('div');
        inputsGroup.style.display = 'flex';
        inputsGroup.style.gap = '10px';
        inputsGroup.style.alignItems = 'center';

        const initialParams = this.getProbeParams();

        const divStockX = document.createElement('div');
        divStockX.id = 'container-stock-x';
        divStockX.style.display = 'block';
        divStockX.innerHTML = 'Stock X: ';
        const inputStockX = document.createElement('input');
        inputStockX.type = 'number';
        inputStockX.value = initialParams.sizeX;
        inputStockX.style.width = '60px';
        inputStockX.style.marginLeft = '5px';
        divStockX.appendChild(inputStockX);

        const divStockY = document.createElement('div');
        divStockY.id = 'container-stock-y';
        divStockY.style.display = 'none';
        divStockY.innerHTML = 'Stock Y: ';
        const inputStockY = document.createElement('input');
        inputStockY.type = 'number';
        inputStockY.value = initialParams.sizeY;
        inputStockY.style.width = '60px';
        inputStockY.style.marginLeft = '5px';
        divStockY.appendChild(inputStockY);

        inputsGroup.appendChild(divStockX);
        inputsGroup.appendChild(divStockY);
        wrapper.appendChild(inputsGroup);

        container.appendChild(wrapper);

        const update = () => {
            const axis = wrapper.querySelector('input[name="probeAxis"]:checked').value;

            if (axis === 'x') {
                divStockX.style.display = 'block';
                divStockY.style.display = 'none';
            } else {
                divStockX.style.display = 'none';
                divStockY.style.display = 'block';
            }

            const params = this.getProbeParams();
            params.sizeX = parseFloat(inputStockX.value) || params.sizeX;
            params.sizeY = parseFloat(inputStockY.value) || params.sizeY;

            const newGcode = window.GCodeGenerator.generateBlockProbe(axis, params);
            const newTitle = "Probe Block Center (" + axis.toUpperCase() + ")";

            if (onUpdate) onUpdate(newGcode, newTitle);
        };

        const radios = radioGroup.querySelectorAll('input[name="probeAxis"]');
        radios.forEach(r => r.addEventListener('change', update));

        inputStockX.addEventListener('change', update);
        inputStockX.addEventListener('input', update);
        inputStockY.addEventListener('change', update);
        inputStockY.addEventListener('input', update);
    }

    injectSkewSpacing(container, onUpdate) {
        const div = document.createElement('div');
        div.style.marginTop = '15px';
        div.style.paddingTop = '10px';
        div.style.borderTop = '1px solid #eee';
        div.style.textAlign = 'center';

        const lbl = document.createElement('label');
        lbl.innerHTML = 'Probe Spacing (X distance): ';

        const input = document.createElement('input');
        input.type = 'number';

        const params = this.getProbeParams();
        const defaultSpacing = params.spacing || 50;

        input.value = defaultSpacing;
        input.style.width = '60px';
        input.style.marginLeft = '10px';

        input.onchange = () => {
            if (onUpdate) onUpdate(input.value);
        };

        if (onUpdate) onUpdate(input.value);

        div.appendChild(lbl);
        div.appendChild(input);
        container.appendChild(div);
    }

    setSkewResultData(data) {
        this.skewResultData = data;
    }

    injectSkewData(container) {
        if (!this.skewResultData) return;

        const { p1, p2, angle } = this.skewResultData;

        const elP1 = container.querySelector('#skew-p1');
        const elP2 = container.querySelector('#skew-p2');
        const elAngle = container.querySelector('#skew-angle');

        if (elP1) elP1.innerText = `(${p1.x.toFixed(3)}, ${p1.y.toFixed(3)})`;
        if (elP2) elP2.innerText = `(${p2.x.toFixed(3)}, ${p2.y.toFixed(3)})`;
        if (elAngle) elAngle.innerText = angle.toFixed(4);
    }

    showRunningState(overlay) {
        // Transition modal to running state
        const body = overlay.querySelector('.al-modal-body');
        const footer = overlay.querySelector('.al-modal-footer');
        const header = overlay.querySelector('.al-modal-header');

        if (header) header.innerText = "Autoleveling in Progress...";

        body.innerHTML = `
            <div style="margin-bottom: 10px;">Probing surface points...</div>
            <div class="progress-container" style="display: block; background: #eee; height: 15px; border-radius: 8px; overflow: hidden; border: 1px solid #ccc;">
                <div id="al-modal-progress" style="width: 0%; height: 100%; background: #337ab7; transition: width 0.3s;"></div>
            </div>
            <div style="display: flex; justify-content: space-between; margin-top: 5px; font-size: 11px; color: #777;">
                <span id="al-modal-status">Initializing...</span>
                <span id="al-modal-time"></span>
            </div>
        `;

        // Replace footer buttons with Stop
        footer.innerHTML = '';
        const btnStop = document.createElement('button');
        btnStop.className = 'al-btn';
        btnStop.style.backgroundColor = '#d9534f';
        btnStop.style.color = 'white';
        btnStop.style.borderColor = '#d43f3a';
        btnStop.innerText = 'Stop / Cancel';
        btnStop.onclick = () => {
            if (this.onStop) this.onStop();
            overlay.remove();
        };
        footer.appendChild(btnStop);
    }

    updateProgress(current, total, timeRemaining) {
        if (!this.canAccessParent()) return;
        const parentDoc = window.parent.document;
        const bar = parentDoc.getElementById('al-modal-progress');
        const status = parentDoc.getElementById('al-modal-status');
        const timeEl = parentDoc.getElementById('al-modal-time');

        if (bar && total > 0) {
            const pct = (current / total) * 100;
            bar.style.width = pct + '%';
        }
        if (status) {
            status.innerText = `Point ${current} / ${total}`;
        }
        if (timeEl && timeRemaining) {
            timeEl.innerText = timeRemaining;
        } else if (timeEl) {
            timeEl.innerText = '';
        }
    }

    transitionToSkewProbe(overlay) {
        const body = overlay.querySelector('.al-modal-body');
        const footer = overlay.querySelector('.al-modal-footer');
        const header = overlay.querySelector('.al-modal-header');

        if (header) header.innerText = "Measuring Skew...";

        // Simple status display
        body.innerHTML = `
            <div style="margin: 20px 0; font-size: 16px;">
                <i class="fa fa-spinner fa-spin" style="font-size: 24px; margin-right: 10px;"></i>
                <span id="al-skew-status">Initializing...</span>
            </div>
            <div style="font-size: 12px; color: #777;">Please wait while the machine probes two points.</div>
        `;

        // Footer with Stop button
        footer.innerHTML = '';
        const btnStop = document.createElement('button');
        btnStop.className = 'al-btn al-btn-danger';
        btnStop.innerText = 'Stop';
        btnStop.onclick = () => {
            if (this.onStop) this.onStop();
            overlay.remove();
        };
        footer.appendChild(btnStop);
    }

    transitionToSkewProbeLocal() {
        const header = document.querySelector('#confirmModal .modal-header');
        const body = document.getElementById('confirmBody');
        const btn = document.getElementById('btnConfirmRun');

        if (header) header.innerText = "Measuring Skew...";
        if (body) {
            body.innerHTML = `
            <div style="text-align: center; padding: 20px;">
                <i class="fa fa-spinner fa-spin" style="font-size: 24px; margin-bottom: 15px;"></i>
                <div id="local-skew-status" style="font-weight: bold;">Initializing...</div>
                <div style="margin-top: 10px; color: #777;">Please wait...</div>
            </div>`;
        }

        if (btn) {
            btn.innerText = "Stop";
            btn.classList.add('btn-danger');
            btn.classList.remove('primary');
            // Re-bind to stop
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener('click', () => {
                if (this.onStop) this.onStop();
                this.close();
            });
        }
    }

    updateSkewStatus(message) {
        // Parent Overlay
        if (this.canAccessParent()) {
            const msgEl = window.parent.document.getElementById('al-skew-status');
            if (msgEl) msgEl.innerText = message;
        }

        // Local Modal
        const localEl = document.getElementById('local-skew-status');
        if (localEl) localEl.innerText = message;
    }

    // Called from Main Controller to execute local run
    runLocal() {
        if (this.pendingGcode === '(skew_start)') {
            if (this.startSkewProbe) this.startSkewProbe(this.skewSpacing);
            this.transitionToSkewProbeLocal();
        } else if (this.pendingGcode) {
            if (this.sendGcode) this.sendGcode(this.pendingGcode);
            this.close();
        }
    }
}

window.ModalManager = ModalManager;

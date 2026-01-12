/* eslint-disable no-useless-escape */
const SocketWrap = require('./socketwrap')
const fs = require('fs')
const Mesh = require('./mesh')


const alFileNamePrefix = '#AL:'

const path = require('path');
const DEFAULT_PROBE_FILE = path.join(__dirname, '../../__last_Z_probe.txt');
const SETTINGS_FILE = path.join(__dirname, '../../autolevel_settings.json');
const STATE_FILE = path.join(__dirname, '../../autolevel_state.json');


const Units = {
  MILLIMETERS: 1,
  INCHES: 2,

  convert: function (value, in_units, out_units) {
    if (in_units == out_units) {
      return value;
    }
    if (in_units == this.MILLIMETERS && out_units == this.INCHES) {
      return value / 25.4;
    }
    if (in_units == this.INCHES && out_units == this.MILLIMETERS) {
      return value * 25.4;
    }
  }
}

Object.freeze(Units);

module.exports = class Autolevel {
  constructor(socket, options) {
    this.gcodeFileName = ''
    this.gcode = ''
    this.sckw = new SocketWrap(socket, options.port)
    this.outDir = options.outDir;
    this.delta = 10.0 // step
    this.feed = 50 // probing feedrate
    this.height = 2 // travelling height
    this.probedPoints = []
    this.min_dz = 0;
    this.max_dz = 0;
    this.sum_dz = 0;
    this.planedPointCount = 0
    this.probeFile = 0;
    this.wco = {
      x: 0,
      y: 0,
      z: 0
    }
    this.skewAngle = 0; // Skew angle in radians. Positive = Counter-Clockwise rotation of the part.
    this.mpos = { x: 0, y: 0, z: 0 };
    this.pos = { x: 0, y: 0, z: 0 };
    this.gcodeBounds = null;
    this.gcodeBounds = null;
    this.buffer = ''; // Line buffer for serial data
    this.g54Offset = null; // Store G54 offset explicitly
    this.gcodeBounds = null;
    this.buffer = ''; // Line buffer for serial data
    this.g54Offset = null; // Store G54 offset explicitly
    this.zZeroOffset = null; // Store initial Z probe for relative Z calculation
    this.commandQueue = []; // Drip feed queue


    // Listen for controller state updates to track position
    socket.on('controller:state', (state) => {
      if (state && state.status) {
        const { mpos, wco } = state.status;
        if (mpos) {
          this.mpos = mpos;
        }
        if (wco) {
          this.wco = wco;
        }
        // derive pos from mpos and wco if needed, or rely on cncjs to send it.
        // Usually pos = mpos - wco.
        if (mpos && wco) {
          this.pos = {
            x: mpos.x - wco.x,
            y: mpos.y - wco.y,
            z: mpos.z - wco.z
          }
        }
      }
    });

    // Load Persistent State (Skew)
    try {
      if (fs.existsSync(STATE_FILE)) {
        const stateData = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        if (stateData.skewAngle !== undefined) {
          this.skewAngle = stateData.skewAngle;
          console.log(`Loaded persisted skew angle: ${(this.skewAngle * 180 / Math.PI).toFixed(3)} deg`);
        }
      }
    } catch (err) {
      console.error('Failed to load autolevel state:', err);
    }

    // Try to read in any pre-existing probe data...
    // Try to read in any pre-existing probe data...
    try {
      if (fs.existsSync(DEFAULT_PROBE_FILE)) {
        console.log(`Loading previous probe from ${DEFAULT_PROBE_FILE}`)
        const data = fs.readFileSync(DEFAULT_PROBE_FILE, 'utf8');
        this.sckw.sendMessage(`(AL: DEBUG: Loading probe file: ${DEFAULT_PROBE_FILE})`);

        this.probedPoints = [];
        let lines = data.split('\n');
        let pnum = 0;
        lines.forEach(line => {
          let vals = line.split(' ');
          if (vals.length >= 3) {
            let pt = {
              x: parseFloat(vals[0]),
              y: parseFloat(vals[1]),
              z: parseFloat(vals[2])
            };
            this.probedPoints.push(pt);
            pnum++;
          }
        });
        console.log(`Read ${this.probedPoints.length} probed points from previous session`);
        this.sckw.sendMessage(`(AL: DEBUG: Loaded ${this.probedPoints.length} points)`);
      } else {
        this.sckw.sendMessage(`(AL: DEBUG: Probe file not found: ${DEFAULT_PROBE_FILE})`);
      }
    } catch (err) {
      console.log(`Failed to read probed points from previous session: ${err}`);
      this.probedPoints = [];
      this.sckw.sendMessage(`(AL: DEBUG: Error reading probe file: ${err.message})`);
    }

    socket.on('gcode:load', (file, gc) => {
      // Allow loading #AL files to enable chaining
      // if (!file.startsWith(alFileNamePrefix)) {
      this.gcodeFileName = file
      this.gcode = gc
      console.log('gcode loaded:', file)
      this.sckw.sendMessage(`(AL: DEBUG: gcode:load - SkewAngle: ${(this.skewAngle * 180 / Math.PI).toFixed(3)} deg, File: ${file})`);

      // Calculate bounds manually using regex (more robust than library dependencies in this context)
      this.gcodeBounds = {
        min: { x: Infinity, y: Infinity },
        max: { x: -Infinity, y: -Infinity }
      };

      const lines = gc.split('\n');
      let abs = true; // Assume absolute positioning by default
      let units = 1; // 1 = MM, 2 = Inches (matches Units.MILLIMETERS)

      // Helper to convert to MM
      const toMM = (val, u) => (u === 2 ? val * 25.4 : val);

      let hasMoves = false;

      lines.forEach(line => {
        const lineStripped = this.stripComments(line);

        // Check modes
        if (/G90/i.test(lineStripped)) abs = true;
        if (/G91/i.test(lineStripped)) abs = false;
        if (/G20/i.test(lineStripped)) units = 2;
        if (/G21/i.test(lineStripped)) units = 1;

        // Only track absolute moves for bounds
        if (abs && /(X|Y)/i.test(lineStripped)) {
          const xMatch = /X([\.\+\-\d]+)/gi.exec(lineStripped);
          const yMatch = /Y([\.\+\-\d]+)/gi.exec(lineStripped);

          if (xMatch) {
            const x = toMM(parseFloat(xMatch[1]), units);
            if (x < this.gcodeBounds.min.x) this.gcodeBounds.min.x = x;
            if (x > this.gcodeBounds.max.x) this.gcodeBounds.max.x = x;
            hasMoves = true;
          }
          if (yMatch) {
            const y = toMM(parseFloat(yMatch[1]), units);
            if (y < this.gcodeBounds.min.y) this.gcodeBounds.min.y = y;
            if (y > this.gcodeBounds.max.y) this.gcodeBounds.max.y = y;
            hasMoves = true;
          }
        }
      });

      if (!hasMoves) {
        this.gcodeBounds = null;
        console.log('No bounds detected in G-code.');
      } else {
        console.log('Calculated G-code bounds:', this.gcodeBounds);
      }
      // }
    })

    socket.on('gcode:unload', () => {
      this.gcodeFileName = ''
      this.gcode = ''
      console.log('gcode unloaded')
    })

    socket.on('serialport:read', (data) => {
      // DEBUG: Log raw data length and snippet
      // console.log(`DEBUG: Raw Serial Data (${data.length}): ${JSON.stringify(data.toString())}`);

      // Append new data to buffer
      this.buffer += data.toString();

      // Check for G54 parameters response: [G54:0.000,0.000,0.000]
      const g54Match = /\[G54:([\.\+\-\d]+),([\.\+\-\d]+),([\.\+\-\d]+)\]/.exec(this.buffer);
      if (g54Match) {
        this.g54Offset = {
          x: parseFloat(g54Match[1]),
          y: parseFloat(g54Match[2]),
          z: parseFloat(g54Match[3])
        };
        console.log('DEBUG: Captured G54 offset:', this.g54Offset);
      }

      // Check for WCO report immediately in the incoming chunk or buffer
      // Format: <Optionally other stuff|WCO:0.000,10.000,5.000|Optionally other stuff>
      // or just WCO:x,y,z if parsed from a line.
      // We check the raw string for resilience against buffer cutting
      const wcoMatch = /WCO:([\.\+\-\d]+),([\.\+\-\d]+),([\.\+\-\d]+)/.exec(this.buffer);
      if (wcoMatch) {
        this.wco = {
          x: parseFloat(wcoMatch[1]),
          y: parseFloat(wcoMatch[2]),
          z: parseFloat(wcoMatch[3])
        };
        // console.log('DEBUG: WCO Updated via serial:', this.wco);
      }

      // Process all complete lines in buffer
      // Pattern-based processing (Robust to missing newlines)
      if (this.buffer.length > 5000) {
        // Find the first newline after the cut point to ensure we don't slice a message
        // Keep 4000 chars, so cut at length - 4000
        const retainLength = 4000;
        const cutStart = this.buffer.length - retainLength;
        const newlineIndex = this.buffer.indexOf('\n', cutStart);

        if (newlineIndex !== -1) {
          this.buffer = this.buffer.substring(newlineIndex + 1);
        } else {
          // Fallback if no newline found in the last chunk
          console.log('DEBUG: Trimming large buffer (no newline found in tail)');
          this.buffer = this.buffer.substring(cutStart);
        }
      }

      while (true) {
        const startIndex = this.buffer.indexOf('[PRB:');
        if (startIndex < 0) break;

        const endIndex = this.buffer.indexOf(']', startIndex);
        if (endIndex < 0) break; // Incomplete message

        const prbLine = this.buffer.substring(startIndex, endIndex + 1);
        // Remove processed part
        this.buffer = this.buffer.substring(endIndex + 1);

        console.log('DEBUG: Processing extracted PRB chunk:', prbLine);

        // Relaxed Regex: Handles optional spaces, optional 4th coordinate, optional success flag
        let prbm = /\[PRB:\s*([\+\-\.\d]+)\s*,\s*([\+\-\.\d]+)\s*,\s*([\+\-\.\d]+)/.exec(prbLine)
        if (prbm) {
          let prb = [parseFloat(prbm[1]), parseFloat(prbm[2]), parseFloat(prbm[3])]
          let pt = {
            x: prb[0], // Placeholder
            y: prb[1],
            z: prb[2]
          }

          // Use G54 offset if available for X/Y/Z, otherwise fallback to WCO
          // We assume X/Y/Z are constant relative to G54 (since we removed G10 Z-reset).
          if (this.g54Offset) {
            pt.x = prb[0] - this.g54Offset.x;
            pt.y = prb[1] - this.g54Offset.y;
            pt.z = prb[2] - this.g54Offset.z;
          } else {
            pt.x = prb[0] - this.wco.x;
            pt.y = prb[1] - this.wco.y;
            pt.z = prb[2] - this.wco.z;
          }

          if (this.probeFile) {
            fs.writeSync(this.probeFile, `${pt.x} ${pt.y} ${pt.z} 0 0 0 0 0 0\n`);
          }

          if (this.planedPointCount > 0) {
            if (this.probedPoints.length === 0) {
              this.min_dz = pt.z;
              this.max_dz = pt.z;
              this.sum_dz = pt.z;
            } else {
              if (pt.z < this.min_dz) this.min_dz = pt.z;
              if (pt.z > this.max_dz) this.max_dz = pt.z;
              this.sum_dz += pt.z;
            }
            this.probedPoints.push(pt)
            this.sckw.sendMessage(`(AL: PROBED ${pt.x} ${pt.y} ${pt.z})`)
            // Report accurate progress based on ACTUAL probed points
            this.sckw.sendMessage(`(AL: progress ${this.probedPoints.length} ${this.planedPointCount})`)

            console.log('probed ' + this.probedPoints.length + '/' + this.planedPointCount + '>', pt.x.toFixed(3), pt.y.toFixed(3), pt.z.toFixed(3))

            // Trigger next command in Drip Feed
            this.processQueue();

            if (this.probedPoints.length >= this.planedPointCount) {
              console.log('DEBUG: Probing complete. Total points: ' + this.probedPoints.length);
              this.sckw.sendMessage(`(AL: dz_min=${this.min_dz.toFixed(3)}, dz_max=${this.max_dz.toFixed(3)}, dz_avg=${(this.sum_dz / this.probedPoints.length).toFixed(3)})`);
              if (this.probeFile) {
                this.fileClose();
              }
              if (!this.probeOnly) {
                console.log('DEBUG: Calling applyCompensation (Mesh+Skew)...');
                this.applyCompensation({ skew: true, mesh: true })
              } else {
                console.log('DEBUG: Probe Only mode. Finished.');
                this.sckw.sendMessage('(AL: finished)');
              }
              this.planedPointCount = 0
              this.wco = { x: 0, y: 0, z: 0 }
            }
          } else {
            console.log('DEBUG: Ignored PRB (planedPointCount <= 0):', this.planedPointCount);
          }
        } else {
          console.log('DEBUG: Failed to parse PRB line:', prbLine);
        }
      }
    })

    //  this.socket.emit.apply(socket, ['write', this.port, "gcode", "G91 G1 Z1 F1000"]);
  }

  fileOpen(fileName) {
    try {
      this.probeFile = fs.openSync(fileName, "w");
      console.log(`Opened probe file ${fileName}`);
      this.sckw.sendMessage(`(AL: Opened probe file ${fileName})`)
    }
    catch (err) {
      this.probeFile = 0;
      this.sckw.sendMessage(`(AL: Could not open probe file ${err})`)
    }
  }

  fileClose() {
    if (this.probeFile) {
      console.log('Closing probe file');
      fs.closeSync(this.probeFile);
      this.probeFile = 0;
    }
  }

  clearMesh() {
    this.probedPoints = [];
    this.mesh = null;
    this.planedPointCount = 0;
    this.min_dz = 0;
    this.max_dz = 0;
    this.sum_dz = 0;

    // Clear the probe file on disk
    try {
      if (fs.existsSync(DEFAULT_PROBE_FILE)) {
        fs.truncateSync(DEFAULT_PROBE_FILE, 0);
        console.log(`Cleared probe file: ${DEFAULT_PROBE_FILE}`);
      }
    } catch (err) {
      console.error(`Failed to clear probe file: ${err.message}`);
    }

    this.sckw.sendMessage('(AL: mesh cleared)');
    console.log('Mesh cleared via command');
  }

  dumpMesh() {
    if (this.probedPoints.length === 0) {
      this.sckw.sendMessage('(AL: no mesh data - points array is empty)')
      return
    }
    this.sckw.sendMessage('(AL: dumping mesh start)')

    // Pack points to reduce "ok" spam
    let buffer = '(AL: D';
    let count = 0;

    this.probedPoints.forEach((pt, index) => {
      const ptStr = ` ${pt.x.toFixed(3)},${pt.y.toFixed(3)},${pt.z.toFixed(3)}`;

      // Grbl line limit is usually 128. Keep it safe at ~125.
      if (buffer.length + ptStr.length > 125) {
        this.sckw.sendMessage(buffer + ')');
        buffer = '(AL: D' + ptStr;
        count = 1;
      } else {
        buffer += ptStr;
        count++;
      }
    });

    // Flush remaining
    if (count > 0) {
      this.sckw.sendMessage(buffer + ')');
    }

    this.sckw.sendMessage('(AL: finished)')
  }

  reapply(cmd, context) {
    if (!this.gcode) {
      this.sckw.sendMessage('(AL: no gcode loaded)')
      return
    }
    if (this.probedPoints.length < 3 && Math.abs(this.skewAngle) < 1e-6) {
      this.sckw.sendMessage('(AL: no previous autolevel points or skew)')
      return;
    }
    // Default reapply behavior: Try both if available
    this.applyCompensation({ skew: true, mesh: true });
    this.dumpMesh();
  }

  setSkew(cmd, context) {
    let a = /A([\.\+\-\d]+)/gi.exec(cmd);
    if (a) {
      // Input angle assumed to be in degrees
      const angleDeg = parseFloat(a[1]);
      // Convert to radians
      this.skewAngle = angleDeg * Math.PI / 180;
      console.log(`Skew angle set to: ${angleDeg} deg (${this.skewAngle} rad)`);
      this.sckw.sendMessage(`(AL: Skew angle set to ${angleDeg.toFixed(3)} deg)`);
    } else {
      // If no argument, reset? or report?
      this.sckw.sendMessage(`(AL: Current Skew: ${(this.skewAngle * 180 / Math.PI).toFixed(3)} deg)`);
    }
    this.saveState();
  }

  saveState() {
    try {
      const state = {
        skewAngle: this.skewAngle
      };
      fs.writeFileSync(STATE_FILE, JSON.stringify(state));
    } catch (err) {
      console.error('Error saving autolevel state:', err);
    }
  }

  fetchSettings() {
    try {
      if (fs.existsSync(SETTINGS_FILE)) {
        const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
        console.log('Settings loaded from file:', SETTINGS_FILE);
        // Compact it for sending? It's JSON, should be fine.
        // We will send it as a single line command response
        this.sckw.sendMessage(`(AL: SETTINGS ${data})`);
      } else {
        console.log('No settings file found, sending empty object.');
        this.sckw.sendMessage('(AL: SETTINGS {})');
      }
      this.sckw.sendMessage(`(AL: Current Skew: ${(this.skewAngle * 180 / Math.PI).toFixed(3)} deg)`);
      if (this.gcodeFileName) {
        this.sckw.sendMessage(`(AL: Loaded File: ${this.gcodeFileName})`);
      }
    } catch (err) {
      console.error('Error reading settings file:', err);
      this.sckw.sendMessage('(AL: ERROR: Could not read settings)');
    }
  }

  saveSettings(cmd) {
    // CMD format: (autolevel_save_settings <JSON_STRING>)
    // We need to extract the JSON string.
    // It's safer to rely on a specific marker or just parse valid JSON from the end.
    // Let's assume the command is: (autolevel_save_settings { ... })
    // We can strip the prefix and the trailing ')'

    const prefix = 'settings ';
    const idx = cmd.indexOf(prefix);
    if (idx === -1) {
      console.error('Invalid save settings command format');
      return;
    }

    let jsonStr = cmd.substring(idx + prefix.length).trim();
    // remove trailing ')' if present (it should be)
    if (jsonStr.endsWith(')')) {
      jsonStr = jsonStr.substring(0, jsonStr.length - 1);
    }

    try {
      // Validate JSON
      JSON.parse(jsonStr);
      fs.writeFileSync(SETTINGS_FILE, jsonStr);
      console.log('Settings saved to:', SETTINGS_FILE);
      this.sckw.sendMessage('(AL: Settings saved successfully)');
    } catch (err) {
      console.error('Error saving settings:', err);
      this.sckw.sendMessage(`(AL: ERROR: Could not save settings - ${err.message})`);
    }
  }

  /**
   * Rotates a point around (0,0) by this.skewAngle
   * @param {Object} pt {x, y, z}
   * @returns {Object} Rotated point
   */
  rotatePoint(pt) {
    if (Math.abs(this.skewAngle) < 1e-6) return pt;

    // Rotation Matrix for Counter-Clockwise rotation:
    // x' = x cos(theta) - y sin(theta)
    // y' = x sin(theta) + y cos(theta)

    const cos = Math.cos(this.skewAngle);
    const sin = Math.sin(this.skewAngle);

    return {
      x: pt.x * cos - pt.y * sin,
      y: pt.x * sin + pt.y * cos,
      z: pt.z
    };
  }

  start(cmd, context) {
    console.log(cmd, context)

    // A parameter of P1 indicates a "probe only", and that
    // the results should NOT be applied to any loaded GCode.
    // The default value is "false"
    this.probeOnly = 0;
    let p = /P([\.\+\-\d]+)/gi.exec(cmd)
    if (p) this.probeOnly = parseFloat(p[1])

    if (!this.gcode) {
      this.sckw.sendMessage('(AL: no gcode loaded)')
      if (!this.probeOnly) {
        return
      }
    }

    if (!this.probeFile) {
      // Since no explicit command was given to open the probe recording
      // file, record the probe entries to be reused (in case of system
      // restart)
      this.fileOpen(DEFAULT_PROBE_FILE);
    }

    this.sckw.sendMessage('(AL: auto-leveling started)')
    let m = /D([\.\+\-\d]+)/gi.exec(cmd)
    if (m) this.delta = parseFloat(m[1])

    let h = /H([\.\+\-\d]+)/gi.exec(cmd)
    if (h) this.height = parseFloat(h[1])

    let f = /F([\.\+\-\d]+)/gi.exec(cmd)
    if (f) this.feed = parseFloat(f[1])

    let margin = this.delta / 4;

    let mg = /M([\.\+\-\d]+)/gi.exec(cmd)
    if (mg) margin = parseFloat(mg[1])


    let xSize, ySize;
    let xs = /X([\.\+\-\d]+)/gi.exec(cmd)
    if (xs) xSize = parseFloat(xs[1])

    let ys = /Y([\.\+\-\d]+)/gi.exec(cmd)
    if (ys) ySize = parseFloat(ys[1])

    let grid;
    let gd = /GRID([\.\+\-\d]+)/gi.exec(cmd);
    if (gd) grid = parseFloat(gd[1]);

    let area;
    if (xSize) {
      area = `(${xSize}, ${ySize})`
    }
    else {
      area = 'Not specified'
    }
    console.log(`STEP: ${this.delta} mm HEIGHT:${this.height} mm FEED:${this.feed} MARGIN: ${margin} mm  PROBE ONLY:${this.probeOnly}  Area: ${area} GRID: ${grid}`)

    // Use tracked wco if available, otherwise fallback to context (though context is unreliable for wco usually)
    // The loop above updates this.wco from controller:state, so we should trust it.
    // However, context.mposx etc might be useful if available.
    // Let's rely on our tracked state if possible.
    this.sckw.sendMessage('$#');

    // Force a status update to ensure WCO is fresh before we really get going
    // This is asynchronous, but usually fast enough to beat the probe response.
    this.sckw.socket.emit('write', this.sckw.port, '?');

    // Attempt to grab WCO from context if available (immediate)
    if (context && context.status && context.status.wco) {
      this.wco = context.status.wco;
      console.log('DEBUG: Initialized WCO from context.status:', this.wco);
    } else if (context && context.wco) {
      this.wco = context.wco;
      console.log('DEBUG: Initialized WCO from context.wco:', this.wco);
    }


    // We already have this.wco updated from controller:state
    console.log('Using tracked WCO:', this.wco)

    this.probedPoints = []
    this.planedPointCount = 0
    this.zZeroOffset = null; // Reset for new run
    this.probedPoints = []
    this.planedPointCount = 0
    this.zZeroOffset = null; // Reset for new run
    this.commandQueue = []; // Reset queue


    let xmin, xmax, ymin, ymax;
    if (xSize) {
      xmin = margin;
      xmax = xSize - margin;
    }
    else {
      // Use calculated bounds if available, fallback to context
      if (this.gcodeBounds) {
        xmin = this.gcodeBounds.min.x + margin;
        xmax = this.gcodeBounds.max.x - margin;
      } else {
        console.log("No bounds available, falling back to context (might be NaN)");
        xmin = context.xmin + margin;
        xmax = context.xmax - margin;
      }
    }

    if (ySize) {
      ymin = margin;
      ymax = ySize - margin;
    }
    else {
      if (this.gcodeBounds) {
        ymin = this.gcodeBounds.min.y + margin;
        ymax = this.gcodeBounds.max.y - margin;
      } else {
        ymin = context.ymin + margin;
        ymax = context.ymax - margin;
      }
    }

    let dx, dy;
    if (grid) {
      if (grid < 2) grid = 2; // Minimum 2 points to define a range
      dx = (xmax - xmin) / (grid - 1);
      dy = (ymax - ymin) / (grid - 1);
    } else {
      dx = (xmax - xmin) / parseInt((xmax - xmin) / this.delta)
      dy = (ymax - ymin) / parseInt((ymax - ymin) / this.delta)
    }
    let setupBlock = [];
    setupBlock.push('(AL: probing initial point)')
    setupBlock.push(`G54`) // Ensure we are in Work Coordinate System 1
    setupBlock.push(`G21`)
    setupBlock.push(`G90`)
    setupBlock.push(`G0 Z${this.height}`)
    let ptInit = { x: xmin, y: ymin, z: this.height };
    // if (Math.abs(this.skewAngle) > 1e-6) {
    //   ptInit = this.rotatePoint(ptInit);
    // }
    setupBlock.push(`G0 X${ptInit.x.toFixed(3)} Y${ptInit.y.toFixed(3)} Z${ptInit.z.toFixed(3)}`)
    setupBlock.push(`G38.2 Z-${this.height + 1} F${this.feed / 2}`)
    // code.push(`G10 L20 P1 Z0`) // REMOVED: Do not reset Z to 0, respect existing WCO
    setupBlock.push(`G0 Z${this.height}`)
    this.planedPointCount++

    // Push setup block as the first item in the queue
    this.commandQueue.push(setupBlock.join('\n'));

    let y = ymin - dy
    let rowIndex = 0

    while (y < ymax - 0.01) {
      y += dy
      if (y > ymax) y = ymax

      let xPoints = []
      let x = xmin - dx
      while (x < xmax - 0.01) {
        x += dx
        if (x > xmax) x = xmax
        xPoints.push(x)
      }

      if (rowIndex % 2 !== 0) {
        xPoints.reverse()
      }

      for (let x of xPoints) {
        // don't probe first point twice (it is probed before the loop)
        if (rowIndex === 0 && Math.abs(x - xmin) < 0.001) continue

        let pointBlock = [];
        // REMOVED predictive comment: code.push(`(AL: probing point ${this.planedPointCount + 1})`)
        let ptLoop = { x: x, y: y, z: this.height };
        // if (Math.abs(this.skewAngle) > 1e-6) {
        //   ptLoop = this.rotatePoint(ptLoop);
        // }
        pointBlock.push(`G90 G0 X${ptLoop.x.toFixed(3)} Y${ptLoop.y.toFixed(3)} Z${ptLoop.z.toFixed(3)}`)
        pointBlock.push(`G38.2 Z-${this.height + 1} F${this.feed}`)
        pointBlock.push(`G0 Z${this.height}`)
        this.planedPointCount++

        this.commandQueue.push(pointBlock.join('\n'));
      }
      rowIndex++
    }

    this.sckw.sendMessage(`(AL: total_points ${this.planedPointCount})`)

    // Start Drip Feed
    console.log(`Drip Feed: Queue size ${this.commandQueue.length}`);
    this.processQueue();
  }

  processQueue() {
    if (this.commandQueue.length === 0) {
      console.log("Drip Feed: Queue empty.");
      return;
    }
    const cmd = this.commandQueue.shift();
    // console.log("Drip Feed: Sending block", cmd); // Verbose
    this.sckw.sendGcode(cmd);
  }

  stop() {
    console.log("Drip Feed: Stop requested. Clearing queue.");
    this.commandQueue = [];
    this.sckw.sendMessage('(AL: Drip Feed Stopped)');
  }

  updateContext(context) {
    if (this.wco.z != 0 &&
      context.mposz !== undefined &&
      context.posz !== undefined) {
      let wcoz = context.mposz - context.posz;
      if (Math.abs(this.wco.z - wcoz) > 0.00001) {
        this.wco.z = wcoz;
        console.log('WARNING: WCO Z offset drift detected! wco.z is now: ' + this.wco.z);
      }
    }
  }

  stripComments(line) {
    const re1 = new RegExp(/\s*\([^\)]*\)/g) // Remove anything inside the parentheses
    const re2 = new RegExp(/\s*;.*/g) // Remove anything after a semi-colon to the end of the line, including preceding spaces
    const re3 = new RegExp(/\s+/g)
    return (line.replace(re1, '').replace(re2, '').replace(re3, ''))
  };

  distanceSquared3(p1, p2) {
    return (p2.x - p1.x) * (p2.x - p1.x) + (p2.y - p1.y) * (p2.y - p1.y) + (p2.z - p1.z) * (p2.z - p1.z)
  }

  distanceSquared2(p1, p2) {
    return (p2.x - p1.x) * (p2.x - p1.x) + (p2.y - p1.y) * (p2.y - p1.y)
  }

  crossProduct3(u, v) {
    return {
      x: (u.y * v.z - u.z * v.y),
      y: -(u.x * v.z - u.z * v.x),
      z: (u.x * v.y - u.y * v.x)
    }
  }

  isColinear(u, v) {
    return Math.abs(u.x * v.y - u.y * v.x) < 0.00001
  }

  sub3(p1, p2) {
    return {
      x: p1.x - p2.x,
      y: p1.y - p2.y,
      z: p1.z - p2.z
    }
  }

  formatPt(pt) {
    return `(x:${pt.x.toFixed(3)} y:${pt.y.toFixed(3)} z:${pt.z.toFixed(3)})`
  }


  /**
   * Appends point to point array only if there is a difference from last point
   * @param {*} resArray 
   * @param {*} pt 
   * @returns 
   */
  appendPointSkipDuplicate(resArray, pt) {
    if (resArray.length == 0) {
      resArray.push(pt);
      return;
    }
    const lastPt = resArray[resArray.length - 1];
    if (this.distanceSquared3(pt, lastPt) > 1e-10) {
      resArray.push(pt);
    }
    // don't append if there is no significant movement
  }

  /**
   * Splits the line segment to smaller segments, not larger than probing grid delta
   * @param {*} p1 
   * @param {*} p2 
   * @param {*} units 
   * @returns 
   */
  splitToSegments(p1, p2, units) {
    let res = []
    let v = this.sub3(p2, p1) // delta
    let dist = Math.sqrt(this.distanceSquared3(p1, p2)) // distance

    if (dist < 1e-10) {
      return [];
    }

    let dir = {
      x: v.x / dist,
      y: v.y / dist,
      z: v.z / dist
    } // direction vector
    let maxSegLength = Units.convert(this.delta, Units.MILLIMETERS, units)
    if (maxSegLength <= 0.001) maxSegLength = 0.5; // Safety check to prevent infinite loop

    // res.push({
    //   x: p1.x,
    //   y: p1.y,
    //   z: p1.z
    // }) // first point - REMOVED to avoid redundant move to start position
    for (let d = maxSegLength; d < dist; d += maxSegLength) {
      this.appendPointSkipDuplicate(res, {
        x: p1.x + dir.x * d,
        y: p1.y + dir.y * d,
        z: p1.z + dir.z * d
      }) // split points
    }
    this.appendPointSkipDuplicate(res, {
      x: p2.x,
      y: p2.y,
      z: p2.z
    }) // last point    
    return res
  }

  // Argument is assumed to be in millimeters.
  getThreeClosestPoints(pt) {
    let res = []
    if (this.probedPoints.length < 3) {
      return res
    }
    this.probedPoints.sort((a, b) => {
      return this.distanceSquared2(a, pt) < this.distanceSquared2(b, pt) ? -1 : 1
    })
    let i = 0
    while (res.length < 3 && i < this.probedPoints.length) {
      if (res.length === 2) {
        // make sure points are not colinear
        if (!this.isColinear(this.sub3(res[1], res[0]), this.sub3(this.probedPoints[i], res[0]))) {
          res.push(this.probedPoints[i])
        }
      } else {
        res.push(this.probedPoints[i])
      }
      i++
    }
    return res
  }



  /**
   * Interpolates an arc (G2/G3) into linear segments for Z-compensation.
   * @param {Object} p1 Start point {x,y,z}
   * @param {Object} p2 End point {x,y,z}
   * @param {Object} args Arc arguments (I, J, K, R, P)
   * @param {boolean} clockwise True for G2, False for G3
   * @param {number} units Units constant
   * @param {number} plane Plane constant (0=XY, 1=XZ, 2=YZ)
   * @returns {Array} Array of points {x,y,z} along the arc
   */
  interpolateArc(p1, p2, args, clockwise, units, plane) {
    let points = [];
    plane = plane || 0; // Default to XY

    // Helper to map 3D point to 2D plane coordinates (u, v) and linear axis (w)
    // G17 (XY): u=x, v=y, w=z. Center offsets: I->u, J->v
    // G18 (XZ): u=z, v=x, w=y. Center offsets: K->u, I->v (Note: G18 is ZX plane usually)
    // G19 (YZ): u=y, v=z, w=x. Center offsets: J->u, K->v
    const toPlane = (p) => {
      if (plane === 1) return { u: p.z, v: p.x, w: p.y }; // XZ (Technically ZX)
      if (plane === 2) return { u: p.y, v: p.z, w: p.x }; // YZ
      return { u: p.x, v: p.y, w: p.z }; // XY
    };

    const fromPlane = (u, v, w) => {
      if (plane === 1) return { x: v, y: w, z: u };
      if (plane === 2) return { x: w, y: u, z: v };
      return { x: u, y: v, z: w };
    };

    let start = toPlane(p1);
    let end = toPlane(p2);

    // MapCenter Offsets
    let i_local = 0;
    let j_local = 0;

    if (plane === 1) { // G18 (XZ): I->X(v), K->Z(u)
      i_local = args.K || 0; // u-offset (Z)
      j_local = args.I || 0; // v-offset (X)
    } else if (plane === 2) { // G19 (YZ): J->Y(u), K->Z(v)
      i_local = args.J || 0; // u-offset
      j_local = args.K || 0; // v-offset
    } else { // G17 (XY): I->X(u), J->Y(v)
      i_local = args.I || 0;
      j_local = args.J || 0;
    }

    // Use a fixed high resolution for Arcs
    let maxSegLength = Units.convert(0.5, Units.MILLIMETERS, units);
    if (maxSegLength <= 0) maxSegLength = 0.5;

    // 1. Find Center
    let cx, cy, radius; // cx,cy here refer to u,v center

    // I, J, K mode
    if (args.I !== undefined || args.J !== undefined || args.K !== undefined) {
      cx = start.u + i_local;
      cy = start.v + j_local;
      radius = Math.sqrt(i_local * i_local + j_local * j_local);
    }
    // R mode
    else if (args.R !== undefined) {
      let r = args.R;
      let d2 = (end.u - start.u) * (end.u - start.u) + (end.v - start.v) * (end.v - start.v);
      let d = Math.sqrt(d2);

      if (d < 1e-9 || Math.abs(r) < d / 2) {
        return [p2];
      }

      let h = Math.sqrt(Math.max(0, r * r - d2 / 4));
      let x2 = (start.u + end.u) / 2;
      let y2 = (start.v + end.v) / 2;
      let dx = end.u - start.u;
      let dy = end.v - start.v;

      const isLeft = (clockwise === (r < 0));

      if (isLeft) {
        cx = x2 - dy * (h / d);
        cy = y2 + dx * (h / d);
      } else {
        cx = x2 + dy * (h / d);
        cy = y2 - dx * (h / d);
      }
      radius = Math.abs(r);
    } else {
      return [p2];
    }

    // 2. Angles
    let startAngle = Math.atan2(start.v - cy, start.u - cx);
    let endAngle = Math.atan2(end.v - cy, end.u - cx);
    let diff = endAngle - startAngle;

    // Normalize
    if (clockwise) {
      if (diff >= 0) diff -= 2 * Math.PI;
    } else {
      if (diff <= 0) diff += 2 * Math.PI;
    }

    // Apply number of turns (P)
    if (args.P !== undefined && args.P > 0) {
      let fullTurns = Math.floor(args.P);
      if (fullTurns >= 1) {
        diff += (clockwise ? -1 : 1) * (fullTurns - 1) * 2 * Math.PI;
      }
    }

    // Length of arc
    let arcLen = Math.abs(diff * radius);

    // FIX: Detect "Corkscrew" artifact where noise causes a tiny segment to be interpreted as a full circle.
    // Heuristic: If the generated arc length is disproportionately larger than the chord length (straight line distance),
    // and the chord length is small (suggesting a tiny move was intended), we linearize it.
    // A full circle (360 deg) has arcLen = 2*PI*R. Chord = 0 (or close to it). 
    // If the user INTENDED a full circle, P1 would be approx P2.
    // If P1 differs from P2 (chord > epsilon), and we generated a huge arc, it's likely a direction flip error.

    let chordLen = Math.sqrt(this.distanceSquared2(p1, p2));

    // Thresholds:
    // 1. Chord is "small" (e.g. < 2mm or < 0.1 inches). Let's use 1.0mm as safe upper bound for "tiny segments".
    // 2. ArcLen is "huge" compared to Chord (e.g. > 10x). 
    //    A semicircle (180 deg) has Arc/Chord = 1.57. 
    //    A 300 deg arc has Arc/Chord of high value. 
    //    A full circle artifact has Arc/Chord > 100 usually.
    //    Let's check for ArcLen > 5 * ChordLen.

    let smallChordThresh = Units.convert(1.0, Units.MILLIMETERS, units); // 1mm
    // Check chordLen against threshold (must be non-zero to avoid div by zero, though logic handles it)

    if (chordLen > 1e-9 && chordLen < smallChordThresh) {
      if (arcLen > 10 * chordLen) {
        console.log(`AL: Auto-correction - Linearized potential arc artifact. Chord:${chordLen.toFixed(4)} Arc:${arcLen.toFixed(4)}`);
        return [p2];
      }
    }

    let segments = Math.ceil(arcLen / maxSegLength);
    if (segments < 1) segments = 1;

    let thetaStep = diff / segments;
    let wStep = (end.w - start.w) / segments;

    for (let i = 1; i <= segments; i++) {
      let angle = startAngle + i * thetaStep;
      let u = cx + radius * Math.cos(angle);
      let v = cy + radius * Math.sin(angle);
      let w = start.w + i * wStep;

      points.push(fromPlane(u, v, w));
    }

    return points;
  }



  applyCompensation(opts = { skew: true, mesh: true }) {
    if (!this.gcode) {
      this.sckw.sendMessage('(AL: No G-code loaded. Please load a file first.)');
      console.log('applyCompensation: No G-code loaded');
      return;
    }

    this.sckw.sendMessage(`(AL: applying skew=${opts.skew} mesh=${opts.mesh} ...)`)

    console.log('applying compensation ...')

    let originalSkew;
    try {
      if (opts.mesh && this.probedPoints.length >= 3) {
        // Prevent double application of Mesh
        if (this.gcodeFileName.includes('#AL:')) {
          this.sckw.sendMessage('(AL: WARNING: Mesh already applied to this file. Skipping Mesh.)');
          opts.mesh = false;
        }
      }

      if (opts.skew) {
        if (Math.abs(this.skewAngle) < 1e-6) {
          this.sckw.sendMessage('(AL: WARNING: Skew requested but angle is 0. No rotation applied.)');
          // We continue, effectively applying 0 rotation, but we warn.
        }
        else if (this.gcodeFileName.includes('#SK:')) {
          this.sckw.sendMessage('(AL: WARNING: Skew already applied to this file. Skipping Skew.)');
          opts.skew = false;
        }
      }

      this.mesh = null;
      if (opts.mesh && this.probedPoints.length >= 3) {
        console.log('DEBUG: Initializing Mesh with ' + this.probedPoints.length + ' points');
        this.mesh = new Mesh(this.probedPoints);
        console.log('DEBUG: Mesh initialized');
      } else {
        console.log('DEBUG: Mesh application skipped or insufficient points.');
      }

      console.log(`DEBUG: applyCompensation called with opts:`, opts);
      console.log(`DEBUG: skewAngle: ${this.skewAngle} (${(this.skewAngle * 180 / Math.PI).toFixed(3)} deg)`);
      console.log(`DEBUG: gcodeFileName: ${this.gcodeFileName}`);

      // Backup Skew if not applying it
      originalSkew = this.skewAngle;
      if (!opts.skew) {
        console.log('DEBUG: Skew application DISABLED for this run.');
        this.sckw.sendMessage('(AL: DEBUG: Skew application DISABLED for this run - using temporary 0 angle)');
        this.skewAngle = 0;
      } else {
        console.log('DEBUG: Skew application ENABLED.');
        this.sckw.sendMessage(`(AL: DEBUG: Skew application ENABLED - Angle: ${(this.skewAngle * 180 / Math.PI).toFixed(3)})`);
      }

      // Calculate Mesh Offset at (0,0) (Work Origin)
      this.meshZeroOffset = 0;
      try {
        this.meshZeroOffset = this.mesh.interpolateZ(0, 0);
        console.log(`DEBUG: Mesh Z-Offset at (0,0) is ${this.meshZeroOffset.toFixed(3)} mm`);
        this.sckw.sendMessage(`(AL: Mesh normalized to Z=${this.meshZeroOffset.toFixed(3)} at origin)`);
      } catch (err) {
        console.error('Failed to calculate mesh zero offset:', err);
      }

      let lines = this.gcode.split('\n')
      let p0 = { x: this.pos.x || 0, y: this.pos.y || 0, z: this.pos.z || 0 }
      let p0_initialized = true
      let pt = { x: 0, y: 0, z: undefined }

      // Plane Constants
      const PLANE_XY = 0;
      const PLANE_XZ = 1;
      const PLANE_YZ = 2;

      let abs = true
      let units = Units.MILLIMETERS
      let modalMotion = 'G0';
      let plane = PLANE_XY;

      let result = []
      let lc = 0;

      lines.forEach(line => {
        try {
          if (lc % 1000 === 0) {
            console.log(`progress info ... line: ${lc}/${lines.length}`);
            this.sckw.sendMessage(`(AL: progress ...  ${lc}/${lines.length})`)
          }
          lc++;

          if (line.match(/^\s*\([^\)]*\)\s*$/g)) {
            result.push(line.trim());
            return;
          }

          let lineStripped = this.stripComments(line)
          if (!lineStripped) {
            result.push(line);
            return;
          }

          // 1. Detect State Changes (Modal)
          if (/G91/i.test(lineStripped)) abs = false
          if (/G90/i.test(lineStripped)) abs = true
          if (/G20/i.test(lineStripped)) units = Units.INCHES
          if (/G21/i.test(lineStripped)) units = Units.MILLIMETERS
          if (/G17/i.test(lineStripped)) plane = PLANE_XY
          if (/G18/i.test(lineStripped)) plane = PLANE_XZ
          if (/G19/i.test(lineStripped)) plane = PLANE_YZ

          // Detect Group 1 Motion Modes
          let motionMatch = /(G0?[0123](?![0-9])|G38\.\d|G80)/i.exec(lineStripped);
          if (motionMatch) {
            let m = motionMatch[1].toUpperCase().replace(/^G0(\d)/, 'G$1');
            modalMotion = m;
          }

          // 2. Update Virtual Position (pt)
          let hasMove = false;
          let target = { ...pt };

          let xMatch = /X([\.\+\-\d]+)/gi.exec(lineStripped)
          if (xMatch) {
            let val = parseFloat(xMatch[1]);
            target.x = abs ? val : pt.x + val;
            hasMove = true;
          }

          let yMatch = /Y([\.\+\-\d]+)/gi.exec(lineStripped)
          if (yMatch) {
            let val = parseFloat(yMatch[1]);
            target.y = abs ? val : pt.y + val;
            hasMove = true;
          }

          let zMatch = /Z([\.\+\-\d]+)/gi.exec(lineStripped)
          if (zMatch) {
            let val = parseFloat(zMatch[1]);
            target.z = abs ? val : pt.z + val;
            hasMove = true;
          }

          if (hasMove) {
            if (/G53/i.test(lineStripped)) {
              if (xMatch) target.x = undefined;
              if (yMatch) target.y = undefined;
              if (zMatch) target.z = undefined;
            }
            pt = { ...target };
          }

          // 3. Compensation Logic

          // Always pass through non-motion commands
          if (/(G10|G92|G4|G53|G5[4-9]|M\d+)/i.test(lineStripped)) {
            result.push(line);
            if (hasMove) {
              p0 = { ...pt };
              p0_initialized = true;
            }
            return;
          }

          // If it's a motion command (or implicit motion)
          if (modalMotion === 'G0' || modalMotion === 'G1') {
            if (hasMove) {
              if (abs) {
                let fMatch = /F([\.\+\-\d]+)/gi.exec(lineStripped);
                let feedratePart = fMatch ? ` ${fMatch[0]}` : '';

                let baseCommand = lineStripped.replace(/([XYZF])([\.\+\-\d]+)/gi, '').trim();
                if (baseCommand.length === 0) {
                  baseCommand = modalMotion;
                }

                let segs = [];
                if (p0_initialized) {
                  segs = this.splitToSegments(p0, pt, units);
                }

                if (segs.length === 0) {
                  let cpt = this.compensateZCoord(pt, units)
                  let zPart = (typeof cpt.z === 'number') ? ` Z${cpt.z.toFixed(3)}` : '';
                  let newLine = `${baseCommand} X${cpt.x.toFixed(3)} Y${cpt.y.toFixed(3)}${zPart}${feedratePart}`
                  if (typeof pt.z === 'number') {
                    newLine += ` ; Z${pt.z.toFixed(3)}`
                  }
                  result.push(newLine.trim())
                  p0_initialized = true
                } else {
                  let firstSeg = true;
                  for (let seg of segs) {
                    let cpt = this.compensateZCoord(seg, units)
                    let zPart = (typeof cpt.z === 'number') ? ` Z${cpt.z.toFixed(3)}` : '';
                    let newLine = `${baseCommand} X${cpt.x.toFixed(3)} Y${cpt.y.toFixed(3)}${zPart}`

                    if (firstSeg) {
                      newLine += feedratePart;
                      firstSeg = false;
                    }

                    if (typeof seg.z === 'number') {
                      newLine += ` ; Z${seg.z.toFixed(3)}`
                    }
                    result.push(newLine.trim())
                  }
                }
                p0 = { ...pt };
                p0_initialized = true;

              } else {
                result.push(line);
                console.log('WARNING: G91 (Relative) move passed through uncompensated.');
                p0 = { ...pt };
                p0_initialized = true;
              }
            } else {
              result.push(line);
            }
          } else if (modalMotion === 'G2' || modalMotion === 'G3') {
            if (hasMove) {
              let args = {};
              let iMatch = /I([\.\+\-\d]+)/gi.exec(lineStripped);
              if (iMatch) args.I = parseFloat(iMatch[1]);

              let jMatch = /J([\.\+\-\d]+)/gi.exec(lineStripped);
              if (jMatch) args.J = parseFloat(jMatch[1]);

              let kMatch = /K([\.\+\-\d]+)/gi.exec(lineStripped);
              if (kMatch) args.K = parseFloat(kMatch[1]);

              let rMatch = /R([\.\+\-\d]+)/gi.exec(lineStripped);
              if (rMatch) args.R = parseFloat(rMatch[1]);

              let pMatch = /P([\.\+\-\d]+)/gi.exec(lineStripped);
              if (pMatch) args.P = parseFloat(pMatch[1]);

              let attributes = lineStripped.replace(new RegExp(modalMotion, 'i'), '');
              attributes = attributes.replace(/([XYZIJKRP])([\.\+\-\d]+)/gi, '').trim();

              if (p0_initialized) {
                let points = this.interpolateArc(p0, pt, args, (modalMotion === 'G2'), units, plane);

                let firstSegment = true;
                for (let ap of points) {
                  let cpt = this.compensateZCoord(ap, units);
                  let zPart = (typeof cpt.z === 'number') ? ` Z${cpt.z.toFixed(3)}` : '';
                  let newLine = `G1 X${cpt.x.toFixed(3)} Y${cpt.y.toFixed(3)}${zPart}`;

                  if (firstSegment && attributes.length > 0) {
                    newLine += ` ${attributes}`;
                    firstSegment = false;
                  }

                  if (typeof ap.z === 'number') {
                    newLine += ` ; ${modalMotion} Z${ap.z.toFixed(3)}`;
                  } else {
                    newLine += ` ; ${modalMotion}`;
                  }
                  result.push(newLine.trim());
                }

                p0 = { ...pt };
                p0_initialized = true;

              } else {
                console.log('WARNING: Arc without valid start point. Passing through.');
                result.push(line);
                p0 = { ...pt };
                p0_initialized = true;
              }
            } else {
              result.push(line);
            }
          } else {
            result.push(line);
            if (modalMotion.startsWith('G38')) {
              p0_initialized = false;
            }
          }
        } catch (lineErr) {
          console.error(`Error processing line ${lc}: ${line}`, lineErr);
          throw lineErr;
        }
      })

      let newPrefix = '';
      if (opts.mesh && this.mesh) newPrefix += '#AL:';

      // If skew was requested and is valid (non-zero) AND not already applied
      if (opts.skew && Math.abs(this.skewAngle) > 1e-6 && !this.gcodeFileName.includes('#SK:')) {
        newPrefix += '#SK:';
      }

      // If no changes applied, just return? 
      // User might expect a file reload even if nothing changed? 
      // Let's at least ensure we don't clear the file name if we didn't do anything.
      if (newPrefix === '') {
        this.sckw.sendMessage('(AL: No new compensation applied. Check warnings.)');
        // We can still proceed to write the file, effectively a copy? Or just stop.
        // Stopping is safer to avoid confusion.
        console.log('No compensation flags active or safeguards triggered. Returning.');
        return;
      }

      const newgcodeFileName = newPrefix + this.gcodeFileName;
      this.sckw.sendGcode(`(AL: loading new gcode ${newgcodeFileName} ...)`)
      console.log(`AL: loading new gcode ${newgcodeFileName} ...)`)
      const outputGCode = result.join('\n');
      console.log(`DEBUG: Resulting G-code length: ${outputGCode.length}`);

      this.sckw.loadGcode(newgcodeFileName, outputGCode)
      if (this.outDir) {
        const outputFile = this.outDir + "/" + newgcodeFileName;
        fs.writeFileSync(outputFile, outputGCode);
        this.sckw.sendGcode(`(AL: output file written to ${outputFile})`);
        console.log(`output file written to ${outputFile}`);
      }
      this.sckw.sendGcode(`(AL: finished)`)
    } catch (x) {
      console.error(x);
      let errorMsg = x.message;
      if (typeof lc !== 'undefined') {
        errorMsg = `Line ${lc}: ${errorMsg}`;
      }
      this.sckw.sendGcode(`(AL: error occurred ${errorMsg})`)
      console.log(`error occurred ${x.stack}`)
    } finally {
      // Restore Skew Angle
      if (typeof originalSkew !== 'undefined') {
        this.skewAngle = originalSkew;
      }
    }
    console.log('Leveling applied')
  }

  compensateZCoord(pt_in_or_mm, input_units) {
    if (!pt_in_or_mm) {
      throw new Error("compensateZCoord: Input point is null or undefined");
    }

    let pt_mm = {
      x: (typeof pt_in_or_mm.x === 'number') ? Units.convert(pt_in_or_mm.x, input_units, Units.MILLIMETERS) : undefined,
      y: (typeof pt_in_or_mm.y === 'number') ? Units.convert(pt_in_or_mm.y, input_units, Units.MILLIMETERS) : undefined,
      z: (typeof pt_in_or_mm.z === 'number') ? Units.convert(pt_in_or_mm.z, input_units, Units.MILLIMETERS) : undefined
    }

    if (typeof pt_mm.x !== 'number' || typeof pt_mm.y !== 'number') {
      return {
        x: pt_in_or_mm.x,
        y: pt_in_or_mm.y,
        z: pt_in_or_mm.z
      };
    }

    if (Math.abs(this.skewAngle) > 1e-6) {
      const cos = Math.cos(this.skewAngle);
      const sin = Math.sin(this.skewAngle);
      const rx = pt_mm.x * cos - pt_mm.y * sin;
      const ry = pt_mm.x * sin + pt_mm.y * cos;
      pt_mm.x = rx;
      pt_mm.y = ry;
    }

    let planeZ = 0;
    if (this.mesh) {
      try {
        planeZ = this.mesh.interpolateZ(pt_mm.x, pt_mm.y);
        planeZ -= (this.meshZeroOffset || 0);
      } catch (err) {
        console.error(`Mesh interpolation error at X${pt_mm.x} Y${pt_mm.y}:`, err);
        planeZ = 0;
      }
    }

    let newZ = (typeof pt_mm.z === 'number') ? pt_mm.z + planeZ : undefined;

    return {
      x: Units.convert(pt_mm.x, Units.MILLIMETERS, input_units),
      y: Units.convert(pt_mm.y, Units.MILLIMETERS, input_units),
      z: (typeof newZ === 'number') ? Units.convert(newZ, Units.MILLIMETERS, input_units) : undefined
    }
  }
}

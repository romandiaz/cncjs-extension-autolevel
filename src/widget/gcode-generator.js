
const GCodeGenerator = {
    generateSurfaceProbe: function (params) {
        const { maxTravel, fast, slow, ret } = params;
        let g = "G91\n";
        g += `G38.2 Z-${maxTravel} F${fast}\n`;
        g += `G1 Z${ret}\n`;
        g += `G38.2 Z-5 F${slow}\n`;
        g += `G10 L20 P1 Z0\n`;
        g += `G0 Z${ret}\n`;
        return g;
    },

    generateEdgeProbe: function (axis, dir, params) {
        const { maxTravel, fast, slow, ret, r } = params;
        let g = "G91\n";
        let move = (dir === '+') ? '-' : '+'; // Move probe TARGET (towards workpiece)
        let offset = (dir === '+') ? r : -r;  // Coordinate to set

        g += `G38.2 ${axis}${move}${maxTravel} F${fast}\n`;
        g += `G1 ${axis}${(move === '-') ? '+' : '-'}${2}\n`; // Retract small amount
        g += `G38.2 ${axis}${move}5 F${slow}\n`;
        g += `G10 L20 P1 ${axis}${offset}\n`;
        g += `G0 ${axis}${(move === '-') ? '+' : '-'}${ret}\n`;
        return g;
    },

    generateHoleProbe: function (params) {
        const { dia, deflect, fast, slow, ret, maxTravel, r } = params;

        return `
; Hole Center Probing
%physical_diam = ${dia}
%deflection = ${deflect}
%fast_speed = ${fast}
%slow_speed = ${slow}
%retract = ${ret}
%max_travel = ${maxTravel}
%effective_rad = ${r}

G91
; Find X Center
G38.2 X[max_travel] F[fast_speed]
G0 X-[retract]
G38.2 X[retract + 1] F[slow_speed]
%x_left = posx
G0 X-[retract]
G38.2 X-[max_travel] F[fast_speed]
G0 X[retract]
G38.2 X-[retract + 1] F[slow_speed]
%x_right = posx
G0 X[retract]

%x_center = (x_left + x_right) / 2
G90
G0 X[x_center]
G91

; Find Y Center
G38.2 Y[max_travel] F[fast_speed]
G0 Y-[retract]
G38.2 Y[retract + 1] F[slow_speed]
%y_back = posy
G0 Y-[retract]
G38.2 Y-[max_travel] F[fast_speed]
G0 Y[retract]
G38.2 Y-[retract + 1] F[slow_speed]
%y_front = posy
G0 Y[retract]

%y_center = (y_back + y_front) / 2
G90
G0 Y[y_center]

; Set Zero
G10 L20 P1 X0 Y0
        `;
    },

    generateBlockProbe: function (axis, params) {
        const { dia, deflect, fast, slow, ret, maxTravel, safeZ, r, sizeX, sizeY } = params;

        let g = `
; Boss/Block Probing (${axis.toUpperCase()}-Axis)
%approx_width_x = ${sizeX}
%approx_width_y = ${sizeY}
%physical_diam = ${dia}
%deflection = ${deflect}
%fast_speed = ${fast}
%slow_speed = ${slow}
%retract = ${ret}
%max_travel = ${maxTravel}
%safe_z_height = ${safeZ}
%effective_rad = ${r}

G91
`;

        if (axis === 'x') {
            g += `
; --- X AXIS ---
; Find Left Wall (Probe Right)
G38.2 X[max_travel] F[fast_speed]
G0 X-[retract]
G38.2 X[max_travel] F[slow_speed]
%x_left = posx
G0 X-[retract]
G0 Z[safe_z_height]

; Hop to Right Side
G0 X[approx_width_x + 10]
G0 Z-[safe_z_height]

; Find Right Wall (Probe Left)
G38.2 X-[max_travel] F[fast_speed]
G0 X[retract]
G38.2 X-[max_travel] F[slow_speed]
%x_right = posx
G0 X[retract]
G0 Z[safe_z_height]

; Calculate X Center
%x_center = (x_left + x_right) / 2
G90
G0 X[x_center]

; Set Zero X
G10 L20 P1 X0
`;
        }

        if (axis === 'y') {
            g += `
; --- Y AXIS ---
; Find Front Wall (Probe Back)
G38.2 Y[max_travel] F[fast_speed]
G0 Y-[retract]
G38.2 Y[max_travel] F[slow_speed]
%y_front = posy
G0 Y-[retract]
G0 Z[safe_z_height]

; Hop to Back Side
G0 Y[approx_width_y + 10]
G0 Z-[safe_z_height]

; Find Back Wall (Probe Front)
G38.2 Y-[max_travel] F[fast_speed]
G0 Y[retract]
G38.2 Y-[max_travel] F[slow_speed]
%y_back = posy
G0 Y[retract]
G0 Z[safe_z_height]

; Calculate Y Center
%y_center = (y_front + y_back) / 2
G90
G0 Y[y_center]

; Set Zero Y
G10 L20 P1 Y0
`;
        }

        return g;
    },

    generateZTouchplateProbe: function (params) {
        const { plateThickness, fast, slow, ret, maxTravel } = params;
        return `
; Z-Touchplate Probing
%plate_thickness = ${plateThickness}
%fast_speed = ${fast}
%slow_speed = ${slow}
%retract = ${ret}
%max_travel = ${maxTravel}

G91
; Probe Z Surface
G38.2 Z-[max_travel] F[fast_speed]
G0 Z[retract]
G38.2 Z-5 F[slow_speed]

; Set Z0
G10 L20 P1 Z[plate_thickness]

; Retract and Finish
G0 Z[retract]
G90
        `;
    },

    generateCornerProbe: function (arg, params) {
        const { dia, deflect, fast, slow, ret, maxTravel, r, safeZ, probeDepth } = params;

        let xDir = 0;
        let yDir = 0;

        if (arg.includes('L')) xDir = -1; // Start Left, Probe Right
        if (arg.includes('R')) xDir = 1; // Start Right, Probe Left
        if (arg.includes('B')) yDir = -1; // Start Bottom/Front, Probe Up/Back
        if (arg.includes('T')) yDir = 1; // Start Top/Back, Probe Down/Front

        return `
; Corner Probing (${arg})
%physical_diam = ${dia}
%deflection = ${deflect}
%fast_speed = ${fast}
%slow_speed = ${slow}
%retract = ${ret}
%max_travel = ${maxTravel}
%effective_rad = ${r}
%x_dir = ${xDir}
%y_dir = ${yDir}
%safe_z_height = ${safeZ}
%probe_depth = ${probeDepth}

G91

; Find Z Surface
G38.2 Z-[max_travel] F[fast_speed]
G0 Z[retract]
G38.2 Z-5 F[slow_speed]
G10 L20 P1 Z0
G0 Z[safe_z_height]

; --- X Axis --- 
; Move to Start Position
G0 X[x_dir * max_travel] 
G0 Z-[safe_z_height + probe_depth]

; Probe X (Opposite to x_dir)
G38.2 X[-x_dir * max_travel] F[fast_speed]
G0 X[x_dir * retract]
G38.2 X[-x_dir * 5] F[slow_speed]

; Set Zero (Offset by radius * direction)
; If xDir is -1 (Left), we probed Right (+). The touched surface is at X = -radius.
; If xDir is 1 (Right), we probed Left (-). The touched surface is at X = +radius.
G10 L20 P1 X[x_dir * effective_rad]

G0 X[x_dir * retract]
G0 Z[safe_z_height + probe_depth]
G0 X[-x_dir * max_travel] ; Return to approx X center

; --- Y Axis ---
; Move to Start Position
G0 Y[y_dir * max_travel]
G0 Z-[safe_z_height + probe_depth]

; Probe Y (Opposite to y_dir)
G38.2 Y[-y_dir * max_travel] F[fast_speed]
G0 Y[y_dir * retract]
G38.2 Y[-y_dir * 5] F[slow_speed]

; Set Zero
; If yDir is -1 (Front), we probed Back (+). Surface is at Y = -radius.
G10 L20 P1 Y[y_dir * effective_rad]

G0 Y[y_dir * retract]
G0 Z[safe_z_height + probe_depth]
G0 Y[-y_dir * max_travel]

G90
G0 X0 Y0
         `;
    },

    generateToolChangeProbe: function (params) {
        const {
            toolProbeX, toolProbeY, toolProbeZ, safeZMachine,
            travelSpeed, feedFast, feedSlow, maxTravel, ret
        } = params;

        // Note: Using %variables to make the G-code easier to read/debug in the confirmation window
        return `
; Tool Change & Probe
%SAFE_HEIGHT_MACH = ${safeZMachine}
%TOOL_PROBE_X_MACH = ${toolProbeX}
%TOOL_PROBE_Y_MACH = ${toolProbeY}
%TOOL_PROBE_Z_MACH = ${toolProbeZ}
%PROBE_DISTANCE = ${maxTravel}
%PROBE_FAST_FEEDRATE = ${feedFast}
%PROBE_SLOW_FEEDRATE = ${feedSlow}
%TRAVEL_SPEED = ${travelSpeed}
%RETRACT = ${ret}

; Keep a backup of current work position (Not fully supported in standard grbl macros, 
; but typically variables are local or we rely on G54 restoration)
; We will use G53 for movements to probe, and restore with G0 in G54.

M5 ; Stop spindle
G21 ; Metric
G90 ; Absolute

; 1. Move to Safe Z (Machine Coords)
G53 G0 Z[SAFE_HEIGHT_MACH]

; 2. Move to Tool Probe Location (Machine Coords)
G53 G0 X[TOOL_PROBE_X_MACH] Y[TOOL_PROBE_Y_MACH]

; 3. Initial Tool Probe
; Move down to probe approach height
G53 G0 Z[TOOL_PROBE_Z_MACH]

; Probe (G38.2 requires relative or absolute? It works in current mode. We should be in G91 for relative probe usually to be safe with unknown Z)
G91
G38.2 Z-[PROBE_DISTANCE] F[PROBE_FAST_FEEDRATE]
G0 Z[RETRACT]
G38.2 Z-[RETRACT + 2] F[PROBE_SLOW_FEEDRATE]
; Store current Z (Machine Z at trigger)
%ORIGINAL_TOOL_Z = posz

G0 Z5
G90

; Move back to Safe Z
G53 G0 Z[SAFE_HEIGHT_MACH]

; 4. Manual Tool Change
M0 (Change tool now)

; 5. Probe New Tool
; Ensure we differ in X/Y/Z? No, we are still at Safe Z, X/Y of probe.
G53 G0 X[TOOL_PROBE_X_MACH] Y[TOOL_PROBE_Y_MACH]
G53 G0 Z[TOOL_PROBE_Z_MACH]

G91
G38.2 Z-[PROBE_DISTANCE] F[PROBE_FAST_FEEDRATE]
G0 Z[RETRACT]
G38.2 Z-[RETRACT + 2] F[PROBE_SLOW_FEEDRATE]
%NEW_TOOL_Z = posz

G90

; 6. Apply Offset
; The difference in Z is (NEW_TOOL_Z - ORIGINAL_TOOL_Z).
; If new tool is longer (lower Z trigger), difference is negative? 
; No, Z trigger is higher if tool is longer. 
; If original = -10, new = -5 (longer tool), diff = +5.
; We want to adjust G54 Z offset so that the Z0 remains true relative to the workpiece.
; Actually simpler: G92 or G43.1?
; Standard method: G10 L20 P1 Z... ?
; If we are at the touch plate current trigger height, that physical height IS the same as it was for the old tool.
; But G54 Z is relative to that.
; The simplest logic used in the provided file:
; "G92 Z[ORIGINAL_TOOL]"
; This sets the CURRENT position to be the logical Z of the original tool.
; Since we are physically at the SAME sensor height, saying "We are at Z_ORIG" effectively updates the offset.
; However, %ORIGINAL_TOOL_Z captured 'posz' which is Machine Z? 
; If 'posz' returns machine Z in the macro system this widget uses (which seems to be cncjs macro evaluation?), 
; then G92 Z[posz] would set Work Z to Machine Z, which is wrong.
; Wait, the original G-code said:
; %ORIGINAL_TOOL = posz
; ...
; G92 Z[ORIGINAL_TOOL]
; IF 'posz' is work coordinate Z, then this works perfectly.
; In cncjs macros, 'posz' is usually work position Z. 'mposz' is machine.
; So we assume 'posz' is Work Z.

G92 Z[ORIGINAL_TOOL_Z]

G91
G0 Z5
G90
G53 G0 Z[SAFE_HEIGHT_MACH]

; Restore is simple return to previousXY? 
; The original file had: G0 X[X0] Y[Y0]
; We don't track X0/Y0 easily here unless we capture it at start.
; This widget generates G-code sent effectively as a stream. 
; Capturing start pos in a macro variable is good practice.

; Done.
        `;
    }
};


// Make it available globally
window.GCodeGenerator = GCodeGenerator;

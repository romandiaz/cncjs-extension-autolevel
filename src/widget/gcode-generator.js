
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
G91
G0 Z-[safe_z_height]

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
    }
};

// Make it available globally
window.GCodeGenerator = GCodeGenerator;
